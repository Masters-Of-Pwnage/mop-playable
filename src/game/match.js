/**
 * Match controller: owns the GameEngine and routes commands locally (practice
 * vs AI) or through the lobby relay (online, host authoritative). Also drives
 * AI seats. The engine state is wrapped in a Vue `shallowRef`-like counter so
 * views re-render after every applied command.
 */
import { reactive, ref } from 'vue';
import { GameEngine, Stage, clean, randomOrder, redactFor } from '../engine/engine.js';
import { AIPlayer } from '../engine/ai.js';
import { getCard } from '../stores/cards.js';
import { lobby, net } from '../net/client.js';

const SNAPSHOT_EVERY_MS = 2000; // at most one full snapshot per period, however many `ready` arrive
const MAX_EVENTS = 500;

/** What the guest may learn from a host command: no shuffle orders, no deck lists (F-5). */
function publicCmd(cmd) {
  const { order, orders, ...rest } = cmd;
  if (cmd.t === 'setup') rest.players = cmd.players.map((pd) => ({ name: pd.name, deckName: pd.deckName }));
  return rest;
}

export class Match {
  constructor() {
    this.engine = new GameEngine(getCard, (ev) => this._onEvent(ev));
    this.engine.wrap = reactive; // Vue tracks every mutation the engine makes
    this.engine.state = reactive(this.engine.state);
    this.mode = 'ai';
    this.localSeats = [0];
    this.ais = new Map();
    this.listeners = new Set();
    this.version = ref(0); // bump to trigger re-render
    this.status = reactive({ waitingPeer: false, synced: true });
    this._aiTimer = null;
    this._aiFailures = 0;
    this._unsubRelay = null;
    this._guestReady = false;
    this._pendingSetup = null;
    this._capture = null; // engine events of the command being executed (forwarded to the guest)
    this._unsubRoom = null;
    this._stale = false; // host: commands ran while the guest was away, it needs a snapshot
    this._lastSnapshot = 0;
    this._snapTimer = null;
    this.rnd = Math.random;
  }

  get state() {
    return this.engine.state;
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _onEvent(ev) {
    if (ev.type === 'changed') this.version.value += 1;
    else if (this._capture) this._capture.push(ev);
    for (const fn of this.listeners) fn(ev);
  }

  isLocal(seat) {
    return this.localSeats.includes(seat) && !this.ais.has(seat);
  }

  /**
   * cfg = { mode, players: [{name, deckName, deck:[uid], ai}], seat (local seat for online) }
   */
  start(cfg) {
    this.mode = cfg.mode;
    this.localSeats = [cfg.seat ?? 0];
    this.ais.clear();
    cfg.players.forEach((p, i) => {
      if (p.ai && cfg.mode !== 'online') this.ais.set(i, new AIPlayer(i)); // never an AI seat from the peer
    });
    if (this.mode === 'online') {
      this._unsubRelay?.();
      this._unsubRelay = lobby.onRelay((data) => this._onRelay(data));
      this._unsubRoom?.();
      this._unsubRoom = lobby.onRoom((msg) => {
        // Every message carries the whole (redacted) state, so a guest that was away only needs the latest.
        if (msg.type === 'peer_back' && net.seat === 0 && this._stale && this.state.players.length) {
          this._stale = false;
          this._sendSnapshot();
        }
      });
      if (net.seat === 0) {
        const setup = this._makeSetup(cfg);
        this._pendingSetup = setup;
        this.status.waitingPeer = true;
        lobby.relay({ k: 'hello_host' });
        if (this._guestReady) this._startOnline();
      } else {
        this.status.waitingPeer = true;
        this.status.synced = false;
        lobby.relay({ k: 'ready' });
      }
      return;
    }
    this._execute(this._makeSetup(cfg));
  }

  _makeSetup(cfg) {
    return {
      t: 'setup', players: cfg.players.map((p) => ({ name: p.name, deckName: p.deckName, deck: p.deck, ai: !!p.ai })),
      orders: cfg.players.map((p) => randomOrder(p.deck.length, this.rnd)), first: Math.floor(this.rnd() * 2),
      enforce: cfg.enforce ?? true, life: cfg.life ?? 20,
    };
  }

  _startOnline() {
    if (!this._pendingSetup) return;
    const setup = this._pendingSetup;
    this._pendingSetup = null;
    this.status.waitingPeer = false;
    this._execute(setup);
    lobby.started();
  }

  /** Entry point for every player action from the UI. */
  submit(cmd) {
    if (this.mode === 'online' && net.seat !== 0) {
      const err = this.engine.validate(cmd);
      if (err) return err;
      lobby.relay({ k: 'req', cmd });
      return '';
    }
    return this._execute(cmd);
  }

  _execute(cmd) {
    const invalid = this.engine.validate(cmd); // before _prepare, which indexes players[cmd.p]
    if (invalid) return invalid;
    this._prepare(cmd);
    const events = [];
    this._capture = events;
    let err;
    try {
      err = this.engine.execute(cmd);
    } finally {
      this._capture = null;
    }
    if (err) return err;
    if (this.mode === 'online' && net.seat === 0 && net.peerAway) {
      this._stale = true; // don't fill the server's buffer for a disconnected guest with ~50 KB states
    } else if (this.mode === 'online' && net.seat === 0) {
      // The guest gets the state redacted for seat 1 plus the public events (for its animations),
      // never the host's hand, library order or shuffle orders (F-5).
      const show = cmd.t === 'reveal_hand' && cmd.p === 0 ? [...this.state.players[0].hand] : [];
      lobby.relay({ k: 'cmd', cmd: publicCmd(cmd), state: redactFor(this.state, 1, show), events: events.slice(-MAX_EVENTS) });
    }
    this.scheduleAi();
    return '';
  }

  /** Full snapshot for the guest (it reached the table or lost sync), redacted for seat 1. */
  _sendSnapshot() {
    this._lastSnapshot = Date.now();
    lobby.relay({ k: 'state', state: redactFor(this.state, 1) });
  }

  /** Guest: replaces its state with the host's redacted copy and replays the public events. */
  _loadFromHost(state, events) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players) || !state.cards) return;
    this.engine.load(state, Array.isArray(events) ? events.slice(0, MAX_EVENTS) : []);
    this.status.synced = true;
    this.status.waitingPeer = false;
  }

  /** Resolves randomness so the command is deterministic for every peer. */
  _prepare(cmd) {
    const s = this.state;
    if (cmd.t === 'shuffle') cmd.order = randomOrder(s.players[cmd.p].library.length, this.rnd);
    if (cmd.t === 'mulligan') {
      const ps = s.players[cmd.p];
      cmd.order = randomOrder(ps.library.length + ps.hand.length, this.rnd);
    }
  }

  _onRelay(raw) {
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const host = net.seat === 0;
    switch (msg.k) {
      case 'ready': // guest is on the table
        if (host) {
          this._guestReady = true;
          if (this._pendingSetup) this._startOnline();
          else if (this.state.players.length) {
            // A `ready` loop must not make the host serialize and send a snapshot per message (F-9):
            // answer at once if the last snapshot is old enough, otherwise once when the period ends.
            const wait = SNAPSHOT_EVERY_MS - (Date.now() - this._lastSnapshot);
            if (wait <= 0) this._sendSnapshot();
            else if (!this._snapTimer) {
              this._snapTimer = setTimeout(() => {
                this._snapTimer = null;
                if (this.state.players.length) this._sendSnapshot();
              }, wait);
            }
          }
        }
        break;
      case 'hello_host': // host (re)joined the table: ask for a snapshot
        if (!host) lobby.relay({ k: 'ready' });
        break;
      case 'req': // guest request
        if (host && msg.cmd && typeof msg.cmd === 'object' && !Array.isArray(msg.cmd) && msg.cmd.t !== 'setup') {
          const { order, ...rest } = msg.cmd; // shuffles are always the host's (_prepare)
          const cmd = { ...rest, p: 1 }; // a guest always acts (and is logged) as seat 1
          try {
            this._execute(cmd);
          } catch (err) {
            console.warn('req do convidado rejeitado:', err);
          }
        }
        break;
      case 'cmd': // host broadcast: its state after the command, redacted for us, plus the public events
        if (!host) this._loadFromHost(msg.state, msg.events);
        break;
      case 'state': // host snapshot
        if (!host) this._loadFromHost(msg.state, []);
        break;
      case 'chat':
        for (const fn of this.listeners) fn({ type: 'chat', from: host ? 1 : 0, text: clean(String(msg.text ?? ''), 200) });
        break;
      default:
        break;
    }
  }

  chat(text) {
    const from = net.seat;
    lobby.relay({ k: 'chat', from, text });
    for (const fn of this.listeners) fn({ type: 'chat', from, text });
  }

  // ---------------------------------------------------------------- AI

  scheduleAi(delay = 550) {
    if (!this.ais.size || !this.state.players.length || this.state.stage === Stage.OVER) return;
    if (this._aiTimer) return;
    this._aiTimer = setTimeout(() => {
      this._aiTimer = null;
      this._aiStep();
    }, delay);
  }

  _aiStep() {
    for (const ai of this.ais.values()) {
      const cmd = ai.decide(this.engine);
      if (!cmd) continue;
      const err = this._execute(cmd);
      if (err) {
        this._aiFailures += 1;
        console.warn('IA:', cmd, err);
        if (this._aiFailures > 3 && this.state.active === ai.seat) {
          this._aiFailures = 0;
          this._execute({ t: 'end_turn', p: ai.seat });
        }
      } else this._aiFailures = 0;
      return;
    }
  }

  dispose() {
    clearTimeout(this._aiTimer);
    clearTimeout(this._snapTimer);
    this._snapTimer = null;
    this._aiTimer = null;
    this._unsubRelay?.();
    this._unsubRelay = null;
    this._unsubRoom?.();
    this._unsubRoom = null;
    this.listeners.clear();
  }
}

/**
 * Rules-assisted game engine. Every change to a match goes through `execute(cmd)`
 * with a plain command object, so local play, the AI and network peers all share
 * the same code path. Commands must be deterministic: randomness (shuffles, first
 * player) is resolved before they reach the engine.
 *
 * The state is plain JSON-serializable data so it can be sent to a peer as-is.
 */
import { Kind, fold } from './cards.js';
import { ANY, emptyPool, makeSource, planPayment } from './mana.js';

export const Zone = Object.freeze({ LIBRARY: 0, HAND: 1, BATTLEFIELD: 2, GRAVEYARD: 3, EXILE: 4, STACK: 5 });
export const Phase = Object.freeze({ UNTAP: 0, UPKEEP: 1, DRAW: 2, MAIN1: 3, ATTACK: 4, BLOCK: 5, DAMAGE: 6, MAIN2: 7, END: 8 });
export const Stage = Object.freeze({ SETUP: 0, MULLIGAN: 1, PLAY: 2, OVER: 3 });

export const ZONE_NAMES = {
  [Zone.LIBRARY]: 'Grimório', [Zone.HAND]: 'Mão', [Zone.BATTLEFIELD]: 'Campo de batalha',
  [Zone.GRAVEYARD]: 'Cemitério', [Zone.EXILE]: 'Exílio', [Zone.STACK]: 'Pilha',
};
export const PHASE_NAMES = {
  [Phase.UNTAP]: 'Desvirar', [Phase.UPKEEP]: 'Manutenção', [Phase.DRAW]: 'Compra', [Phase.MAIN1]: 'Principal 1',
  [Phase.ATTACK]: 'Ataque', [Phase.BLOCK]: 'Bloqueio', [Phase.DAMAGE]: 'Dano', [Phase.MAIN2]: 'Principal 2', [Phase.END]: 'Final',
};
export const HAND_LIMIT = 7;
export const DISCARD = 'DISCARD';

const ZONE_KEY = { [Zone.LIBRARY]: 'library', [Zone.HAND]: 'hand', [Zone.BATTLEFIELD]: 'battlefield', [Zone.GRAVEYARD]: 'graveyard', [Zone.EXILE]: 'exile' };

// Command validation: a network peer can send any of these, so every field is checked here.
const CARD_CMDS = new Set(['play', 'resolve', 'counter', 'move', 'tap', 'counter_add', 'pt_mod', 'set_pt', 'reveal', 'attach', 'damage_card', 'mana_tap']);
const FIELD_ONLY = new Set(['tap', 'counter_add', 'pt_mod', 'set_pt', 'attach', 'damage_card', 'mana_tap']);
const MOVE_ZONES = new Set([Zone.LIBRARY, Zone.HAND, Zone.BATTLEFIELD, Zone.GRAVEYARD, Zone.EXILE]); // the stack is reached by `play`
const MAX_LOOK = 20; // GameView offers "look at the top X" up to 20
const BAD_ORDER = 'Ordem de embaralhamento inválida.';
const MANA = ['W', 'U', 'B', 'R', 'G', 'C'];
const COUNTER_NAMES = ['+1/+1', '-1/-1', 'lealdade', 'marcador'];
// Ceilings match what the honest UI offers (GameView/GamePrompt): a peer's ~80-byte request must not
// make the host create thousands of sprites or spin in the payment planner.
const MAX = { x: 30, token: 10, pt: 99, mod: 20, amount: 99, life: 99, pool: 20, poolTotal: 99, draw: 20, mill: 30, counter: 20 };
const within = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
/** Free text from another player: no control/bidi/zero-width characters, collapsed spaces, bounded length. */
export const clean = (v, max) => (typeof v === 'string' ? v.slice(0, max * 4).replace(UNSAFE_TEXT, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function newState() {
  return {
    players: [], cards: {}, stack: [], stage: Stage.SETUP, turn: 0, active: 0, firstPlayer: 0,
    phase: Phase.UNTAP, nextIid: 1, winner: -1, enforceRules: true, startingLife: 20, log: [], blockedAttackers: {},
  };
}

export class GameEngine {
  /** @param {(uid: string) => import('./cards.js').Card | undefined} lookup */
  constructor(lookup, onEvent = () => {}) {
    this.lookup = lookup;
    this.onEvent = onEvent;
    /** Hook to wrap new state objects (the web UI passes Vue's `reactive`). */
    this.wrap = (s) => s;
    this.state = this.wrap(newState());
  }

  // ---------------------------------------------------------------- card helpers

  card(iid) {
    // iids reach here from the peer: `cards` is a plain object, so "__proto__" would return Object.prototype.
    return Number.isInteger(iid) && Object.hasOwn(this.state.cards, iid) ? this.state.cards[iid] : null;
  }

  data(ci) {
    return ci && !ci.isToken ? this.lookup(ci.uid) : undefined;
  }

  displayName(ci) {
    if (!ci) return '?';
    if (ci.isToken) return ci.tokenName;
    return this.data(ci)?.name || '?';
  }

  isCreature(ci) {
    return !!ci && (ci.isToken || this.data(ci)?.kind === Kind.CREATURE);
  }

  isLand(ci) {
    return !!ci && !ci.isToken && this.data(ci)?.kind === Kind.LAND;
  }

  isPlaneswalker(ci) {
    return !!ci && !ci.isToken && this.data(ci)?.kind === Kind.PLANESWALKER;
  }

  hasKeyword(ci, kw) {
    return !!ci && !ci.isToken && !!this.data(ci)?.keywords[kw];
  }

  hasStats(ci) {
    return ci.isToken || ci.ovToughness !== null || !!this.data(ci)?.hasPT;
  }

  basePower(ci) {
    if (ci.ovPower !== null) return ci.ovPower;
    return ci.isToken ? ci.tokenPower : (this.data(ci)?.power || 0);
  }

  baseToughness(ci) {
    if (ci.ovToughness !== null) return ci.ovToughness;
    return ci.isToken ? ci.tokenToughness : (this.data(ci)?.toughness || 0);
  }

  power(ci) {
    return this.basePower(ci) + (ci.counters['+1/+1'] | 0) - (ci.counters['-1/-1'] | 0) + ci.tempPower;
  }

  toughness(ci) {
    return this.baseToughness(ci) + (ci.counters['+1/+1'] | 0) - (ci.counters['-1/-1'] | 0) + ci.tempToughness;
  }

  loyalty(ci) {
    return ci.counters.lealdade | 0;
  }

  player(i) {
    return this.state.players[i];
  }

  opponent(i) {
    return 1 - i;
  }

  defendingPlayer() {
    return this.opponent(this.state.active);
  }

  attackers() {
    return this.player(this.state.active).battlefield.filter((iid) => this.card(iid).attacking);
  }

  blockersOf(attackerIid) {
    return this.player(this.opponent(this.state.active)).battlefield.filter((iid) => this.card(iid).blocking === attackerIid);
  }

  untappedManaSources(p) {
    const out = [];
    for (const iid of this.player(p).battlefield) {
      const c = this.card(iid);
      if (c.tapped || c.isToken) continue;
      const d = this.data(c);
      if (d && d.kind === Kind.LAND) out.push(makeSource(iid, d.produces.length ? [...d.produces] : [ANY]));
    }
    return out;
  }

  isMainPhase() {
    return this.state.phase === Phase.MAIN1 || this.state.phase === Phase.MAIN2;
  }

  // ---------------------------------------------------------------- public API

  /** Applies a command. Returns "" on success or the reason it was rejected. */
  execute(cmd) {
    const err = this.validate(cmd);
    if (err) return err;
    this._apply(cmd);
    this._stateBasedActions();
    this._emit({ type: 'changed' });
    return '';
  }

  validate(cmd) {
    const t = cmd.t;
    const s = this.state;
    if (t !== 'setup' && s.players.length === 0) return 'Partida não iniciada.';
    if (s.stage === Stage.OVER && t !== 'chat') return 'A partida terminou.';
    const p = cmd.p ?? -1;
    if (t !== 'setup' && !(Number.isInteger(p) && p >= 0 && p < s.players.length)) return 'Jogador inválido.';
    if (CARD_CMDS.has(t)) {
      const c = this.card(cmd.iid);
      if (!c) return 'Carta inválida.';
      // Free-table actions are fine on public zones; hand and library belong to their owner.
      if (isHidden(c) && c.owner !== p) return 'Esta carta não é sua.';
      if (FIELD_ONLY.has(t) && c.zone !== Zone.BATTLEFIELD) return 'A carta precisa estar no campo de batalha.';
    }
    switch (t) {
      case 'setup': {
        // Each order must be a permutation of that player's deck list (absent = no shuffle).
        const orders = cmd.orders ?? [];
        if (!Array.isArray(cmd.players) || !Array.isArray(orders)) return 'Partida inválida.';
        for (let i = 0; i < cmd.players.length; i += 1) {
          const pd = cmd.players[i];
          const deck = pd?.deck ?? [];
          if (!pd || typeof pd !== 'object' || !Array.isArray(deck)) return 'Partida inválida.';
          if (!optionalPermutation(orders[i], deck.length)) return BAD_ORDER;
        }
        return '';
      }
      case 'mulligan': {
        const ps = s.players[p];
        if (s.stage !== Stage.MULLIGAN || ps.kept) return 'Mulligan só antes do início.';
        // _mulligan returns each hand card to ITS OWNER's library: a foreign card would break the shuffle.
        if (ps.hand.some((iid) => this.card(iid)?.owner !== p)) return 'Mão inválida.';
        return optionalPermutation(cmd.order, ps.library.length + ps.hand.length) ? '' : BAD_ORDER;
      }
      case 'shuffle':
        return optionalPermutation(cmd.order, s.players[p].library.length) ? '' : BAD_ORDER;
      case 'keep': {
        if (s.stage !== Stage.MULLIGAN || s.players[p].kept) return 'Mão já mantida.';
        const bottom = cmd.bottom || [];
        if (!Array.isArray(bottom) || new Set(bottom).size !== bottom.length) return 'Carta repetida.';
        if (s.enforceRules && bottom.length !== s.players[p].mulligans) return `Escolha ${s.players[p].mulligans} carta(s) para o fundo do grimório.`;
        for (const iid of bottom) if (!s.players[p].hand.includes(iid)) return 'Carta inválida.';
        return '';
      }
      case 'play':
        // X is bounded like the UI's prompt; payment planning walks the cost, so it must stay small.
        if (cmd.x !== undefined && !within(cmd.x, 0, MAX.x)) return 'Valor de X inválido.';
        return this.canPlay(p, cmd.iid, !!cmd.force, cmd.x | 0);
      case 'attack': {
        const attackers = cmd.attackers || [];
        if (!Array.isArray(attackers) || new Set(attackers).size !== attackers.length) return 'Atacantes inválidos.';
        return this._validateAttack(p, attackers);
      }
      case 'block': {
        const blocks = cmd.blocks || [];
        if (!Array.isArray(blocks) || blocks.some((b) => !Array.isArray(b) || b.length !== 2)) return 'Bloqueios inválidos.';
        return this._validateBlock(p, blocks);
      }
      case 'damage':
        return s.phase === Phase.DAMAGE ? '' : 'Não há dano de combate pendente.';
      case 'phase_next':
      case 'end_turn':
        if (s.stage !== Stage.PLAY) return 'A partida ainda não começou.';
        if (s.enforceRules && p !== s.active) return 'Não é o seu turno.';
        if (t === 'end_turn' && s.enforceRules && s.players[s.active].hand.length > HAND_LIMIT) return DISCARD;
        if (s.phase === Phase.BLOCK || s.phase === Phase.DAMAGE) return 'Termine o combate primeiro.';
        return '';
      case 'mana_tap': {
        const c = this.card(cmd.iid);
        if (c.controller !== p) return 'Esta fonte de mana não é sua.';
        if (c.tapped) return 'Já está virada.';
        if (!MANA.includes(cmd.color)) return 'Cor inválida.';
        return '';
      }
      case 'resolve':
      case 'counter':
        return s.stack.includes(cmd.iid) ? '' : 'Carta não está na pilha.';
      case 'move': {
        if (!MOVE_ZONES.has(cmd.zone)) return 'Zona inválida.';
        const to = cmd.to ?? -1;
        if (to !== -1 && !(Number.isInteger(to) && to >= 0 && to < s.players.length)) return 'Jogador inválido.';
        if (cmd.pos !== undefined && cmd.pos !== 'top' && cmd.pos !== 'bottom') return 'Posição inválida.';
        return '';
      }
      case 'attach': {
        const target = cmd.target ?? -1;
        if (target === -1) return '';
        return target !== cmd.iid && this.card(target) ? '' : 'Alvo inválido.';
      }
      case 'library_order':
        return this._validateLibraryOrder(p, cmd.top ?? [], cmd.bottom ?? []);
      case 'tap': return cmd.value === undefined || typeof cmd.value === 'boolean' ? '' : 'Valor inválido.';
      case 'counter_add': return COUNTER_NAMES.includes(cmd.name) && within(cmd.delta, -MAX.counter, MAX.counter) ? '' : 'Marcador inválido.';
      case 'pt_mod': return within(cmd.power ?? 0, -MAX.mod, MAX.mod) && within(cmd.toughness ?? 0, -MAX.mod, MAX.mod) ? '' : 'Valor fora do limite.';
      case 'set_pt': return within(cmd.power, 0, MAX.pt) && within(cmd.toughness, 0, MAX.pt) ? '' : 'Valor fora do limite.';
      case 'damage_card': return within(cmd.amount, 1, MAX.amount) ? '' : 'Valor fora do limite.';
      case 'pool': return MANA.includes(cmd.color) && within(cmd.delta, -MAX.pool, MAX.pool) ? '' : 'Valor fora do limite.';
      case 'life': return within(cmd.delta, -MAX.life, MAX.life) ? '' : 'Valor fora do limite.';
      case 'token':
        return within(cmd.n ?? 1, 1, MAX.token) && within(cmd.power ?? 1, 0, MAX.pt) && within(cmd.toughness ?? 1, 0, MAX.pt)
          ? '' : 'Valor fora do limite (até 10 fichas, P/R até 99).';
      case 'draw': return within(cmd.n ?? 1, 1, MAX.draw) ? '' : 'Valor fora do limite.';
      case 'mill': return within(cmd.n ?? 1, 1, MAX.mill) ? '' : 'Valor fora do limite.';
      case 'reveal': case 'reveal_hand': case 'concede': case 'chat':
        return '';
      default:
        return 'Comando desconhecido.';
    }
  }

  /** library_order may only rearrange distinct cards from the top of the player's own library. */
  _validateLibraryOrder(p, top, bottom) {
    if (!Array.isArray(top) || !Array.isArray(bottom)) return 'Seleção inválida.';
    const lib = this.player(p).library;
    const all = [...top, ...bottom];
    if (all.length > MAX_LOOK || new Set(all).size !== all.length) return 'Seleção inválida.';
    const topCards = new Set(lib.slice(lib.length - all.length));
    return all.every((iid) => topCards.has(iid)) ? '' : 'Só as cartas do topo do seu grimório.';
  }

  /** Why a card can't be played right now ("" = it can). */
  canPlay(p, iid, force = false, x = 0) {
    const s = this.state;
    const c = this.card(iid);
    if (!c) return 'Carta inválida.';
    if (s.stage !== Stage.PLAY) return 'Aguarde o início da partida.';
    if (c.zone === Zone.BATTLEFIELD || c.zone === Zone.STACK) return 'A carta já está em jogo.';
    if (isHidden(c) && c.owner !== p) return 'Esta carta não é sua.';
    if (c.zone !== Zone.HAND && !force) return 'Só é possível jogar cartas da mão.';
    if (force || !s.enforceRules) return '';
    const d = this.data(c);
    if (!d) return 'Carta inválida.';
    if (d.kind === Kind.LAND) {
      if (p !== s.active) return 'Cyberlands só podem ser jogados no seu turno.';
      if (!this.isMainPhase() || s.stack.length) return 'Cyberlands só podem ser jogados na fase principal.';
      if (s.players[p].landsPlayed >= 1) return 'Você já jogou um Cyberland neste turno.';
      return '';
    }
    const instantSpeed = d.kind === Kind.INSTANT || d.keywords.flash;
    if (!instantSpeed) {
      if (p !== s.active) return 'Só pode ser jogada no seu turno.';
      if (!this.isMainPhase()) return 'Só pode ser jogada na fase principal.';
      if (s.stack.length) return 'Resolva a pilha antes.';
    }
    if (!this.findPayment(p, iid, x)) return 'Mana insuficiente.';
    return '';
  }

  findPayment(p, iid, x = 0) {
    const c = this.card(iid);
    const d = this.data(c);
    if (!c || !d) return null;
    const sources = this.untappedManaSources(p).filter((src) => src.iid !== iid);
    return planPayment(d.cost, x, this.player(p).pool, sources);
  }

  canAttackWith(iid) {
    const c = this.card(iid);
    if (!c || c.zone !== Zone.BATTLEFIELD || !this.isCreature(c) || c.tapped) return false;
    if (!this.state.enforceRules) return true;
    if (c.sick && !this.hasKeyword(c, 'haste')) return false;
    if (this.hasKeyword(c, 'defender')) return false;
    return true;
  }

  canBlock(blockerIid, attackerIid) {
    const b = this.card(blockerIid);
    const a = this.card(attackerIid);
    if (!b || !a || !this.isCreature(b) || b.tapped || b.zone !== Zone.BATTLEFIELD) return false;
    if (!a.attacking) return false;
    if (this.state.enforceRules && this.hasKeyword(a, 'flying') && !(this.hasKeyword(b, 'flying') || this.hasKeyword(b, 'reach'))) return false;
    return true;
  }

  /**
   * Replaces the whole state (network sync), then replays the events that produced it so the view can
   * animate as if the commands had run here.
   */
  load(state, events = []) {
    this.state = this.wrap(state);
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || ev.type === 'changed') continue;
      try {
        this._emit(ev);
      } catch (err) {
        console.warn('evento ignorado:', ev.type, err);
      }
    }
    this._emit({ type: 'changed' });
  }

  // ---------------------------------------------------------------- dispatcher

  _apply(cmd) {
    const p = cmd.p ?? -1;
    const s = this.state;
    switch (cmd.t) {
      case 'setup': return this._setup(cmd);
      case 'mulligan': return this._mulligan(p, cmd.order || []);
      case 'keep': return this._keep(p, cmd.bottom || []);
      case 'draw': return this._draw(p, cmd.n ?? 1);
      case 'play': return this._play(p, cmd.iid, cmd.x | 0);
      case 'resolve': return this._resolve(cmd.iid, false);
      case 'counter': return this._resolve(cmd.iid, true);
      case 'move': {
        const c = this.card(cmd.iid);
        const from = c.zone;
        const to = cmd.zone;
        const hidden = (from === Zone.LIBRARY || from === Zone.HAND) && (to === Zone.LIBRARY || to === Zone.HAND);
        const who = this._pname(p); // whoever asked, never the card's controller
        this._move(c, to, cmd.pos || 'top', cmd.to ?? -1);
        this._log(`${who} moveu ${hidden ? 'uma carta' : this.displayName(c)}: ${ZONE_NAMES[from]} → ${ZONE_NAMES[to]}.`);
        return undefined;
      }
      case 'tap': {
        const c = this.card(cmd.iid);
        c.tapped = cmd.value ?? !c.tapped;
        this._emit({ type: 'tap', iid: c.iid, value: c.tapped });
        return undefined;
      }
      case 'mana_tap': {
        const c = this.card(cmd.iid);
        c.tapped = true;
        this.player(c.controller).pool[cmd.color] += 1;
        this._emit({ type: 'tap', iid: c.iid, value: true });
        this._emit({ type: 'mana', p: c.controller, color: cmd.color, delta: 1, iid: c.iid });
        return undefined;
      }
      case 'pool': {
        const pool = this.player(p).pool;
        pool[cmd.color] = Math.min(MAX.poolTotal, Math.max(0, (pool[cmd.color] | 0) + (cmd.delta | 0)));
        this._emit({ type: 'mana', p, color: cmd.color, delta: cmd.delta | 0 });
        return undefined;
      }
      case 'life': return this._changeLife(p, cmd.delta | 0, clean(cmd.reason, 60));
      case 'counter_add': {
        const c = this.card(cmd.iid);
        const v = (c.counters[cmd.name] | 0) + (cmd.delta | 0);
        if (v <= 0) delete c.counters[cmd.name];
        else c.counters[cmd.name] = v;
        this._emit({ type: 'counter', iid: c.iid, name: cmd.name, delta: cmd.delta | 0 });
        return undefined;
      }
      case 'pt_mod': {
        const c = this.card(cmd.iid);
        c.tempPower += cmd.power | 0;
        c.tempToughness += cmd.toughness | 0;
        this._emit({ type: 'pt', iid: c.iid });
        return undefined;
      }
      case 'set_pt': {
        const c = this.card(cmd.iid);
        c.ovPower = cmd.power | 0;
        c.ovToughness = cmd.toughness | 0;
        this._emit({ type: 'pt', iid: c.iid });
        return undefined;
      }
      case 'token': return this._createTokens(p, clean(cmd.name, 24) || 'Ficha', cmd.power ?? 1, cmd.toughness ?? 1, cmd.n ?? 1);
      case 'shuffle':
        this.player(p).library = permute(this.player(p).library, cmd.order || []);
        this._emit({ type: 'shuffle', p });
        this._log(`${this._pname(p)} embaralhou o grimório.`);
        return undefined;
      case 'reveal': {
        const c = this.card(cmd.iid);
        c.revealed = true;
        this._emit({ type: 'reveal', iid: c.iid, p });
        this._log(`${this._pname(p)} revelou ${this.displayName(c)}.`);
        return undefined;
      }
      case 'reveal_hand':
        this._emit({ type: 'reveal_hand', p });
        this._log(`${this._pname(p)} revelou a mão.`);
        return undefined;
      case 'mill': {
        const ps = this.player(p);
        const n = Math.min(cmd.n ?? 1, ps.library.length);
        for (let i = 0; i < n; i += 1) this._move(this.card(ps.library[ps.library.length - 1]), Zone.GRAVEYARD);
        this._log(`${this._pname(p)} colocou ${n} carta(s) do grimório no cemitério.`);
        return undefined;
      }
      case 'library_order': return this._libraryOrder(p, cmd.top || [], cmd.bottom || []);
      case 'damage_card': return this._damageCard(this.card(cmd.iid), cmd.amount | 0);
      case 'attach': {
        const c = this.card(cmd.iid);
        c.attachedTo = cmd.target ?? -1;
        this._emit({ type: 'attach', iid: c.iid, target: c.attachedTo });
        return undefined;
      }
      case 'attack': return this._attack(p, cmd.attackers || []);
      case 'block': return this._block(p, cmd.blocks || []);
      case 'damage': return this._combatDamage();
      case 'phase_next': return this._phaseNext();
      case 'end_turn': return this._endTurn();
      case 'concede':
        s.players[p].lost = true;
        this._log(`${this._pname(p)} desistiu.`);
        return undefined;
      case 'chat':
        this._log(`${this._pname(p)}: ${clean(String(cmd.text ?? ''), 200)}`);
        return undefined;
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- setup / mulligan

  _setup(cmd) {
    const s = this.wrap(newState());
    this.state = s;
    s.enforceRules = cmd.enforce ?? true;
    s.startingLife = cmd.life ?? 20;
    cmd.players.forEach((pd, i) => {
      const ps = {
        index: i, name: clean(pd.name, 24) || `Jogador ${i + 1}`, deckName: clean(pd.deckName, 40), isAi: !!pd.ai,
        life: s.startingLife, poison: 0, pool: emptyPool(), library: [], hand: [], battlefield: [], graveyard: [], exile: [],
        landsPlayed: 0, mulligans: 0, kept: false, lost: false,
      };
      s.players.push(ps);
      const created = [];
      // Shuffle the deck LIST, then skip unknown uids: a junk uid can no longer turn the shuffle off.
      for (const uid of permute(pd.deck || [], (cmd.orders || [])[i])) {
        if (!this.lookup(uid)) continue;
        const c = {
          iid: s.nextIid, uid, owner: i, controller: i, zone: Zone.LIBRARY, tapped: false, sick: false, counters: {}, damage: 0,
          tempPower: 0, tempToughness: 0, attacking: false, blocking: -1, attachedTo: -1, revealed: false, isToken: false,
          tokenName: '', tokenPower: 0, tokenToughness: 0, xValue: 0, ovPower: null, ovToughness: null, lethalMarked: false,
        };
        s.nextIid += 1;
        s.cards[c.iid] = c;
        created.push(c.iid);
      }
      ps.library = created;
    });
    s.firstPlayer = cmd.first ?? 0;
    s.active = s.firstPlayer;
    s.stage = Stage.MULLIGAN;
    this._emit({ type: 'setup' });
    this._log(`Partida iniciada: ${this._pname(0)} vs ${this._pname(1)}.`);
    for (let i = 0; i < s.players.length; i += 1) this._draw(i, 7);
  }

  _mulligan(p, order) {
    const ps = this.player(p);
    for (const iid of [...ps.hand]) this._move(this.card(iid), Zone.LIBRARY, 'top');
    ps.library = permute(ps.library, order);
    ps.mulligans += 1;
    this._log(`${this._pname(p)} fez mulligan (${ps.mulligans}).`);
    this._emit({ type: 'shuffle', p });
    this._draw(p, 7);
  }

  _keep(p, bottom) {
    const ps = this.player(p);
    for (const iid of bottom) this._move(this.card(iid), Zone.LIBRARY, 'bottom');
    ps.kept = true;
    this._log(`${this._pname(p)} manteve a mão com ${ps.hand.length} carta(s).`);
    if (this.state.players.some((o) => !o.kept)) return;
    this.state.stage = Stage.PLAY;
    this.state.turn = 1;
    this.state.active = this.state.firstPlayer;
    this._beginTurn();
  }

  _libraryOrder(p, top, bottom) {
    const ps = this.player(p);
    const moving = new Set([...top, ...bottom]);
    const rest = ps.library.filter((iid) => !moving.has(iid));
    // `top` is given from the top down; the library top is the array end.
    ps.library = [...bottom, ...rest, ...[...top].reverse()];
    this._emit({ type: 'library', p });
  }

  // ---------------------------------------------------------------- turn flow

  _beginTurn() {
    const s = this.state;
    const ps = this.player(s.active);
    ps.landsPlayed = 0;
    this._setPhase(Phase.UNTAP);
    this._emit({ type: 'turn', p: s.active, turn: s.turn });
    this._log(`— Turno ${s.turn}: ${this._pname(s.active)} —`);
    for (const iid of ps.battlefield) {
      const c = this.card(iid);
      c.tapped = false;
      c.sick = false;
    }
    this._setPhase(Phase.UPKEEP);
    this._remind(s.active, ['manutencao'], 'upkeep');
    this._setPhase(Phase.DRAW);
    if (!(s.turn === 1 && s.active === s.firstPlayer)) this._draw(s.active, 1);
    this._setPhase(Phase.MAIN1);
  }

  _setPhase(ph) {
    this.state.phase = ph;
    for (const ps of this.state.players) ps.pool = emptyPool();
    this._emit({ type: 'phase', phase: ph, p: this.state.active });
  }

  _phaseNext() {
    switch (this.state.phase) {
      case Phase.MAIN1: return this._setPhase(Phase.ATTACK);
      case Phase.ATTACK: return this._setPhase(Phase.MAIN2);
      case Phase.MAIN2: case Phase.END: return this._endTurn();
      default: return this._setPhase(Phase.MAIN1);
    }
  }

  _endTurn() {
    const s = this.state;
    this._setPhase(Phase.END);
    this._remind(s.active, ['no fim do seu turno', 'no final do seu turno', 'no fim do turno', 'etapa final'], 'end');
    for (const ps of s.players) {
      for (const iid of ps.battlefield) {
        const c = this.card(iid);
        c.damage = 0;
        c.lethalMarked = false;
        c.tempPower = 0;
        c.tempToughness = 0;
        c.attacking = false;
        c.blocking = -1;
      }
    }
    s.blockedAttackers = {};
    s.active = this.opponent(s.active);
    s.turn += 1;
    this._beginTurn();
  }

  // ---------------------------------------------------------------- zones

  _draw(p, n) {
    const ps = this.player(p);
    const drawn = [];
    for (let i = 0; i < n; i += 1) {
      if (ps.library.length === 0) {
        if (this.state.stage === Stage.PLAY && this.state.enforceRules) {
          ps.lost = true;
          this._log(`${this._pname(p)} tentou comprar de um grimório vazio!`);
        }
        break;
      }
      const iid = ps.library.pop();
      this.card(iid).zone = Zone.HAND;
      ps.hand.push(iid);
      drawn.push(iid);
    }
    if (drawn.length) {
      this._emit({ type: 'draw', p, iids: drawn });
      if (this.state.stage === Stage.PLAY) this._log(`${this._pname(p)} comprou ${drawn.length} carta(s).`);
    }
  }

  _removeFromZone(c) {
    if (c.zone === Zone.STACK) {
      this.state.stack = this.state.stack.filter((i) => i !== c.iid);
      return;
    }
    const holder = c.zone === Zone.BATTLEFIELD ? c.controller : c.owner;
    const list = this.player(holder)[ZONE_KEY[c.zone]];
    const k = list.indexOf(c.iid);
    if (k !== -1) list.splice(k, 1);
  }

  _move(c, zone, pos = 'top', toPlayer = -1) {
    if (!c) return;
    const from = c.zone;
    this._removeFromZone(c);
    if (from === Zone.BATTLEFIELD && zone !== Zone.BATTLEFIELD) {
      resetBattleState(c);
      for (const other of Object.values(this.state.cards)) if (other.attachedTo === c.iid) other.attachedTo = -1;
    }
    if (zone === Zone.BATTLEFIELD && from !== Zone.BATTLEFIELD) {
      // Nothing set on the card while it was out of play survives into play (only X, set by _play).
      const x = c.xValue;
      resetBattleState(c);
      c.xValue = x;
    }
    if (c.isToken && zone !== Zone.BATTLEFIELD) {
      delete this.state.cards[c.iid];
      this._emit({ type: 'move', iid: c.iid, from, to: -1, p: c.owner });
      return;
    }
    if (zone === Zone.BATTLEFIELD) c.controller = toPlayer >= 0 ? toPlayer : (from === Zone.BATTLEFIELD ? c.controller : c.owner);
    else c.controller = c.owner;
    if (zone === Zone.LIBRARY || zone === Zone.HAND) c.revealed = false;
    c.zone = zone;
    switch (zone) {
      case Zone.STACK:
        this.state.stack.push(c.iid);
        break;
      case Zone.LIBRARY:
        if (pos === 'bottom') this.player(c.owner).library.unshift(c.iid);
        else this.player(c.owner).library.push(c.iid);
        break;
      case Zone.BATTLEFIELD: {
        this.player(c.controller).battlefield.push(c.iid);
        if (from !== Zone.BATTLEFIELD) {
          c.sick = this.isCreature(c) && !this.hasKeyword(c, 'haste');
          const d = this.data(c);
          if (this.isPlaneswalker(c) && d.loyalty > 0 && !('lealdade' in c.counters)) c.counters.lealdade = d.loyalty;
        }
        break;
      }
      default:
        this.player(c.owner)[ZONE_KEY[zone]].push(c.iid);
    }
    this._emit({ type: 'move', iid: c.iid, from, to: zone, p: c.controller });
  }

  _createTokens(p, name, pw, tg, n) {
    const count = Math.min(Math.max(n | 0, 1), MAX.token); // validate() already refuses more; second barrier
    for (let i = 0; i < count; i += 1) {
      const s = this.state;
      const c = {
        iid: s.nextIid, uid: '', owner: p, controller: p, zone: Zone.BATTLEFIELD, tapped: false, sick: true, counters: {}, damage: 0,
        tempPower: 0, tempToughness: 0, attacking: false, blocking: -1, attachedTo: -1, revealed: false, isToken: true,
        tokenName: name, tokenPower: pw | 0, tokenToughness: tg | 0, xValue: 0, ovPower: null, ovToughness: null, lethalMarked: false,
      };
      s.nextIid += 1;
      s.cards[c.iid] = c;
      this.player(p).battlefield.push(c.iid);
      this._emit({ type: 'move', iid: c.iid, from: -1, to: Zone.BATTLEFIELD, p });
    }
    this._log(`${this._pname(p)} criou ${count} ficha(s) ${name} ${pw}/${tg}.`);
  }

  // ---------------------------------------------------------------- casting

  _play(p, iid, x) {
    const c = this.card(iid);
    const d = this.data(c);
    const from = c.zone;
    if (d.kind === Kind.LAND) {
      this._move(c, Zone.BATTLEFIELD, 'top', p);
      if (from === Zone.HAND) this.player(p).landsPlayed += 1;
      this._log(`${this._pname(p)} jogou o Cyberland ${d.name}.`);
      this._emit({ type: 'play', iid, p });
      return;
    }
    const plan = this.findPayment(p, iid, x);
    if (plan) {
      const pool = this.player(p).pool;
      for (const tap of plan.taps) {
        this.card(tap.iid).tapped = true;
        pool[tap.color] += 1;
        this._emit({ type: 'tap', iid: tap.iid, value: true });
      }
      for (const color of Object.keys(plan.spend)) pool[color] = Math.max(0, pool[color] - plan.spend[color]);
      this._emit({ type: 'mana', p, delta: -1 });
    }
    c.xValue = x;
    if (d.isPermanent) {
      this._move(c, Zone.BATTLEFIELD, 'top', p);
      this._log(`${this._pname(p)} jogou ${d.name}${!plan && d.manaValue > 0 ? ' (sem pagar)' : ''}.`);
      this._emit({ type: 'play', iid, p });
      this._remindCard(c, ['entra no campo', 'entrar no campo', 'entra em jogo', 'entrar em jogo', 'entra no jogo'], 'etb');
    } else {
      this._move(c, Zone.STACK, 'top', p);
      c.controller = p;
      this._log(`${this._pname(p)} lançou ${d.name}.`);
      this._emit({ type: 'cast', iid, p });
    }
  }

  _resolve(iid, countered) {
    const c = this.card(iid);
    if (countered) {
      this._move(c, Zone.GRAVEYARD);
      this._log(`${this.displayName(c)} foi anulada.`);
      this._emit({ type: 'countered', iid });
      return;
    }
    if (this.data(c)?.isPermanent) this._move(c, Zone.BATTLEFIELD, 'top', c.controller);
    else this._move(c, Zone.GRAVEYARD);
    this._log(`${this.displayName(c)} resolveu.`);
    this._emit({ type: 'resolved', iid });
  }

  // ---------------------------------------------------------------- combat

  _validateAttack(p, attackers) {
    const s = this.state;
    if (s.stage !== Stage.PLAY) return 'A partida ainda não começou.';
    if (p !== s.active) return 'Só o jogador do turno pode atacar.';
    if (s.phase !== Phase.MAIN1 && s.phase !== Phase.ATTACK) return 'Ataques são declarados após a fase principal 1.';
    for (const iid of attackers) {
      const c = this.card(iid);
      if (!c || c.controller !== p) return 'Atacante inválido.';
      if (!this.canAttackWith(iid)) {
        if (c.sick) return `${this.displayName(c)} está com enjoo de invocação.`;
        return `${this.displayName(c)} não pode atacar.`;
      }
    }
    return '';
  }

  _attack(p, attackers) {
    const s = this.state;
    this._setPhase(Phase.ATTACK);
    s.blockedAttackers = {};
    for (const iid of attackers) {
      const c = this.card(iid);
      c.attacking = true;
      if (!this.hasKeyword(c, 'vigilance')) c.tapped = true;
    }
    if (attackers.length === 0) {
      this._setPhase(Phase.MAIN2);
      return;
    }
    this._emit({ type: 'attack', p, iids: attackers });
    this._log(`${this._pname(p)} atacou com ${attackers.length} criatura(s).`);
    for (const iid of attackers) this._remindCard(this.card(iid), ['sempre que', 'quando'], 'attack', ['ataca', 'atacar']);
    this._setPhase(Phase.BLOCK);
    const defender = this.defendingPlayer();
    const anyBlocker = this.player(defender).battlefield.some((b) => attackers.some((a) => this.canBlock(b, a)));
    if (!anyBlocker) this._setPhase(Phase.DAMAGE);
  }

  _validateBlock(p, blocks) {
    const s = this.state;
    if (s.phase !== Phase.BLOCK) return 'Não é a etapa de bloqueio.';
    if (p !== this.defendingPlayer()) return 'Só o defensor declara bloqueios.';
    const used = new Set();
    const count = {};
    for (const [b, a] of blocks) {
      if (used.has(b)) return 'Uma criatura só pode bloquear uma vez.';
      used.add(b);
      const bc = this.card(b);
      if (!bc || bc.controller !== p) return 'Bloqueador inválido.';
      if (!this.canBlock(b, a)) {
        const ac = this.card(a);
        if (ac && this.hasKeyword(ac, 'flying')) return `${this.displayName(ac)} tem Voar: só criaturas com Voar ou Alcance podem bloqueá-la.`;
        return `${this.displayName(bc)} não pode bloquear.`;
      }
      count[a] = (count[a] | 0) + 1;
    }
    if (s.enforceRules) {
      for (const a of Object.keys(count)) {
        const ac = this.card(Number(a));
        if (this.hasKeyword(ac, 'menace') && count[a] < 2) return `${this.displayName(ac)} tem Ameaça: precisa de 2 ou mais bloqueadores.`;
      }
    }
    return '';
  }

  _block(p, blocks) {
    for (const [b, a] of blocks) {
      this.card(b).blocking = a;
      this.state.blockedAttackers[a] = true;
    }
    this._emit({ type: 'block', p, blocks });
    if (blocks.length) this._log(`${this._pname(p)} bloqueou com ${blocks.length} criatura(s).`);
    this._setPhase(Phase.DAMAGE);
  }

  _combatDamage() {
    const involved = [];
    for (const iid of this.attackers()) involved.push(iid, ...this.blockersOf(iid));
    const firstStrike = involved.some((iid) => this.hasKeyword(this.card(iid), 'first_strike') || this.hasKeyword(this.card(iid), 'double_strike'));
    if (firstStrike) {
      this._damagePass(true);
      this._stateBasedActions();
    }
    this._damagePass(false);
    this._stateBasedActions();
    for (const ps of this.state.players) {
      for (const iid of ps.battlefield) {
        const c = this.card(iid);
        c.attacking = false;
        c.blocking = -1;
      }
    }
    this.state.blockedAttackers = {};
    if (this.state.stage === Stage.PLAY) this._setPhase(Phase.MAIN2);
  }

  _dealsInPass(c, first) {
    const fs = this.hasKeyword(c, 'first_strike');
    const ds = this.hasKeyword(c, 'double_strike');
    return first ? (fs || ds) : (!fs || ds);
  }

  _damagePass(first) {
    const defender = this.defendingPlayer();
    for (const aIid of this.attackers()) {
      const a = this.card(aIid);
      if (!a || a.zone !== Zone.BATTLEFIELD) continue;
      const blockers = this.blockersOf(aIid);
      const attackerDeals = this._dealsInPass(a, first);
      const power = Math.max(this.power(a), 0);
      if (blockers.length === 0) {
        if (attackerDeals && power > 0) {
          if (!this.state.blockedAttackers[aIid]) this._damagePlayer(defender, power, a);
          else if (this.hasKeyword(a, 'trample')) this._damagePlayer(defender, power, a);
        }
        continue;
      }
      if (attackerDeals && power > 0) {
        let remaining = power;
        blockers.forEach((bIid, i) => {
          const b = this.card(bIid);
          const lethal = this.hasKeyword(a, 'deathtouch') ? 1 : Math.max(this.toughness(b) - b.damage, 0);
          let amt = Math.min(remaining, lethal);
          if (i === blockers.length - 1 && !this.hasKeyword(a, 'trample')) amt = remaining;
          if (amt > 0) this._damageCreature(b, amt, a);
          remaining -= amt;
        });
        if (remaining > 0 && this.hasKeyword(a, 'trample')) this._damagePlayer(defender, remaining, a);
      }
      for (const bIid of blockers) {
        const b = this.card(bIid);
        if (b.zone === Zone.BATTLEFIELD && this._dealsInPass(b, first) && this.power(b) > 0) this._damageCreature(a, this.power(b), b);
      }
    }
  }

  _damagePlayer(p, amount, source) {
    this._changeLife(p, -amount, source ? this.displayName(source) : '');
    if (source && this.hasKeyword(source, 'lifelink')) this._changeLife(source.controller, amount, 'vínculo com a vida');
  }

  _damageCreature(c, amount, source) {
    this._damageCard(c, amount);
    if (source) {
      if (this.hasKeyword(source, 'deathtouch')) c.lethalMarked = true;
      if (this.hasKeyword(source, 'lifelink')) this._changeLife(source.controller, amount, 'vínculo com a vida');
    }
  }

  _damageCard(c, amount) {
    if (!c || amount <= 0) return;
    if (this.isPlaneswalker(c) && 'lealdade' in c.counters) c.counters.lealdade -= amount;
    else c.damage += amount;
    this._emit({ type: 'damage', iid: c.iid, amount });
  }

  _changeLife(p, delta, reason = '') {
    if (delta === 0) return;
    const ps = this.player(p);
    ps.life += delta;
    this._emit({ type: 'life', p, delta });
    const why = reason ? ` — ${reason}` : '';
    if (delta < 0) this._log(`${this._pname(p)} perdeu ${-delta} de vida${why} (${ps.life}).`);
    else this._log(`${this._pname(p)} ganhou ${delta} de vida${why} (${ps.life}).`);
  }

  // ---------------------------------------------------------------- state-based actions

  _stateBasedActions() {
    const s = this.state;
    if (s.players.length === 0 || s.stage === Stage.OVER) return;
    let changed = true;
    let guard = 0;
    while (changed && guard < 20) {
      changed = false;
      guard += 1;
      for (const ps of s.players) {
        for (const iid of [...ps.battlefield]) {
          const c = this.card(iid);
          if (this.isCreature(c) && this.hasStats(c)) {
            const t = this.toughness(c);
            const dead = t <= 0 || ((c.damage >= t || c.lethalMarked) && !this.hasKeyword(c, 'indestructible'));
            if (dead) {
              this._emit({ type: 'dies', iid });
              this._log(`${this.displayName(c)} foi destruída.`);
              this._move(c, Zone.GRAVEYARD);
              changed = true;
            }
          } else if (this.isPlaneswalker(c) && 'lealdade' in c.counters && this.loyalty(c) <= 0) {
            this._emit({ type: 'dies', iid });
            this._log(`${this.displayName(c)} ficou sem lealdade.`);
            this._move(c, Zone.GRAVEYARD);
            changed = true;
          }
        }
      }
    }
    if (s.stage === Stage.PLAY || s.stage === Stage.MULLIGAN) {
      const alive = [];
      for (const ps of s.players) {
        if (ps.life <= 0 && s.enforceRules) ps.lost = true;
        if (!ps.lost) alive.push(ps.index);
      }
      if (alive.length <= 1) {
        s.stage = Stage.OVER;
        s.winner = alive.length === 1 ? alive[0] : -1;
        this._log(`Fim de jogo! ${s.winner >= 0 ? `${this._pname(s.winner)} venceu.` : 'Empate.'}`);
        this._emit({ type: 'game_over', winner: s.winner });
      }
    }
  }

  // ---------------------------------------------------------------- reminders / log

  _remind(p, needles, trigger) {
    for (const iid of this.player(p).battlefield) this._remindCard(this.card(iid), needles, trigger);
  }

  _remindCard(c, needles, trigger, also = []) {
    const d = this.data(c);
    if (!d) return;
    const t = d.searchText;
    for (const n of needles) {
      if (t.includes(fold(n))) {
        if (also.length && !also.some((a) => t.includes(a))) return;
        this._emit({ type: 'reminder', iid: c.iid, trigger, p: c.controller });
        return;
      }
    }
  }

  _pname(p) {
    return this.state.players[p]?.name ?? '?';
  }

  _log(text) {
    this.state.log.push(text);
    if (this.state.log.length > 400) this.state.log.shift();
    this._emit({ type: 'log', text });
  }

  _emit(ev) {
    this.onEvent(ev);
  }
}

/** Hand and library are hidden zones: only their owner may act on those cards. */
function isHidden(c) {
  return c.zone === Zone.HAND || c.zone === Zone.LIBRARY;
}

function resetBattleState(c) {
  Object.assign(c, {
    tapped: false, sick: false, counters: {}, damage: 0, tempPower: 0, tempToughness: 0, attacking: false, blocking: -1,
    attachedTo: -1, xValue: 0, ovPower: null, ovToughness: null, lethalMarked: false,
  });
}

/** True when `order` holds each index 0..n-1 exactly once. */
function isPermutation(order, n) {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Uint8Array(n);
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen[i]) return false;
    seen[i] = 1;
  }
  return true;
}

/** An absent or empty order means "no shuffle" (local tests); anything else must be a permutation. */
function optionalPermutation(order, n) {
  return order == null || (Array.isArray(order) && order.length === 0) || isPermutation(order, n);
}

/** Fail-closed: validate() rejects bad orders, so reaching here with one is a bug, never a silent no-shuffle. */
function permute(items, order) {
  if (order == null || order.length === 0) return [...items];
  if (!isPermutation(order, items.length)) throw new RangeError(BAD_ORDER);
  return order.map((i) => items[i]);
}

/**
 * Copy of the state without what `seat` must not know (F-5): identity and marks of the other players'
 * library cards and unrevealed hand cards, and the order of their libraries. Cards in `show` stay visible
 * (a hand revealed by this very command). The log is trimmed: the peer builds its own from the events.
 */
export function redactFor(state, seat, show = []) {
  const out = JSON.parse(JSON.stringify(state));
  const visible = new Set(show);
  for (const c of Object.values(out.cards)) {
    if (c.owner === seat || visible.has(c.iid) || c.revealed) continue;
    if (c.zone === Zone.LIBRARY || c.zone === Zone.HAND) {
      Object.assign(c, { uid: '', counters: {}, ovPower: null, ovToughness: null, xValue: 0, attachedTo: -1 });
    }
  }
  out.players.forEach((ps, i) => {
    if (i !== seat) ps.library = [...ps.library].sort((a, b) => a - b);
  });
  out.log = out.log.slice(-30);
  return out;
}

/** Fisher–Yates permutation of n indexes using the given random function. */
export function randomOrder(n, rnd = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

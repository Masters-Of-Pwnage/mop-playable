/**
 * Simple, rules-aware opponent for practice games. It plays lands, pays costs,
 * drops permanents, attacks and blocks with a risk heuristic. It never casts
 * instants/sorceries because their effects are free text players resolve by hand.
 */
import { Kind } from './cards.js';
import { Phase, Stage, Zone, HAND_LIMIT } from './engine.js';
import { ANY } from './mana.js';

export class AIPlayer {
  constructor(seat = 1) {
    this.seat = seat;
  }

  /** Returns the next command this AI wants to submit, or null when waiting. */
  decide(engine) {
    const s = engine.state;
    const me = this.seat;
    if (!s.players.length) return null;
    if (s.stage === Stage.MULLIGAN) return s.players[me].kept ? null : this._mulligan(engine);
    if (s.stage !== Stage.PLAY) return null;
    if (s.phase === Phase.BLOCK && engine.defendingPlayer() === me) return { t: 'block', p: me, blocks: this._chooseBlocks(engine) };
    if (s.active !== me || s.stack.length) return null;
    switch (s.phase) {
      case Phase.MAIN1:
      case Phase.MAIN2: {
        const land = this._bestLand(engine);
        if (land >= 0) return { t: 'play', p: me, iid: land };
        const spell = this._bestCastable(engine);
        if (spell >= 0) return { t: 'play', p: me, iid: spell };
        if (s.phase === Phase.MAIN1) return { t: 'attack', p: me, attackers: this._chooseAttackers(engine) };
        const ps = s.players[me];
        if (ps.hand.length > HAND_LIMIT) return { t: 'move', p: me, iid: this._worstCard(engine, ps.hand), zone: Zone.GRAVEYARD };
        return { t: 'end_turn', p: me };
      }
      case Phase.ATTACK: return { t: 'attack', p: me, attackers: this._chooseAttackers(engine) };
      case Phase.DAMAGE: return { t: 'damage', p: me };
      case Phase.END: return { t: 'end_turn', p: me };
      default: return null;
    }
  }

  _mulligan(engine) {
    const s = engine.state;
    const ps = s.players[this.seat];
    const lands = ps.hand.filter((iid) => engine.isLand(engine.card(iid))).length;
    if (ps.mulligans < 2 && (lands < 2 || lands > ps.hand.length - 2)) return { t: 'mulligan', p: this.seat };
    const value = (iid) => {
      const c = engine.card(iid);
      if (engine.isLand(c)) return lands <= 3 ? 5 : 1;
      return 6 - (engine.data(c)?.manaValue || 0);
    };
    const ranked = [...ps.hand].sort((a, b) => value(a) - value(b));
    return { t: 'keep', p: this.seat, bottom: ranked.slice(0, ps.mulligans) };
  }

  _bestLand(engine) {
    const s = engine.state;
    const ps = s.players[this.seat];
    if (ps.landsPlayed >= 1) return -1;
    const wanted = {};
    for (const iid of ps.hand) {
      const c = engine.card(iid);
      if (!engine.isLand(c)) for (const col of engine.data(c)?.colors || []) wanted[col] = (wanted[col] | 0) + 1;
    }
    let best = -1;
    let bestScore = -1;
    for (const iid of ps.hand) {
      const c = engine.card(iid);
      if (!engine.isLand(c) || engine.canPlay(this.seat, iid) !== '') continue;
      const prod = engine.data(c).produces;
      let score = 1;
      if (prod.length === 0 || prod.includes(ANY)) score += 2;
      for (const col of prod) score += (wanted[col] | 0) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = iid;
      }
    }
    return best;
  }

  _bestCastable(engine) {
    const ps = engine.state.players[this.seat];
    let best = -1;
    let bestScore = -1;
    for (const iid of ps.hand) {
      const c = engine.card(iid);
      const d = engine.data(c);
      if (!d || engine.isLand(c) || !d.isPermanent) continue;
      if (engine.canPlay(this.seat, iid) !== '') continue;
      let score = d.manaValue * 2;
      if (d.kind === Kind.CREATURE) score += 3 + d.power + d.toughness * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = iid;
      }
    }
    return best;
  }

  _chooseAttackers(engine) {
    const s = engine.state;
    const me = this.seat;
    const opp = 1 - me;
    const mine = s.players[me].battlefield.filter((iid) => engine.canAttackWith(iid) && engine.power(engine.card(iid)) > 0);
    if (!mine.length) return [];
    const blockers = [];
    let oppPower = 0;
    for (const iid of s.players[opp].battlefield) {
      const c = engine.card(iid);
      if (engine.isCreature(c)) {
        oppPower += Math.max(engine.power(c), 0);
        if (!c.tapped) blockers.push(iid);
      }
    }
    const total = mine.reduce((t, iid) => t + engine.power(engine.card(iid)), 0);
    const maxBlocker = blockers.reduce((m, iid) => Math.max(m, engine.power(engine.card(iid))), 0);
    if (!blockers.length || total >= s.players[opp].life + maxBlocker * 2) return mine;
    const out = [];
    for (const iid of mine) {
      const a = engine.card(iid);
      let safe = true;
      for (const bIid of blockers) {
        const b = engine.card(bIid);
        if (engine.hasKeyword(a, 'flying') && !(engine.hasKeyword(b, 'flying') || engine.hasKeyword(b, 'reach'))) continue;
        if (engine.power(b) >= engine.toughness(a) && engine.toughness(b) > engine.power(a)) {
          safe = false;
          break;
        }
      }
      if (safe) out.push(iid);
    }
    if (oppPower >= s.players[me].life && out.length === mine.length && out.length) {
      out.sort((x, y) => engine.toughness(engine.card(x)) - engine.toughness(engine.card(y)));
      out.pop();
    }
    return out;
  }

  _chooseBlocks(engine) {
    const s = engine.state;
    const me = this.seat;
    const attackers = [...engine.attackers()].sort((a, b) => engine.power(engine.card(b)) - engine.power(engine.card(a)));
    const mine = s.players[me].battlefield.filter((iid) => engine.isCreature(engine.card(iid)) && !engine.card(iid).tapped);
    let incoming = attackers.reduce((t, iid) => t + Math.max(engine.power(engine.card(iid)), 0), 0);
    const life = s.players[me].life;
    const used = new Set();
    const blocks = [];
    for (const aIid of attackers) {
      const a = engine.card(aIid);
      if (engine.hasKeyword(a, 'menace')) continue;
      let choice = -1;
      for (const bIid of mine) {
        if (used.has(bIid) || !engine.canBlock(bIid, aIid)) continue;
        const b = engine.card(bIid);
        if (engine.toughness(b) > engine.power(a) && (engine.power(b) >= engine.toughness(a) || engine.hasKeyword(b, 'deathtouch'))) {
          choice = bIid;
          break;
        }
      }
      if (choice === -1 && engine.power(a) >= 2) {
        for (const bIid of mine) {
          if (used.has(bIid) || !engine.canBlock(bIid, aIid)) continue;
          if (engine.toughness(engine.card(bIid)) > engine.power(a)) {
            choice = bIid;
            break;
          }
        }
      }
      if (choice === -1 && incoming >= life) {
        let cheapest = -1;
        for (const bIid of mine) {
          if (used.has(bIid) || !engine.canBlock(bIid, aIid)) continue;
          if (cheapest === -1 || engine.power(engine.card(bIid)) < engine.power(engine.card(cheapest))) cheapest = bIid;
        }
        choice = cheapest;
      }
      if (choice !== -1) {
        used.add(choice);
        blocks.push([choice, aIid]);
        incoming -= Math.max(engine.power(a), 0);
      }
    }
    return blocks;
  }

  _worstCard(engine, hand) {
    const s = engine.state;
    const lands = s.players[this.seat].battlefield.filter((iid) => engine.isLand(engine.card(iid))).length;
    let worst = hand[0];
    let worstScore = Infinity;
    for (const iid of hand) {
      const c = engine.card(iid);
      const d = engine.data(c);
      let score;
      if (engine.isLand(c)) score = lands >= 6 ? 1 : 8;
      else if (!d?.isPermanent) score = 0.5;
      else score = 10 - Math.abs(d.manaValue - lands);
      if (score < worstScore) {
        worstScore = score;
        worst = iid;
      }
    }
    return worst;
  }
}

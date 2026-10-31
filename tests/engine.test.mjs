import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCost, parseProduction, planPayment, makeSource, emptyPool } from '../src/engine/mana.js';
import { buildLibrary, filterCards, Kind } from '../src/engine/cards.js';
import { GameEngine, Zone, Phase, Stage, DISCARD, randomOrder } from '../src/engine/engine.js';
import { AIPlayer } from '../src/engine/ai.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'public/cards.json'), 'utf8'));
const library = buildLibrary(raw);
const byUid = new Map(library.map((c) => [c.uid, c]));
const lookup = (uid) => byUid.get(uid);
const byName = (n) => library.find((c) => c.name === n);
const find = (pred) => library.find(pred);
const land = (color) => find((c) => c.kind === Kind.LAND && c.produces.length === 1 && c.produces[0] === color);
const creature = (maxMv, extra = () => true) => find((c) => c.kind === Kind.CREATURE && c.hasPT && c.toughness > 0
  && c.manaValue <= maxMv && c.manaValue > 0 && c.cost.any === 0 && c.cost.hybrid.length === 0 && extra(c));
const filler = (n) => Array(n).fill(land('B').uid);

/** Engine with both players past mulligan, in player 0's main phase 1. */
function started(deck0, deck1, enforce = true) {
  const e = new GameEngine(lookup);
  assert.equal(e.execute({ t: 'setup', first: 0, enforce, life: 20, players: [{ name: 'A', deck: deck0 }, { name: 'B', deck: deck1 }] }), '');
  assert.equal(e.execute({ t: 'keep', p: 0, bottom: [] }), '');
  assert.equal(e.execute({ t: 'keep', p: 1, bottom: [] }), '');
  return e;
}

function put(e, p, uid, zone) {
  const ps = e.state.players[p];
  for (const iid of [...ps.library, ...ps.hand]) {
    const c = e.card(iid);
    if (c.uid === uid && c.zone !== Zone.BATTLEFIELD) {
      e.execute({ t: 'move', p, iid, zone });
      return iid;
    }
  }
  return -1;
}

test('cost parser handles every format in the library', () => {
  assert.equal(parseCost('{2}{U}{B}').manaValue(), 4);
  assert.equal(parseCost('2{U}').manaValue(), 3);
  assert.equal(parseCost('3{B}{B}').colored.B, 2);
  assert.equal(parseCost('{3},{B},{R}').manaValue(), 5);
  assert.equal(parseCost('{2}{w}{w}').colored.W, 2);
  assert.equal(parseCost('3️⚫⚫').colored.B, 2);
  assert.equal(parseCost('1⚪🔵🔱').manaValue(), 4);
  assert.equal(parseCost('{X}{R}{R}').x, 1);
  assert.equal(parseCost('2{R/U}').hybrid.length, 1);
  assert.equal(parseCost('').isEmpty, true);
  assert.equal(parseCost(null).isEmpty, true);
  assert.deepEqual(parseCost('{0}').symbols(), ['0']);
  for (const c of library) assert.ok(c.manaValue >= 0, c.name); // "2600 The Hacker Quarterly" really costs 2600
});

test('land production parsing', () => {
  assert.deepEqual(parseProduction('{t}, Adicione {G} ou {B}'), ['G', 'B']);
  assert.deepEqual(parseProduction('{C}: Adicione {W}, {U} ou {B} de mana.'), ['W', 'U', 'B']);
  assert.deepEqual(parseProduction('1, Ƈ: Adicione ② manas de qualquer cor.'), ['*']);
  assert.deepEqual(parseProduction('Conferencia / BSidesSP'), []);
});

test('payment planning', () => {
  const sources = [makeSource(1, ['U']), makeSource(2, ['R'])];
  assert.equal(planPayment(parseCost('{1}{U}'), 0, emptyPool(), sources).taps.length, 2);
  assert.equal(planPayment(parseCost('{U}{U}'), 0, emptyPool(), sources), null);
  assert.ok(planPayment(parseCost('{U}{U}'), 0, emptyPool(), [makeSource(3, ['*']), makeSource(4, ['U'])]));
  const pool = emptyPool();
  pool.B = 2;
  assert.ok(planPayment(parseCost('{1}{B}'), 0, pool, []));
  assert.equal(planPayment(parseCost('{X}{R}'), 3, emptyPool(), [makeSource(1, ['R'])]), null);
});

test('library: classification, keywords, duplicate ids, filters', () => {
  assert.ok(library.length >= 300);
  assert.equal(new Set(library.map((c) => c.uid)).size, library.length, 'unique uids');
  assert.equal(byName('Hakai').kind, Kind.LAND);
  assert.equal(byName('RedZone').kind, Kind.LAND);
  assert.equal(byName('0-Day Exploit').kind, Kind.INSTANT);
  assert.equal(byName('0-Day Exploit').raw.cost, '{B}{B}{1}', 'raw json untouched');
  const abin = byName('Agente da ABIN');
  assert.equal(abin.kind, Kind.CREATURE);
  assert.equal(abin.power, 2);
  assert.equal(abin.manaValue, 5);
  const ave = byName('Ave de Rapina');
  if (ave) assert.ok(ave.keywords.vigilance && ave.keywords.flying);
  for (const c of library) if (c.name.startsWith('BTTng')) assert.ok(!c.keywords.menace, 'ameaças is not Ameaça');
  const dup = library.filter((c) => c.id === '09dda57d-b23c-4de9-b5c7-af96cd797559');
  assert.equal(dup.length, 4);
  assert.equal(lookup('09dda57d-b23c-4de9-b5c7-af96cd797559').name, 'AlligatorCon');
  const creatures = filterCards(library, { types: ['Criatura'] });
  assert.ok(creatures.length > 100 && creatures.every((c) => c.searchType.includes('criatura')));
  assert.ok(filterCards(library, { types: ['Terreno'] }).some((c) => c.name === 'RedZone'));
  assert.ok(filterCards(library, { manas: ['{U}'], costMin: 2, costMax: 3 }).every((c) => (c.cost.colored.U > 0 || c.cost.hybrid.some((h) => h.includes('U'))) && c.manaValue >= 2 && c.manaValue <= 3));
  assert.equal(filterCards(library, { name: 'agente da abin' }).length, 1);
});

test('setup, first turn, lands once per turn', () => {
  const e = started(filler(30), filler(30));
  const s = e.state;
  assert.equal(s.stage, Stage.PLAY);
  assert.equal(s.phase, Phase.MAIN1);
  assert.equal(s.players[0].hand.length, 7, 'first player does not draw on turn 1');
  assert.equal(s.players[0].library.length, 23);
  const hand = s.players[0].hand;
  assert.equal(e.execute({ t: 'play', p: 0, iid: hand[0] }), '');
  assert.notEqual(e.execute({ t: 'play', p: 0, iid: hand[0] }), '', 'second land rejected');
  assert.notEqual(e.execute({ t: 'play', p: 1, iid: s.players[1].hand[0] }), '', 'not your turn');
});

test('mulligan requires bottoming cards', () => {
  const e = new GameEngine(lookup);
  e.execute({ t: 'setup', first: 1, players: [{ name: 'A', deck: filler(30) }, { name: 'B', deck: filler(30) }] });
  assert.equal(e.execute({ t: 'mulligan', p: 0, order: randomOrder(30) }), '');
  assert.equal(e.state.players[0].hand.length, 7);
  assert.notEqual(e.execute({ t: 'keep', p: 0, bottom: [] }), '');
  assert.equal(e.execute({ t: 'keep', p: 0, bottom: [e.state.players[0].hand[0]] }), '');
  assert.equal(e.state.players[0].hand.length, 6);
  e.execute({ t: 'keep', p: 1, bottom: [] });
  assert.equal(e.state.active, 1);
});

test('casting a creature auto-pays by tapping lands', () => {
  const cr = creature(2, (c) => c.colors.length === 1 && c.colors[0] === 'B');
  assert.ok(cr);
  const e = started([...filler(20), cr.uid], filler(30));
  const ci = put(e, 0, cr.uid, Zone.HAND);
  assert.equal(e.canPlay(0, ci), 'Mana insuficiente.');
  for (let i = 0; i < cr.manaValue; i += 1) assert.notEqual(put(e, 0, land('B').uid, Zone.BATTLEFIELD), -1);
  assert.equal(e.execute({ t: 'play', p: 0, iid: ci }), '');
  assert.equal(e.card(ci).zone, Zone.BATTLEFIELD);
  assert.ok(e.card(ci).sick || cr.keywords.haste);
  const tapped = e.state.players[0].battlefield.filter((iid) => e.isLand(e.card(iid)) && e.card(iid).tapped).length;
  assert.equal(tapped, cr.manaValue);
});

test('combat: blocked and unblocked damage', () => {
  const big = creature(9, (c) => c.power >= 3 && c.toughness >= 3 && Object.keys(c.keywords).length === 0);
  const small = creature(9, (c) => c.power === 1 && c.toughness === 1 && Object.keys(c.keywords).length === 0);
  const e = started([...filler(20), big.uid], [...filler(20), small.uid]);
  const s = e.state;
  const a = put(e, 0, big.uid, Zone.BATTLEFIELD);
  const b = put(e, 1, small.uid, Zone.BATTLEFIELD);
  assert.notEqual(e.execute({ t: 'attack', p: 0, attackers: [a] }), '', 'summoning sick');
  e.card(a).sick = false;
  assert.equal(e.execute({ t: 'attack', p: 0, attackers: [a] }), '');
  assert.equal(s.phase, Phase.BLOCK);
  assert.equal(e.execute({ t: 'block', p: 1, blocks: [[b, a]] }), '');
  assert.equal(e.execute({ t: 'damage', p: 0 }), '');
  assert.equal(e.card(b).zone, Zone.GRAVEYARD);
  assert.equal(e.card(a).zone, Zone.BATTLEFIELD);
  assert.equal(s.players[1].life, 20);
  e.execute({ t: 'end_turn', p: 0 });
  e.execute({ t: 'end_turn', p: 1 });
  assert.equal(e.execute({ t: 'attack', p: 0, attackers: [a] }), '');
  if (s.phase === Phase.BLOCK) e.execute({ t: 'block', p: 1, blocks: [] });
  e.execute({ t: 'damage', p: 0 });
  assert.equal(s.players[1].life, 20 - e.power(e.card(a)));
});

test('tokens, damage wears off, life zero ends game, hand limit', () => {
  const e = started(filler(30), filler(30));
  const s = e.state;
  e.execute({ t: 'token', p: 0, name: 'Drone', power: 2, toughness: 2 });
  e.execute({ t: 'token', p: 1, name: 'Guard', power: 3, toughness: 3 });
  const drone = s.players[0].battlefield.at(-1);
  const guard = s.players[1].battlefield.at(-1);
  e.card(drone).sick = false;
  e.execute({ t: 'attack', p: 0, attackers: [drone] });
  e.execute({ t: 'block', p: 1, blocks: [[guard, drone]] });
  e.execute({ t: 'damage', p: 0 });
  assert.ok(!s.cards[drone], 'token ceased to exist');
  assert.equal(e.card(guard).damage, 2);
  e.execute({ t: 'draw', p: 0, n: 2 });
  assert.equal(e.execute({ t: 'end_turn', p: 0 }), DISCARD);
  e.execute({ t: 'move', p: 0, iid: s.players[0].hand[0], zone: Zone.GRAVEYARD });
  e.execute({ t: 'move', p: 0, iid: s.players[0].hand[0], zone: Zone.GRAVEYARD });
  assert.equal(e.execute({ t: 'end_turn', p: 0 }), '');
  assert.equal(e.card(guard).damage, 0);
  e.execute({ t: 'life', p: 1, delta: -20 });
  assert.equal(s.stage, Stage.OVER);
  assert.equal(s.winner, 0);
});

test('state round-trips through JSON (network sync)', () => {
  const e = started(filler(30), filler(30));
  const copy = new GameEngine(lookup);
  copy.load(JSON.parse(JSON.stringify(e.state)));
  assert.deepEqual(copy.state, e.state);
  assert.equal(copy.execute({ t: 'end_turn', p: 0 }), '');
  assert.equal(copy.state.active, 1);
});

test('AI self-play games finish', () => {
  const decks = JSON.parse(fs.readFileSync(path.join(root, 'src/data/starter-decks.json'), 'utf8'));
  assert.ok(decks.length >= 5);
  const expand = (d) => d.cards.flatMap((c) => Array(c.amount).fill(c.uid)).filter((uid) => byUid.has(uid));
  let finished = 0;
  for (let g = 0; g < 6; g += 1) {
    let seed = 1000 + g;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const e = new GameEngine(lookup);
    const d0 = expand(decks[g % decks.length]);
    const d1 = expand(decks[(g + 1) % decks.length]);
    assert.equal(e.execute({
      t: 'setup', first: g % 2, orders: [randomOrder(d0.length, rnd), randomOrder(d1.length, rnd)],
      players: [{ name: 'IA0', deck: d0, ai: true }, { name: 'IA1', deck: d1, ai: true }],
    }), '');
    const ais = [new AIPlayer(0), new AIPlayer(1)];
    let steps = 0;
    while (e.state.stage !== Stage.OVER && steps < 3000 && e.state.turn < 60) {
      let acted = false;
      for (const ai of ais) {
        const cmd = ai.decide(e);
        if (!cmd) continue;
        if (cmd.t === 'mulligan') {
          const ps = e.state.players[ai.seat];
          cmd.order = randomOrder(ps.library.length + ps.hand.length, rnd);
        }
        const err = e.execute(cmd);
        assert.equal(err, '', `${JSON.stringify(cmd)} -> ${err}`);
        acted = true;
        steps += 1;
        break;
      }
      assert.ok(acted, `nobody can act at phase ${e.state.phase} turn ${e.state.turn}`);
    }
    if (e.state.stage === Stage.OVER) finished += 1;
  }
  assert.ok(finished >= 4, `${finished}/6 games finished`);
});

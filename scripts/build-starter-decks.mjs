#!/usr/bin/env node
/**
 * Generates the pre-built starter decks (src/data/starter-decks.json) from the
 * card library, plus the H2HC 2024 champion deck from decks/h2hc-2024.json.
 * Deterministic, so re-running after new cards are added keeps decks stable.
 *   node scripts/build-cards.mjs && node scripts/build-starter-decks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary, Kind } from '../src/engine/cards.js';
import { ANY } from '../src/engine/mana.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = buildLibrary(JSON.parse(fs.readFileSync(path.join(root, 'public/cards.json'), 'utf8')));

const THEMES = [
  { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Black Hat', subtitle: 'Preto / Vermelho', colors: ['B', 'R'] },
  { id: 'c0ffee00-0000-4000-8000-000000000002', name: 'Blue Team', subtitle: 'Azul / Branco', colors: ['U', 'W'] },
  { id: 'c0ffee00-0000-4000-8000-000000000003', name: 'Underground', subtitle: 'Azul / Preto', colors: ['U', 'B'] },
  { id: 'c0ffee00-0000-4000-8000-000000000004', name: 'Hacktivistas', subtitle: 'Vermelho / Verde', colors: ['R', 'G'] },
  { id: 'c0ffee00-0000-4000-8000-000000000005', name: 'Purple Team', subtitle: 'Branco / Preto', colors: ['W', 'B'] },
];
const LANDS = 24;
const SPELLS = 36;

function score(c) {
  let s;
  switch (c.kind) {
    case Kind.CREATURE:
      s = (c.hasPT ? 10 : 5) + Math.min(c.power + c.toughness, 10) * 0.6 + Object.keys(c.keywords).length * 1.5;
      break;
    case Kind.PLANESWALKER: s = 8; break;
    case Kind.INSTANT: case Kind.SORCERY: s = 6; break;
    default: s = 5;
  }
  if (c.manaValue === 0 || c.manaValue > 7 || c.cost.any > 0) s -= 6;
  return s - Math.abs(c.manaValue - 3) * 0.6;
}

function build(theme) {
  const pool = library
    .filter((c) => c.kind !== Kind.LAND && c.kind !== Kind.OTHER && c.colors.length && c.colors.every((col) => theme.colors.includes(col)))
    .sort((a, b) => score(b) - score(a) || a.searchName.localeCompare(b.searchName));
  const entries = new Map();
  const perKind = {};
  const limits = { [Kind.INSTANT]: 8, [Kind.SORCERY]: 4 };
  let total = 0;
  for (const passCopies of [2, 3]) {
    for (const c of pool) {
      if (total >= SPELLS) break;
      const have = entries.get(c.uid) | 0;
      const cap = c.manaValue <= 4 ? passCopies : 2;
      if (have >= cap) continue;
      if (limits[c.kind] !== undefined && (perKind[c.kind] | 0) >= limits[c.kind]) continue;
      const add = Math.min(cap - have, SPELLS - total);
      entries.set(c.uid, have + add);
      perKind[c.kind] = (perKind[c.kind] | 0) + add;
      total += add;
    }
  }
  const colored = [];
  const wild = [];
  for (const c of library) {
    if (c.kind !== Kind.LAND) continue;
    if (!c.produces.length || c.produces.includes(ANY)) wild.push(c);
    else if (c.produces.some((col) => theme.colors.includes(col))) colored.push(c);
  }
  let lands = 0;
  for (const c of colored) {
    if (lands >= LANDS - 6) break;
    const n = Math.min(4, LANDS - 6 - lands);
    entries.set(c.uid, n);
    lands += n;
  }
  for (let i = 0; lands < LANDS && wild.length; i += 1) {
    const c = wild[i % wild.length];
    entries.set(c.uid, (entries.get(c.uid) | 0) + 1);
    lands += 1;
  }
  return {
    id: theme.id, name: theme.name, subtitle: theme.subtitle, author: 'Masters of Pwnage', author_social: '', builtin: true,
    cards: library.filter((c) => entries.has(c.uid)).map((c) => ({ uid: c.uid, id: c.id, name: c.name, amount: entries.get(c.uid) })),
  };
}

function h2hc() {
  const src = JSON.parse(fs.readFileSync(path.join(root, 'decks/h2hc-2024.json'), 'utf8'));
  const byId = new Map();
  for (const c of library) if (!byId.has(c.id)) byId.set(c.id, c);
  const cards = [];
  for (const e of src.cards) {
    const c = byId.get(String(e.id));
    if (c) cards.push({ uid: c.uid, id: c.id, name: c.name, amount: Number(e.amount ?? e.ammount ?? 0) });
  }
  return { id: 'c0ffee00-0000-4000-8000-000000002024', name: src.name || 'Deck campeão H2HC 2024', subtitle: 'Deck campeão', author: src.author || '', author_social: src.author_social || '', builtin: true, cards };
}

const decks = [...THEMES.map(build), h2hc()];
fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/data/starter-decks.json'), JSON.stringify(decks, null, 2));
for (const d of decks) console.log(`${d.name}: ${d.cards.reduce((t, c) => t + c.amount, 0)} cartas`);

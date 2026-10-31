import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from '../db.js';
// The rules engine is plain JS shared with the browser (the Docker image copies src/engine too).
import { buildLibrary, Kind } from '../../../src/engine/cards.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STARTER_DECKS_FILE = path.resolve(here, '../../../src/data/starter-decks.json');
export const RARITIES = ['comum', 'incomum', 'rara', 'mitica', 'lendaria'];
export const DEFAULT_MAX_COPIES = 4; // MAX_COPIES of src/stores/decks.js

const isCharacter = (card) => card.kind === Kind.CREATURE || card.kind === Kind.PLANESWALKER || /player card/i.test(card.typeLine);

/** First values of a card that just appeared in cards.json (docs/sdd/02-economia.md §3, D5). */
export function seedFor(card) {
  let rarity = 'comum';
  if (card.kind === Kind.PLANESWALKER) rarity = 'mitica';
  else if (card.isLegendary) rarity = /m[ií]tic/i.test(card.typeLine) ? 'mitica' : 'lendaria';
  const playerCard = /player card/i.test(card.typeLine);
  return {
    rarity: card.kind === Kind.LAND ? 'comum' : rarity,
    availability: playerCard ? 'evento' : 'loja',
    tradeable: playerCard ? 0 : 1,
    // The owner confirmed that every person portrayed authorized the animation (D5, 2026-10-31).
    animation_consent: isCharacter(card) ? 'concedido' : 'nao_se_aplica',
  };
}

/** Reads the built card list (dist/cards.json in the image, public/cards.json in dev). */
export function loadLibrary(config) {
  const candidates = [config.cardsFile, path.join(config.staticDir, 'cards.json'), path.resolve(here, '../../../public/cards.json')].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards : Object.values(data);
  return buildLibrary(raw);
}

/**
 * Brings card_catalog in line with the card files: new cards get seed values, renamed ones are
 * updated, vanished ones are flagged orphan (never deleted: players may own them).
 */
export function syncCatalog(db, library) {
  const now = Date.now();
  return transaction(db, () => {
    const known = new Set(db.prepare('SELECT uid FROM card_catalog').all().map((r) => r.uid));
    let added = 0;
    for (const card of library) {
      if (known.has(card.uid)) {
        db.prepare('UPDATE card_catalog SET name = ?, kind = ?, orphan = 0 WHERE uid = ?').run(card.name, card.kind, card.uid);
        continue;
      }
      const s = seedFor(card);
      db.prepare(`INSERT INTO card_catalog (uid, name, kind, rarity, availability, tradeable, animation_consent, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(card.uid, card.name, card.kind, s.rarity, s.availability, s.tradeable, s.animation_consent, now);
      added += 1;
    }
    const present = new Set(library.map((c) => c.uid));
    let orphans = 0;
    for (const uid of known) {
      if (!present.has(uid)) {
        db.prepare('UPDATE card_catalog SET orphan = 1 WHERE uid = ?').run(uid);
        orphans += 1;
      }
    }
    return { added, orphans, total: library.length };
  });
}

/**
 * Cards granted on signup: one copy of every non-land card of the starter decks, and as many
 * cyberlands as the deck that uses the most of each (so any starter deck can be rebuilt).
 */
export function starterCollection(library, decks) {
  const byUid = new Map(library.map((c) => [c.uid, c]));
  const grant = new Map();
  for (const deck of decks) {
    for (const e of deck.cards || []) {
      const card = byUid.get(e.uid) || byUid.get(e.id);
      if (!card) continue;
      const amount = card.kind === Kind.LAND ? Number(e.amount) || 0 : 1;
      grant.set(card.uid, Math.max(grant.get(card.uid) || 0, amount));
    }
  }
  return [...grant].filter(([, n]) => n > 0).map(([uid, qty]) => ({ uid, qty }));
}

export function rarityDefaults(db) {
  return Object.fromEntries(db.prepare('SELECT * FROM rarity_defaults').all().map((r) => [r.rarity, r]));
}

/**
 * Price, sell price and copy limit actually in force for a catalog row. The sell price never goes
 * above the price, whatever mix of card override and rarity default produced it: buy-and-sell
 * must never create credits (pentest N-6).
 */
export function effective(row, defaults) {
  const d = defaults[row.rarity];
  const price = row.price_credits ?? d.price_credits;
  return {
    price,
    sellPrice: Math.min(row.sell_credits ?? d.sell_credits, price),
    maxOwned: row.max_owned ?? (row.kind === Kind.LAND ? null : DEFAULT_MAX_COPIES),
  };
}

/** Why a catalog row cannot be bought right now ('' = it can). */
export function unavailableReason(row, now = Date.now()) {
  if (row.orphan || row.availability !== 'loja') return 'not_available';
  if (row.available_from !== null && now < row.available_from) return 'not_available_yet';
  if (row.available_until !== null && now >= row.available_until) return 'not_available';
  if (row.stock_total !== null && row.stock_sold >= row.stock_total) return 'sold_out';
  return '';
}

/** Public catalog entry (GET /api/catalog). */
export function publicEntry(row, defaults, now = Date.now()) {
  const e = effective(row, defaults);
  return {
    uid: row.uid,
    rarity: row.rarity,
    price: e.price,
    sellPrice: e.sellPrice,
    availability: row.availability,
    buyable: unavailableReason(row, now) === '',
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    stockLeft: row.stock_total === null ? null : row.stock_total - row.stock_sold,
    perUserLimit: row.per_user_limit,
    maxOwned: e.maxOwned,
    tradeable: Boolean(row.tradeable),
    animation: null,
  };
}

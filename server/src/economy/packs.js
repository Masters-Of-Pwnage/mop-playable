import { randomInt } from 'node:crypto';
import { transaction } from '../db.js';
import { effective, RARITIES, rarityDefaults } from './catalog.js';
import { EconomyError, post, SHOP, userOwner } from './ledger.js';
import { getSetting } from './settings.js';

export const RARE_PLUS = ['rara', 'mitica', 'lendaria'];
export const MAX_PACK_CARDS = 20;
const DAY_MS = 24 * 3600 * 1000;

/** Validates slots: [{count, odds: {rarity: weight}}], at most 20 cards, each slot with some weight. */
export function parseSlots(slots) {
  if (!Array.isArray(slots) || !slots.length || slots.length > 15) return null;
  let total = 0;
  const out = [];
  for (const s of slots) {
    if (!s || !Number.isInteger(s.count) || s.count < 1 || s.count > 15 || !s.odds || typeof s.odds !== 'object') return null;
    const odds = {};
    let sum = 0;
    for (const [r, w] of Object.entries(s.odds)) {
      if (!RARITIES.includes(r) || !Number.isSafeInteger(w) || w < 0) return null;
      if (w > 0) odds[r] = w;
      sum += w;
    }
    if (!sum) return null;
    total += s.count;
    out.push({ count: s.count, odds });
  }
  return total <= MAX_PACK_CARDS ? out : null;
}

/**
 * Cards that can come out of packs, by rarity, weighted by pack_weight. Limited-stock cards stay out
 * of packs (their stock belongs to the shop).
 */
export function pools(db) {
  const out = Object.fromEntries(RARITIES.map((r) => [r, []]));
  for (const row of db.prepare('SELECT uid, name, rarity, pack_weight FROM card_catalog WHERE pack_weight > 0 AND orphan = 0 AND stock_total IS NULL ORDER BY uid').all()) {
    out[row.rarity].push({ uid: row.uid, name: row.name, weight: row.pack_weight });
  }
  return out;
}

/** Probabilities in force for one slot: rarities without cards are left out and the rest renormalized. */
export function slotOdds(slot, pool, only = null) {
  const entries = Object.entries(slot.odds).filter(([r, w]) => w > 0 && pool[r].length && (!only || only.includes(r)));
  const sum = entries.reduce((n, [, w]) => n + w, 0);
  return sum ? entries.map(([rarity, w]) => ({ rarity, p: w / sum, weight: w })) : [];
}

/** Public odds (RF-2.25): per slot, per rarity and per card. */
export function publicOdds(slots, pool) {
  return slots.map((slot) => {
    const rarities = slotOdds(slot, pool);
    return {
      count: slot.count,
      rarities: rarities.map(({ rarity, p }) => ({ rarity, p })),
      cards: rarities.flatMap(({ rarity, p }) => {
        const total = pool[rarity].reduce((n, c) => n + c.weight, 0);
        return pool[rarity].map((c) => ({ uid: c.uid, name: c.name, rarity, p: (p * c.weight) / total }));
      }),
    };
  });
}

function pick(items, weightOf, rnd) {
  const total = items.reduce((n, it) => n + weightOf(it), 0);
  let x = rnd(total);
  for (const it of items) {
    x -= weightOf(it);
    if (x < 0) return it;
  }
  return items[items.length - 1];
}

/**
 * Draws one pack. `forceRare` (pity, RF-2.27) turns the last card into rare or better when nothing
 * rare came out. `rnd(n)` returns an integer in [0, n) (crypto.randomInt by default).
 */
export function drawPack(slots, pool, { forceRare = false, rnd = randomInt } = {}) {
  const cards = [];
  let lastSlot = null;
  for (const slot of slots) {
    const odds = slotOdds(slot, pool);
    if (!odds.length) continue;
    lastSlot = slot;
    for (let i = 0; i < slot.count; i += 1) {
      const { rarity } = pick(odds, (o) => o.weight, rnd);
      const card = pick(pool[rarity], (c) => c.weight, rnd);
      cards.push({ uid: card.uid, rarity });
    }
  }
  let pity = false;
  if (forceRare && cards.length && !cards.some((c) => RARE_PLUS.includes(c.rarity))) {
    let odds = lastSlot ? slotOdds(lastSlot, pool, RARE_PLUS) : [];
    if (!odds.length) odds = RARE_PLUS.filter((r) => pool[r].length).map((rarity) => ({ rarity, weight: 1 }));
    if (odds.length) {
      const { rarity } = pick(odds, (o) => o.weight, rnd);
      const card = pick(pool[rarity], (c) => c.weight, rnd);
      cards[cards.length - 1] = { uid: card.uid, rarity };
      pity = true;
    }
  }
  return { cards, pity };
}

/**
 * Opens a pack (RF-2.23..2.30): credits only, adults only, draw inside the write transaction, copies
 * above max_owned become their sell-back price in credits.
 */
export function openPack(db, user, productId, expectedPrice, clientKey, { now = Date.now(), rnd = randomInt } = {}) {
  const key = `pack_open:${user.id}:${clientKey}`;
  return transaction(db, () => {
    const prior = db.prepare('SELECT t.*, o.id AS opening FROM ledger_tx t LEFT JOIN pack_openings o ON o.tx_id = t.id WHERE t.idempotency_key = ?').get(key);
    if (prior) return { opening: db.prepare('SELECT * FROM pack_openings WHERE id = ?').get(prior.opening), replayed: true };
    if (user.adult_confirmed_at === null) throw new EconomyError('adult_required', 403);
    const product = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(productId);
    if (!product || !product.active) throw new EconomyError('not_available', 404);
    if (product.available_from !== null && now < product.available_from) throw new EconomyError('not_available_yet', 409);
    if (product.available_until !== null && now >= product.available_until) throw new EconomyError('not_available', 409);
    if (expectedPrice !== product.price_credits) throw new EconomyError('price_changed', 409, { price: product.price_credits });
    if (product.daily_limit !== null) {
      const opened = db.prepare('SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ? AND product_id = ? AND created_at >= ?').get(user.id, product.id, now - DAY_MS).n;
      if (opened >= product.daily_limit) throw new EconomyError('limit_reached', 409);
    }
    const pool = pools(db);
    const pityRow = db.prepare('SELECT since_rare FROM pack_pity WHERE user_id = ? AND product_id = ?').get(user.id, product.id);
    const since = pityRow?.since_rare || 0;
    const { cards, pity } = drawPack(JSON.parse(product.slots), pool, { forceRare: since + 1 >= getSetting(db, 'packs.pity_n'), rnd });
    if (!cards.length) throw new EconomyError('not_available', 409);

    const defaults = rarityDefaults(db);
    const owned = new Map();
    let refund = 0;
    const moves = new Map();
    const result = cards.map((c) => {
      const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(c.uid);
      const e = effective(row, defaults);
      if (!owned.has(c.uid)) owned.set(c.uid, db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_uid = ?').get(user.id, c.uid)?.quantity || 0);
      if (e.maxOwned !== null && owned.get(c.uid) >= e.maxOwned) {
        refund += e.sellPrice;
        return { ...c, refund: e.sellPrice };
      }
      owned.set(c.uid, owned.get(c.uid) + 1);
      moves.set(c.uid, (moves.get(c.uid) || 0) + 1);
      return { ...c, refund: 0 };
    });
    const entries = [];
    if (product.price_credits > 0) entries.push({ owner: userOwner(user.id), currency: 'CR', amount: -product.price_credits }, { owner: SHOP, currency: 'CR', amount: product.price_credits });
    if (refund > 0) entries.push({ owner: SHOP, currency: 'CR', amount: -refund }, { owner: userOwner(user.id), currency: 'CR', amount: refund });
    const res = post(db, {
      kind: 'pack_open', key, actor: user.id, entries,
      cards: [...moves].map(([uid, delta]) => ({ userId: user.id, uid, delta })),
      meta: { product: product.id, version: product.version, price: product.price_credits, refund, pity },
    });
    const gotRare = result.some((c) => RARE_PLUS.includes(c.rarity));
    db.prepare(`INSERT INTO pack_pity (user_id, product_id, since_rare) VALUES (?, ?, ?)
                ON CONFLICT (user_id, product_id) DO UPDATE SET since_rare = excluded.since_rare`).run(user.id, product.id, gotRare ? 0 : since + 1);
    const openingId = Number(db.prepare('INSERT INTO pack_openings (user_id, product_id, version, tx_id, cards, pity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, product.id, product.version, res.tx.id, JSON.stringify(result), pity ? 1 : 0, now).lastInsertRowid);
    return { opening: db.prepare('SELECT * FROM pack_openings WHERE id = ?').get(openingId), replayed: false };
  });
}

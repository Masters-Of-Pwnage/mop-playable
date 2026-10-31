/**
 * Economy store: catalog (rarity, price, availability), wallet and collection of the logged-in
 * player, and the shop actions (docs/sdd/02-economia.md §7). The server decides everything;
 * this store only shows it and asks.
 */
import { reactive, readonly } from 'vue';
import { account, api } from './account.js';
import { getCard } from './cards.js';
import { Kind } from '../engine/cards.js';

export const RARITY_LABELS = { comum: 'Comum', incomum: 'Incomum', rara: 'Rara', mitica: 'Mítica', lendaria: 'Lendária' };
export const RARITIES = Object.keys(RARITY_LABELS);

const state = reactive({
  catalogLoaded: false,
  shopOpen: false,
  rarities: [],
  catalog: {}, // uid -> entry
  balances: { PWC: 0, CR: 0 },
  collection: {}, // uid -> qty
  mineLoaded: false,
  pwcToCr: 10,
  convertLeftToday: 0,
  wishlist: {}, // uid -> qty
});

export async function loadCatalog() {
  if (!account.enabled) return;
  // Revalidate: after a purchase or an admin edit the 60 s browser cache would show old prices.
  const data = await api('GET', '/catalog', undefined, { cache: 'no-cache' });
  state.shopOpen = data.shopOpen;
  state.rarities = data.rarities;
  state.catalog = Object.fromEntries(data.cards.map((c) => [c.uid, c]));
  state.catalogLoaded = true;
}

export async function loadMine() {
  if (!account.user) {
    state.mineLoaded = false;
    state.collection = {};
    state.balances = { PWC: 0, CR: 0 };
    return;
  }
  const [wallet, collection, wishlist] = await Promise.all([api('GET', '/me/wallet'), api('GET', '/me/collection'), api('GET', '/me/wishlist')]);
  state.balances = wallet.balances;
  state.pwcToCr = wallet.pwcToCr;
  state.convertLeftToday = wallet.convertLeftToday;
  state.wishlist = Object.fromEntries(wishlist.cards.map((c) => [c.uid, c.qty]));
  setCollection(collection.cards);
  state.mineLoaded = true;
}

function setCollection(cards) {
  state.collection = Object.fromEntries(cards.map((c) => [c.uid, c.qty]));
}

export const catalogFor = (uid) => state.catalog[uid] || null;
export const owned = (uid) => state.collection[uid] || 0;

/** Credits the player gets once per day (no-op when already claimed). */
export async function claimDaily() {
  const r = await api('POST', '/me/daily');
  state.balances = r.balances;
  return r;
}

/** items: [{uid, qty}] with the price shown to the player (the server refuses if it changed). */
export async function buy(items) {
  const body = { items: items.map(({ uid, qty }) => ({ uid, qty, expectedPrice: catalogFor(uid).price })) };
  try {
    const r = await api('POST', '/shop/buy', body);
    state.balances = r.balances;
    setCollection(r.cards);
    return r;
  } finally {
    loadCatalog().catch(() => {}); // stock and prices may have moved
  }
}

export async function sell(items) {
  const body = { items: items.map(({ uid, qty }) => ({ uid, qty, expectedPrice: catalogFor(uid).sellPrice })) };
  const r = await api('POST', '/shop/sell', body);
  state.balances = r.balances;
  setCollection(r.cards);
  return r;
}

/** PwnCoins -> credits at the rate the player saw (the server refuses if it changed). */
export async function convert(pwc) {
  const r = await api('POST', '/me/convert', { pwc, expectedRate: state.pwcToCr });
  state.balances = r.balances;
  state.convertLeftToday = Math.max(0, state.convertLeftToday - pwc);
  return r;
}

/** PwnCoins needed to cover `credits` missing, or 0 when the coins are not enough (R5: exact amount). */
export function pwcFor(credits) {
  if (credits <= 0) return 0;
  const need = Math.ceil(credits / state.pwcToCr);
  return need <= state.balances.PWC && need <= state.convertLeftToday ? need : 0;
}

export async function redeem(code) {
  const r = await api('POST', '/me/redeem', { code });
  state.balances = r.balances;
  loadMine().catch(() => {});
  return r;
}

export async function setWishlist(uid, qty) {
  const next = { ...state.wishlist };
  if (qty > 0) next[uid] = qty;
  else delete next[uid];
  await api('PUT', '/me/wishlist', { cards: Object.entries(next).map(([u, q]) => ({ uid: u, qty: q })) });
  state.wishlist = next;
}

export const wanted = (uid) => state.wishlist[uid] || 0;

/** Estimated value of one side of a trade (shop price of the cards + coins at the rate). */
export function sideValue(side) {
  return (side.pwc || 0) * state.pwcToCr + (side.cards || []).reduce((n, c) => n + (catalogFor(c.uid)?.price || 0) * c.qty, 0);
}

export function applyBalances(balances) {
  state.balances = balances;
}

/** Copies a deck needs beyond the collection, and what buying them would cost. */
export function shortfall(deck) {
  const items = [];
  const blocked = [];
  let total = 0;
  for (const e of deck.cards) {
    const missing = e.amount - owned(e.uid);
    if (missing <= 0) continue;
    const entry = catalogFor(e.uid);
    if (!entry || !entry.buyable) {
      blocked.push({ uid: e.uid, qty: missing });
      continue;
    }
    items.push({ uid: e.uid, qty: missing });
    total += entry.price * missing;
  }
  return { items, blocked, total, missing: items.reduce((n, i) => n + i.qty, 0) + blocked.reduce((n, i) => n + i.qty, 0) };
}

/** Copies above what a deck can use (4, or all but the lands' needs) that may be sold back. */
export function excess(uid) {
  const card = getCard(uid);
  const keep = card?.kind === Kind.LAND ? 20 : 4;
  return Math.max(0, owned(uid) - keep);
}

export const economy = readonly(state);

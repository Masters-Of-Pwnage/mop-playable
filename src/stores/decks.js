/**
 * Deck store. Decks use the same JSON format as the original deck builder
 * (id, name, author, author_social, cards[{id, amount}]) so files are
 * interchangeable; "ammount" (typo in decks/h2hc-2024.json) is also accepted.
 */
import { reactive, watch } from 'vue';
import { Kind } from '../engine/cards.js';
import { getCard } from './cards.js';
import { account, api } from './account.js';
import { toast } from '../composables/toast.js';
import starterDecks from '../data/starter-decks.json';

export const MAX_CARDS = 60;
export const MAX_COPIES = 4;
export const MIN_PLAY_CARDS = 20;
const STORAGE_KEY = 'mop.decks.v1';

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newDeck() {
  return { id: uuid(), name: '', author: '', author_social: '', cards: [], builtin: false };
}

/** Normalizes any deck object into {id, name, author, author_social, cards:[{uid, amount}], builtin}. */
export function normalize(d, builtin = false) {
  const out = {
    id: String(d.id || '') || uuid(), name: String(d.name || ''), author: String(d.author || ''),
    author_social: String(d.author_social || ''), subtitle: d.subtitle || '', cards: [], builtin,
  };
  const merged = new Map();
  for (const e of d.cards || []) {
    if (!e || typeof e !== 'object') continue;
    const amount = Number(e.amount ?? e.ammount ?? 0) | 0;
    if (amount <= 0) continue;
    const card = (e.uid && getCard(String(e.uid))) || getCard(String(e.id || ''));
    if (!card) continue;
    merged.set(card.uid, (merged.get(card.uid) | 0) + amount);
  }
  for (const [uid, amount] of merged) out.cards.push({ uid, amount });
  return out;
}

export const count = (deck) => deck.cards.reduce((t, e) => t + e.amount, 0);
export const copies = (deck, uid) => deck.cards.find((e) => e.uid === uid)?.amount || 0;

/** Cyberlands work like basic lands (the H2HC 2024 champion deck runs 10× RedZone). */
export const copyLimit = (card) => (card.kind === Kind.LAND ? MAX_CARDS : MAX_COPIES);

/** Returns "" on success or the reason the card can't be added. */
export function addCard(deck, card) {
  if (count(deck) >= MAX_CARDS) return `O deck já tem ${MAX_CARDS} cartas.`;
  const e = deck.cards.find((x) => x.uid === card.uid);
  if (e) {
    if (e.amount >= copyLimit(card)) return `Máximo de ${MAX_COPIES} cópias por carta.`;
    e.amount += 1;
    return '';
  }
  deck.cards.push({ uid: card.uid, amount: 1 });
  return '';
}

export function removeCard(deck, uid) {
  const i = deck.cards.findIndex((e) => e.uid === uid);
  if (i === -1) return;
  deck.cards[i].amount -= 1;
  if (deck.cards[i].amount <= 0) deck.cards.splice(i, 1);
}

/** Flattened list of uids (one entry per copy). */
export function expand(deck) {
  return deck.cards.flatMap((e) => (getCard(e.uid) ? Array(e.amount).fill(e.uid) : []));
}

export function problemsForPlay(deck) {
  const n = count(deck);
  if (n < MIN_PLAY_CARDS) return `O deck precisa de pelo menos ${MIN_PLAY_CARDS} cartas para jogar (tem ${n}).`;
  return '';
}

export function stats(deck) {
  const out = { count: 0, lands: 0, creatures: 0, spells: 0, colors: {}, curve: [0, 0, 0, 0, 0, 0, 0, 0] };
  for (const e of deck.cards) {
    const c = getCard(e.uid);
    if (!c) continue;
    out.count += e.amount;
    if (c.kind === Kind.LAND) {
      out.lands += e.amount;
      continue;
    }
    if (c.kind === Kind.CREATURE) out.creatures += e.amount;
    else out.spells += e.amount;
    out.curve[Math.min(c.manaValue, 7)] += e.amount;
    for (const col of c.colors) out.colors[col] = (out.colors[col] | 0) + e.amount;
  }
  return out;
}

/** Web-compatible export (same shape the original app produced). */
export function toExport(deck) {
  const cards = [];
  for (const e of deck.cards) {
    const c = getCard(e.uid);
    if (!c) continue;
    const item = { id: c.id, name: c.name, description: c.text || 'No description available', amount: e.amount };
    if (c.uid !== c.id) item.uid = c.uid;
    cards.push(item);
  }
  return { id: deck.id, name: deck.name, author: deck.author || '', author_social: deck.author_social || '', cards };
}

export const toJson = (deck) => JSON.stringify(toExport(deck), null, 2);

/** Same validation rules as the original ImportDeckModal. Returns {deck} or {error}. */
export function importJson(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'O arquivo não é um JSON válido.' };
  }
  if (!json || typeof json !== 'object' || !json.name || !Array.isArray(json.cards) || json.cards.length === 0) {
    return { error: 'Formato inválido: o deck precisa de nome e cartas.' };
  }
  let total = 0;
  for (const e of json.cards) {
    if (!e || typeof e !== 'object' || !(e.id || e.uid)) return { error: 'Formato inválido: carta sem id.' };
    const amount = e.amount ?? e.ammount;
    if (typeof amount !== 'number' || amount <= 0) return { error: 'Formato inválido: quantidade inválida.' };
    total += amount;
  }
  if (total > MAX_CARDS) return { error: `O deck deve ter ${MAX_CARDS} cartas ou menos.` };
  const deck = normalize(json);
  if (!deck.cards.length) return { error: 'Nenhuma carta do deck existe nesta versão da biblioteca.' };
  return { deck };
}

// ---------------------------------------------------------------- persistence

// mode 'local': decks live in this browser (guest). mode 'account': they live on the server.
const state = reactive({ mine: [], mode: 'local' });

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.mine = JSON.parse(raw).map((d) => normalize(d)).filter((d) => d.cards.length || d.name);
  } catch (err) {
    console.warn('decks: storage unavailable', err);
  }
}

function persist() {
  if (state.mode !== 'local') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mine.map(toExport)));
  } catch (err) {
    console.warn('decks: could not save', err);
  }
}

let loaded = false;
export function initDecks() {
  if (loaded) return;
  loaded = true;
  load();
  watch(() => state.mine, persist, { deep: true });
  if (account.user) useAccountDecks();
}

/** Switches to the decks saved in the account (after login). */
export async function useAccountDecks() {
  try {
    const { decks } = await api('GET', '/me/decks');
    state.mode = 'account';
    state.mine = decks.map((d) => normalize(d));
  } catch (err) {
    toast(`Não foi possível carregar seus decks da conta (${err.message}).`, 'error');
  }
}

/** Back to the decks of this browser (after logout). */
export function useLocalDecks() {
  state.mode = 'local';
  state.mine = [];
  load();
}

/** Decks kept in this browser, for the "import into your account" offer. */
export function localDeckCount() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

export async function importLocalDecks() {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const decks = raw.map((d) => normalize(d)).filter((d) => d.cards.length)
    .map((d) => ({ id: d.id, name: d.name.trim() || 'Deck sem nome', cards: d.cards.map(({ uid, amount }) => ({ uid, amount })) }));
  const result = await api('POST', '/me/decks/import', { decks });
  await useAccountDecks();
  return result;
}

const remoteBody = (deck) => ({ name: deck.name, cards: deck.cards.map(({ uid, amount }) => ({ uid, amount })) });

function syncSave(deck) {
  if (state.mode !== 'account') return;
  api('PUT', `/me/decks/${encodeURIComponent(deck.id)}`, remoteBody(deck))
    .catch((err) => toast(`O deck não foi salvo na conta: ${err.message}`, 'error', 5000));
}

function syncDelete(id) {
  if (state.mode !== 'account') return;
  api('DELETE', `/me/decks/${encodeURIComponent(id)}`)
    .catch((err) => toast(`O deck não foi apagado da conta: ${err.message}`, 'error', 5000));
}

export function builtinDecks() {
  return starterDecks.map((d) => normalize(d, true));
}

export function allDecks() {
  return [...state.mine, ...builtinDecks()];
}

export function findDeck(id) {
  return allDecks().find((d) => d.id === id) || null;
}

export function saveDeck(deck) {
  if (!deck.name.trim()) return 'Dê um nome ao deck.';
  const copy = normalize(toExport(deck));
  if (deck.builtin) copy.id = uuid();
  copy.name = deck.name.trim();
  const i = state.mine.findIndex((d) => d.id === copy.id);
  if (i === -1) state.mine.unshift(copy);
  else state.mine[i] = copy;
  deck.id = copy.id;
  deck.builtin = false;
  syncSave(copy);
  return '';
}

export function deleteDeck(id) {
  const i = state.mine.findIndex((d) => d.id === id);
  if (i !== -1) state.mine.splice(i, 1);
  syncDelete(id);
}

export const decksStore = state;

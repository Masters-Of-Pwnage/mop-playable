/** Card library store: loads public/cards.json once and exposes lookups. */
import { reactive, readonly } from 'vue';
import { buildLibrary } from '../engine/cards.js';

const BASE = import.meta.env.BASE_URL;

const state = reactive({ loaded: false, loading: false, error: '', cards: [] });
const byUid = new Map();
const byId = new Map();

export async function loadCards() {
  if (state.loaded || state.loading) return;
  state.loading = true;
  try {
    const res = await fetch(`${BASE}cards.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards : Object.values(data);
    const cards = buildLibrary(raw);
    byUid.clear();
    byId.clear();
    for (const c of cards) {
      byUid.set(c.uid, c);
      if (c.id && !byId.has(c.id)) byId.set(c.id, c);
    }
    state.cards = cards;
    state.loaded = true;
  } catch (err) {
    state.error = `Não foi possível carregar as cartas (${err.message}).`;
    console.error('Failed to load cards:', err);
  } finally {
    state.loading = false;
  }
}

/** Looks a card up by internal uid or by the original JSON id. */
export function getCard(key) {
  return byUid.get(key) || byId.get(key) || null;
}

export function imageUrl(card, size = 'thumb') {
  if (!card) return '';
  const rel = size === 'thumb' ? card.thumb : card.image;
  return rel ? `${BASE}${rel}` : '';
}

export const backUrl = (size = 'thumb') => `${BASE}${size === 'thumb' ? 'thumb' : 'image'}/back-card.webp`;

export const cardsStore = readonly(state);

/**
 * Mana symbols, cost parsing and payment planning.
 *
 * Card costs in the library come in many hand-typed formats ("{2}{U}{B}", "2{U}",
 * "3️⚫⚫", "{3},{B},{R}", "{2}{w}{w}", "{R/U}"...). They are parsed here without
 * ever modifying the card data.
 */
export const COLORS = ['W', 'U', 'B', 'R', 'G'];
export const ALL = ['W', 'U', 'B', 'R', 'G', 'C'];
export const ANY = '*';

export const COLOR_NAMES = {
  W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', C: 'Incolor', '*': 'Qualquer',
};

export const COLOR_HEX = {
  W: '#f2e6b8', U: '#3b9ae8', B: '#6e5a87', R: '#e5533d', G: '#33b06a', C: '#a9adb5', '*': '#d9d9d9',
};

/** Emoji / glyphs used in some hand-written costs. */
const GLYPHS = { '⚫': 'B', '⚪': 'W', '🔵': 'U', '🔴': 'R', '🟢': 'G', '◇': 'C', '◊': 'C' };

export function emptyPool() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool) {
  return ALL.reduce((t, c) => t + (pool[c] | 0), 0);
}

/** Parsed mana cost. */
export class Cost {
  constructor() {
    this.generic = 0;
    this.colored = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    this.hybrid = []; // Array<string[]> options for one mana
    this.any = 0; // unknown symbols, payable with any mana
    this.x = 0;
    this.text = '';
    this.isEmpty = true;
  }

  manaValue() {
    let v = this.generic + this.any + this.hybrid.length;
    for (const k of ALL) v += this.colored[k];
    return v;
  }

  colors() {
    const out = [];
    for (const c of COLORS) if (this.colored[c] > 0) out.push(c);
    for (const h of this.hybrid) for (const c of h) if (COLORS.includes(c) && !out.includes(c)) out.push(c);
    return out;
  }

  /** Symbols in display order, e.g. ["3", "U", "B"]. */
  symbols() {
    const out = [];
    for (let i = 0; i < this.x; i += 1) out.push('X');
    if (this.generic > 0 || (this.manaValue() === 0 && !this.isEmpty && this.x === 0)) out.push(String(this.generic));
    for (const h of this.hybrid) out.push(h.join('/'));
    for (const c of ALL) for (let i = 0; i < this.colored[c]; i += 1) out.push(c);
    for (let i = 0; i < this.any; i += 1) out.push('?');
    return out;
  }

  _add(sym) {
    sym = sym.trim().toUpperCase();
    if (sym === '') return;
    this.isEmpty = false;
    if (/^\d+$/.test(sym)) this.generic += Number.parseInt(sym, 10);
    else if (ALL.includes(sym)) this.colored[sym] += 1;
    else if (sym === 'X' || sym === 'Y') this.x += 1;
    else if (sym.includes('/')) {
      const opts = sym.split('/').map((p) => p.trim()).filter((p) => ALL.includes(p) || /^\d+$/.test(p));
      if (opts.length === 0) this.any += 1;
      else this.hybrid.push(opts);
    } else this.any += 1; // "?", "P", "A", "O", custom glyphs ...
  }
}

const CLOSERS = { '{': '}', '[': ']', '(': ')' };

export function parseCost(value) {
  const c = new Cost();
  if (value === null || value === undefined) return c;
  const s = String(value).trim();
  c.text = s;
  if (s === '') return c;
  const chars = Array.from(s); // code points, so emoji are single items
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (CLOSERS[ch]) {
      let j = i + 1;
      while (j < chars.length && chars[j] !== CLOSERS[ch]) j += 1;
      c._add(chars.slice(i + 1, j).join(''));
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < chars.length && /\d/.test(chars[j])) j += 1;
      c._add(chars.slice(i, j).join(''));
      i = j;
      continue;
    }
    const code = ch.codePointAt(0);
    if (GLYPHS[ch]) c._add(GLYPHS[ch]);
    else if (ALL.includes(ch.toUpperCase()) || ch.toUpperCase() === 'X') c._add(ch);
    else if (' ,;+-'.includes(ch) || code === 0xfe0f || code === 0x200d || code < 32) { /* separators */ }
    else c._add('?');
    i += 1;
  }
  return c;
}

/**
 * Colors a land / mana ability can produce, read from its rules text.
 * Returns [] when the text says nothing useful (caller treats it as "any color").
 */
export function parseProduction(text) {
  const out = [];
  if (!text) return out;
  const lower = text.toLowerCase();
  let idx = -1;
  for (const key of ['adicion', 'add ', 'adds ']) {
    const k = lower.indexOf(key);
    if (k !== -1 && (idx === -1 || k < idx)) idx = k;
  }
  if (idx === -1) return out;
  const tail = text.slice(idx);
  const tl = tail.toLowerCase();
  if (tl.includes('qualquer cor') || tl.includes('any color')) return [ANY];
  for (const m of tail.matchAll(/[{[]([^}\]]+)[}\]]/g)) {
    const sym = m[1].trim().toUpperCase();
    if (ALL.includes(sym) && !out.includes(sym)) out.push(sym);
  }
  for (const [g, col] of Object.entries(GLYPHS)) if (tail.includes(g) && !out.includes(col)) out.push(col);
  return out;
}

/** A mana source available for automatic payment. options: colors it can produce ("*" = any). */
export function makeSource(iid, options) {
  return { iid, options };
}

const flex = (s) => (s.options.includes(ANY) ? 10 : s.options.length);

/**
 * Finds a way to pay `cost` (with X = xValue) using the floating `pool` and
 * untapped `sources`. Returns null when impossible, otherwise
 *   { taps: [{iid, color}], spend: {color: n} }
 */
export function planPayment(cost, xValue, pool, sources) {
  const avail = { ...pool };
  const units = [];
  for (const c of ALL) for (let i = 0; i < cost.colored[c]; i += 1) units.push([c]);
  for (const h of cost.hybrid) units.push(h.map((o) => (/^\d+$/.test(o) ? '#' : o)));
  units.sort((a, b) => a.length - b.length); // most constrained first
  const generic = cost.generic + cost.any + cost.x * Math.max(xValue, 0);
  const srcs = [...sources].sort((a, b) => flex(a) - flex(b));
  const used = new Set();
  const taps = [];
  const spend = emptyPool();
  if (!assign(units, 0, avail, srcs, used, taps, spend)) return null;
  let remaining = generic;
  for (const c of ['C', 'W', 'U', 'B', 'R', 'G']) {
    while (remaining > 0 && avail[c] > 0) {
      avail[c] -= 1;
      spend[c] += 1;
      remaining -= 1;
    }
  }
  for (const s of srcs) {
    if (remaining <= 0) break;
    if (used.has(s.iid)) continue;
    let color = s.options.length > 0 ? s.options[0] : 'C';
    if (color === ANY) color = 'C';
    used.add(s.iid);
    taps.push({ iid: s.iid, color });
    spend[color] += 1;
    remaining -= 1;
  }
  if (remaining > 0) return null;
  return { taps, spend };
}

function assign(units, idx, avail, srcs, used, taps, spend) {
  if (idx >= units.length) return true;
  const unit = units[idx];
  for (const c of unit) {
    if (c === '#') {
      for (const k of ['C', 'W', 'U', 'B', 'R', 'G']) {
        if (avail[k] > 0) {
          avail[k] -= 1;
          spend[k] += 1;
          if (assign(units, idx + 1, avail, srcs, used, taps, spend)) return true;
          avail[k] += 1;
          spend[k] -= 1;
        }
      }
    } else if ((avail[c] | 0) > 0) {
      avail[c] -= 1;
      spend[c] += 1;
      if (assign(units, idx + 1, avail, srcs, used, taps, spend)) return true;
      avail[c] += 1;
      spend[c] -= 1;
    }
  }
  for (const s of srcs) {
    if (used.has(s.iid)) continue;
    let color = '';
    for (const c of unit) {
      if (c === '#') {
        color = s.options.length > 0 && s.options[0] !== ANY ? s.options[0] : 'C';
        break;
      }
      if (s.options.includes(c) || s.options.includes(ANY)) {
        color = c;
        break;
      }
    }
    if (color === '') continue;
    used.add(s.iid);
    taps.push({ iid: s.iid, color });
    spend[color] += 1;
    if (assign(units, idx + 1, avail, srcs, used, taps, spend)) return true;
    used.delete(s.iid);
    taps.pop();
    spend[color] -= 1;
  }
  return false;
}

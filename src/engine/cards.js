/**
 * Card model: wraps one original card object from public/cards.json (kept intact
 * in `raw`) and derives everything the game needs from it.
 */
import { parseCost, parseProduction, ANY, COLORS } from './mana.js';

export const Kind = Object.freeze({
  LAND: 0, CREATURE: 1, INSTANT: 2, SORCERY: 3, ENCHANTMENT: 4, ARTIFACT: 5, PLANESWALKER: 6, OTHER: 7,
});

export const KIND_NAMES = {
  [Kind.LAND]: 'Cyberland', [Kind.CREATURE]: 'Criatura', [Kind.INSTANT]: 'Mágica Instantânea',
  [Kind.SORCERY]: 'Feitiço', [Kind.ENCHANTMENT]: 'Encantamento', [Kind.ARTIFACT]: 'Artefato',
  [Kind.PLANESWALKER]: 'Planinauta', [Kind.OTHER]: 'Outro',
};

/** Filter chips, same as the original web app (Terreno also matches Cyberlands). */
export const FILTER_TYPES = ['Criatura', 'Mágica Instantânea', 'Encantamento', 'Artefato', 'Feitiço', 'Terreno'];

/** keyword id -> accepted spellings (folded: lower case, no accents) */
const KEYWORDS = {
  flying: ['voar', 'voo', 'flying'],
  vigilance: ['vigilancia', 'vigilance'],
  haste: ['impeto', 'pressa', 'haste'],
  trample: ['atropelar', 'trample'],
  defender: ['defensor', 'defender'],
  reach: ['alcance', 'reach'],
  deathtouch: ['toque mortifero', 'toque mortal', 'deathtouch'],
  lifelink: ['vinculo com a vida', 'lifelink'],
  first_strike: ['iniciativa', 'primeiro ataque', 'first strike'],
  double_strike: ['golpe duplo', 'ataque duplo', 'double strike'],
  indestructible: ['indestrutivel', 'indestructible'],
  hexproof: ['hexproof', 'resistencia a magia'],
  flash: ['lampejo', 'flash'],
  menace: ['ameaca', 'menace'],
};

export const KEYWORD_NAMES = {
  flying: 'Voar', vigilance: 'Vigilância', haste: 'Ímpeto', trample: 'Atropelar', defender: 'Defensor',
  reach: 'Alcance', deathtouch: 'Toque Mortífero', lifelink: 'Vínculo com a Vida', first_strike: 'Iniciativa',
  double_strike: 'Golpe Duplo', indestructible: 'Indestrutível', hexproof: 'Hexproof', flash: 'Lampejo', menace: 'Ameaça',
};

export function fold(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const str = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).trim();
};

const num = (t) => {
  const m = /-?\d+/.exec(t);
  return m ? Number.parseInt(m[0], 10) : 0;
};

export class Card {
  constructor(raw, uid) {
    this.raw = raw;
    this.uid = uid;
    this.file = str(raw._file);
    this.id = str(raw.id);
    this.name = str(raw.name) || this.file.replace(/\.json$/, '');
    this.costText = str(raw.cost);
    this.typeLine = str(raw.type);
    this.text = str(raw.description);
    this.flavor = str(raw.flavor ?? raw.flavorText);
    this.edition = str(raw.edition);
    this.year = str(raw.year);
    this.image = str(raw.image);
    this.thumb = str(raw._thumb) || this.image;
    this.powerText = str(raw.power);
    this.toughnessText = str(raw.toughness);
    this.loyaltyText = str(raw.loyalty);
    this.hasPT = this.powerText !== '' || this.toughnessText !== '';
    this.power = num(this.powerText);
    this.toughness = num(this.toughnessText);
    this.loyalty = num(this.loyaltyText);
    this.cost = parseCost(raw.cost);
    this.kind = this._classify();
    this.manaValue = this.kind === Kind.LAND ? 0 : this.cost.manaValue();
    this.colors = this.kind === Kind.LAND ? [] : this.cost.colors();
    const ft = fold(this.typeLine);
    this.isLegendary = ft.includes('lendari') || ft.includes('legendary') || ft.includes('mitic');
    this.keywords = this._keywords();
    this.produces = parseProduction(this.text);
    this.hasManaAbility = this.kind === Kind.LAND
      || ((fold(this.text).includes('adicion') || this.text.toLowerCase().includes('add ')) && this.produces.length > 0);
    if (this.kind === Kind.LAND) for (const p of this.produces) if (COLORS.includes(p)) this.colors.push(p);
    this.searchName = fold(this.name);
    this.searchText = fold(this.text);
    this.searchType = fold(this.typeLine);
  }

  _classify() {
    const t = fold(this.typeLine);
    if (t.includes('planinaut') || t.includes('planeswalker')) return Kind.PLANESWALKER;
    if (t.includes('criatura') || t.includes('creature')) return Kind.CREATURE;
    if (t.includes('instant') || t.includes('magica')) return Kind.INSTANT;
    if (t.includes('feitic') || t.includes('sorcery') || t.includes('ettico')) return Kind.SORCERY;
    if (t.includes('encantamento') || t.includes('enchant')) return Kind.ENCHANTMENT;
    if (t.includes('artefato') || t.includes('artifact')) return Kind.ARTIFACT;
    for (const key of ['cyberland', 'cyber land', 'terreno', 'land', 'conferencia', 'empresa', 'lista de discussao', 'hacker clube']) {
      if (t.includes(key)) return Kind.LAND;
    }
    if (this.hasPT) return Kind.CREATURE;
    const ftext = fold(this.text);
    if (this.cost.isEmpty || ftext.includes('adicion') || ftext.includes('cyber land')) return Kind.LAND;
    return Kind.OTHER;
  }

  _keywords() {
    const found = {};
    if (!this.text) return found;
    const ftext = fold(this.text);
    const firstLine = ftext.split('\n')[0];
    for (let seg of firstLine.replace(/[.;:]/g, ',').split(',')) {
      seg = seg.trim();
      if (!seg) continue;
      let matched = false;
      for (const [kw, spellings] of Object.entries(KEYWORDS)) {
        if (spellings.includes(seg)) {
          found[kw] = true;
          matched = true;
        }
      }
      if (!matched) break;
    }
    for (const line of ftext.split('\n')) {
      const l = line.trim().replace(/[.,]$/, '');
      for (const [kw, spellings] of Object.entries(KEYWORDS)) if (spellings.includes(l)) found[kw] = true;
    }
    for (const [kw, spellings] of Object.entries(KEYWORDS)) {
      for (const sp of spellings) {
        if (ftext.includes(` tem ${sp}.`) || ftext.includes(` tem ${sp} `)) found[kw] = true;
      }
    }
    return found;
  }

  get isPermanent() {
    return this.kind !== Kind.INSTANT && this.kind !== Kind.SORCERY;
  }

  get isCreature() {
    return this.kind === Kind.CREATURE;
  }

  get kindName() {
    return KIND_NAMES[this.kind] || 'Outro';
  }

  get ptText() {
    if (!this.hasPT) return '';
    return `${this.powerText || '0'}/${this.toughnessText || '0'}`;
  }

  /** Same semantics as the original FilterBar type chips. */
  matchesTypeFilter(filterType) {
    const f = fold(filterType);
    if (f === 'terreno') return this.kind === Kind.LAND || this.searchType.includes('terreno');
    return this.searchType.includes(f);
  }
}

/**
 * Builds Card objects from the public/cards.json array, assigning a stable uid.
 * Several source files share one `id`; the first (sorted by file name) keeps it
 * and the others get "<id>#<file stem>" so decks can tell them apart.
 */
export function buildLibrary(rawCards) {
  const seen = new Set();
  const cards = [];
  for (const raw of rawCards) {
    const id = str(raw.id);
    const stem = str(raw._file).replace(/\.json$/, '');
    let uid = id || stem;
    if (seen.has(uid)) uid = `${uid}#${stem}`;
    seen.add(uid);
    cards.push(new Card(raw, uid));
  }
  cards.sort((a, b) => a.searchName.localeCompare(b.searchName));
  return cards;
}

/** Same filter semantics as the original App.vue (name, description, cost range, types, mana symbols). */
export function filterCards(cards, f) {
  const nameQ = fold(f.name || '').trim();
  const textQ = fold(f.description || '').trim();
  const min = f.costMin === null || f.costMin === undefined || f.costMin === '' ? null : Number(f.costMin);
  const max = f.costMax === null || f.costMax === undefined || f.costMax === '' ? null : Number(f.costMax);
  const types = f.types || [];
  const manas = f.manas || [];
  return cards.filter((c) => {
    if (nameQ && !c.searchName.includes(nameQ)) return false;
    if (textQ && !c.searchText.includes(textQ)) return false;
    if (min !== null && c.manaValue < min) return false;
    if (max !== null && c.manaValue > max) return false;
    if (types.length && !types.some((t) => c.matchesTypeFilter(t))) return false;
    if (manas.length) {
      for (const m of manas) {
        const sym = m.replace(/[{}]/g, '');
        const ok = c.cost.colored[sym] > 0 || (c.kind === Kind.LAND && c.produces.includes(sym))
          || c.cost.hybrid.some((h) => h.includes(sym));
        if (!ok) return false;
      }
    }
    return true;
  });
}

export { ANY };

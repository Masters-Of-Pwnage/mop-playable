import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { audit } from '../auth/users.js';
import { effective, RARITIES, rarityDefaults } from '../economy/catalog.js';
import { adminGuards } from './guards.js';

const AVAILABILITY = ['loja', 'recompensa', 'evento', 'indisponivel'];
const CONSENT = ['pendente', 'concedido', 'negado', 'nao_se_aplica'];

/** API field -> column, with the validator of its value (null = "use the default"). */
const FIELDS = {
  rarity: ['rarity', (v) => RARITIES.includes(v)],
  price: ['price_credits', (v) => v === null || (Number.isSafeInteger(v) && v >= 0)],
  sellPrice: ['sell_credits', (v) => v === null || (Number.isSafeInteger(v) && v >= 0)],
  availability: ['availability', (v) => AVAILABILITY.includes(v)],
  availableFrom: ['available_from', (v) => v === null || (Number.isSafeInteger(v) && v > 0)],
  availableUntil: ['available_until', (v) => v === null || (Number.isSafeInteger(v) && v > 0)],
  stockTotal: ['stock_total', (v) => v === null || (Number.isSafeInteger(v) && v >= 0)],
  perUserLimit: ['per_user_limit', (v) => v === null || (Number.isSafeInteger(v) && v >= 0)],
  maxOwned: ['max_owned', (v) => v === null || (Number.isSafeInteger(v) && v >= 0)],
  tradeable: ['tradeable', (v) => typeof v === 'boolean'],
  animationConsent: ['animation_consent', (v) => CONSENT.includes(v)],
  packWeight: ['pack_weight', (v) => Number.isSafeInteger(v) && v >= 0],
};
export const CSV_COLUMNS = ['uid', 'name', 'rarity', 'price', 'sellPrice', 'availability', 'availableFrom', 'availableUntil', 'stockTotal', 'perUserLimit', 'maxOwned', 'tradeable', 'animationConsent', 'packWeight'];

/** Admin view of a catalog row (raw overrides + what is in force). */
export function adminEntry(row, defaults, stats = {}) {
  const e = effective(row, defaults);
  return {
    uid: row.uid,
    name: row.name,
    kind: row.kind,
    rarity: row.rarity,
    price: row.price_credits,
    sellPrice: row.sell_credits,
    effectivePrice: e.price,
    effectiveSellPrice: e.sellPrice,
    effectiveMaxOwned: e.maxOwned,
    availability: row.availability,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    stockTotal: row.stock_total,
    stockSold: row.stock_sold,
    perUserLimit: row.per_user_limit,
    maxOwned: row.max_owned,
    tradeable: Boolean(row.tradeable),
    animationConsent: row.animation_consent,
    packWeight: row.pack_weight,
    orphan: Boolean(row.orphan),
    updatedAt: row.updated_at,
    owners: stats.owners || 0,
    sold7d: stats.sold7d || 0,
  };
}

/**
 * Validates `changes` against a row and returns the column updates, or { error, field }.
 * Cross-field rules are checked on the resulting row (window order, stock >= sold, sell <= price).
 */
export function planChanges(row, changes, defaults) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { error: 'bad_request' };
  const updates = {};
  for (const [field, value] of Object.entries(changes)) {
    const spec = FIELDS[field];
    if (!spec) return { error: 'bad_request', field };
    if (!spec[1](value)) return { error: 'invalid_value', field };
    updates[spec[0]] = field === 'tradeable' ? (value ? 1 : 0) : value;
  }
  const next = { ...row, ...updates };
  if (next.available_from !== null && next.available_until !== null && next.available_from >= next.available_until) return { error: 'invalid_value', field: 'availableUntil' };
  if (next.stock_total !== null && next.stock_total < next.stock_sold) return { error: 'invalid_value', field: 'stockTotal' };
  const e = effective(next, defaults);
  if (e.sellPrice > e.price) return { error: 'invalid_value', field: 'sellPrice' };
  return { updates, next };
}

function diff(before, after) {
  const out = {};
  for (const [field, [col]] of Object.entries(FIELDS)) if (before[col] !== after[col]) out[field] = { before: before[col], after: after[col] };
  return out;
}

function applyUpdates(db, row, updates, actorId, ip, action) {
  const cols = Object.keys(updates);
  if (!cols.length) return row;
  const now = Date.now();
  db.prepare(`UPDATE card_catalog SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE uid = ?`)
    .run(...cols.map((c) => updates[c]), now, actorId, row.uid);
  const after = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(row.uid);
  const d = diff(row, after);
  if (Object.keys(d).length) {
    audit(db, { actor: actorId, action, target: `card:${row.uid}`, before: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.before])), after: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.after])), ip });
  }
  return after;
}

// ------------------------------------------------------------------- CSV

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV cell -> API value of a field ('' = null for nullable fields). */
function fromCsv(field, raw) {
  const v = raw.trim();
  if (['rarity', 'availability', 'animationConsent'].includes(field)) return v;
  if (field === 'tradeable') return ['1', 'true', 'sim', 'yes'].includes(v.toLowerCase());
  if (field === 'availableFrom' || field === 'availableUntil') {
    if (v === '') return null;
    const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    return Number.isNaN(t) ? 'invalid' : t;
  }
  if (v === '') return field === 'packWeight' ? 0 : null;
  return /^-?\d+$/.test(v) ? Number(v) : 'invalid';
}

function toCsvValue(field, entry) {
  const v = entry[field];
  if ((field === 'availableFrom' || field === 'availableUntil') && v) return new Date(v).toISOString();
  if (field === 'tradeable') return v ? 1 : 0;
  return v;
}

// ------------------------------------------------------------------ routes

/** /api/admin/catalog*: price, rarity, availability and stock of every card (docs/sdd/04-admin.md §4). */
export function registerAdminCatalog(app, { db, config }) {
  const g = adminGuards(db, config);

  function stats() {
    const owners = new Map(db.prepare('SELECT card_uid, COUNT(*) AS n FROM user_cards WHERE quantity > 0 GROUP BY card_uid').all().map((r) => [r.card_uid, r.n]));
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const sold = new Map(db.prepare(`SELECT m.card_uid, SUM(m.delta) AS n FROM inventory_moves m JOIN ledger_tx t ON t.id = m.tx_id
                                     WHERE t.kind = 'shop_buy' AND t.created_at >= ? GROUP BY m.card_uid`).all(since).map((r) => [r.card_uid, r.n]));
    return (uid) => ({ owners: owners.get(uid) || 0, sold7d: sold.get(uid) || 0 });
  }

  app.get('/api/admin/catalog', { preValidation: g.staff }, async () => {
    const defaults = rarityDefaults(db);
    const s = stats();
    return { cards: db.prepare('SELECT * FROM card_catalog ORDER BY name').all().map((r) => adminEntry(r, defaults, s(r.uid))) };
  });

  app.get('/api/admin/catalog/:uid', { preValidation: g.staff }, async (req, reply) => {
    const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(req.params.uid);
    if (!row) return reply.code(404).send(apiError('not_found'));
    const history = db.prepare(`SELECT a.id, a.action, a.before, a.after, a.created_at, u.display_name AS actor FROM audit_log a
                                LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.target = ? ORDER BY a.id DESC LIMIT 100`)
      .all(`card:${row.uid}`)
      .map((h) => ({ id: h.id, action: h.action, actor: h.actor, before: JSON.parse(h.before || 'null'), after: JSON.parse(h.after || 'null'), createdAt: h.created_at }));
    return { card: adminEntry(row, rarityDefaults(db), stats()(row.uid)), history };
  });

  /** Optimistic locking: If-Match carries the updatedAt the admin was looking at (CA-4.8). */
  app.patch('/api/admin/catalog/:uid', { preValidation: g.admin }, async (req, reply) => {
    const result = transaction(db, () => {
      const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(req.params.uid);
      if (!row) return { status: 404, body: apiError('not_found') };
      if (req.headers['if-match'] !== undefined && String(row.updated_at) !== String(req.headers['if-match'])) {
        return { status: 409, body: { ...apiError('edit_conflict'), updatedAt: row.updated_at } };
      }
      const plan = planChanges(row, req.body, rarityDefaults(db));
      if (plan.error) return { status: 400, body: { ...apiError(plan.error), field: plan.field } };
      const after = applyUpdates(db, row, plan.updates, req.auth.user.id, req.clientIp, 'catalog.update');
      return { status: 200, body: { card: adminEntry(after, rarityDefaults(db), stats()(after.uid)) } };
    });
    return reply.code(result.status).send(result.body);
  });

  /**
   * Bulk edit: the same changes (or a % price adjustment) on many cards. dryRun returns the diff
   * per card without writing (CA-4.3); any invalid card fails the whole request.
   */
  app.post('/api/admin/catalog/bulk', {
    preValidation: g.admin,
    schema: {
      body: {
        type: 'object',
        required: ['uids'],
        additionalProperties: false,
        properties: {
          uids: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string', maxLength: 160 } },
          changes: { type: 'object' },
          pricePct: { type: 'integer', minimum: -90, maximum: 1000 },
          dryRun: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const { uids, changes = {}, pricePct, dryRun = false } = req.body;
    const result = transaction(db, () => {
      const defaults = rarityDefaults(db);
      const plans = [];
      for (const uid of new Set(uids)) {
        const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(uid);
        if (!row) return { status: 400, body: { ...apiError('not_found'), uid } };
        const own = { ...changes };
        if (pricePct !== undefined) own.price = Math.max(0, Math.round((effective({ ...row, ...(own.rarity ? { rarity: own.rarity } : {}) }, defaults).price * (100 + pricePct)) / 100));
        const plan = planChanges(row, own, defaults);
        if (plan.error) return { status: 400, body: { ...apiError(plan.error), field: plan.field, uid } };
        plans.push({ row, plan });
      }
      const preview = plans.map(({ row, plan }) => ({ uid: row.uid, name: row.name, changes: diff(row, plan.next) })).filter((p) => Object.keys(p.changes).length);
      if (!dryRun) for (const { row, plan } of plans) applyUpdates(db, row, plan.updates, req.auth.user.id, req.clientIp, 'catalog.bulk');
      return { status: 200, body: { dryRun, changed: preview.length, preview } };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get('/api/admin/catalog/export.csv', { preValidation: g.staff }, async (_req, reply) => {
    const defaults = rarityDefaults(db);
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of db.prepare('SELECT * FROM card_catalog WHERE orphan = 0 ORDER BY name').all()) {
      const e = adminEntry(r, defaults);
      lines.push(CSV_COLUMNS.map((c) => csvCell(toCsvValue(c, e))).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="mop-catalogo.csv"');
    return `${lines.join('\r\n')}\r\n`;
  });

  /** CSV import: dry run with the diff first; an unknown uid or bad value rejects the whole file (CA-4.4). */
  app.post('/api/admin/catalog/import', {
    preValidation: g.admin,
    bodyLimit: 1024 * 1024,
    schema: { body: { type: 'object', required: ['csv'], properties: { csv: { type: 'string', maxLength: 1_000_000 }, dryRun: { type: 'boolean' } } } },
  }, async (req, reply) => {
    const rows = parseCsv(req.body.csv);
    if (!rows.length) return reply.code(400).send(apiError('bad_request', 'CSV vazio.'));
    const header = rows[0].map((h) => h.trim());
    if (!header.includes('uid')) return reply.code(400).send(apiError('bad_request', 'O CSV precisa da coluna uid.'));
    const unknownCols = header.filter((h) => !CSV_COLUMNS.includes(h));
    if (unknownCols.length) return reply.code(400).send(apiError('bad_request', `Colunas desconhecidas: ${unknownCols.join(', ')}`));
    const editable = header.filter((h) => FIELDS[h]);
    const result = transaction(db, () => {
      const defaults = rarityDefaults(db);
      const plans = [];
      for (let i = 1; i < rows.length; i += 1) {
        const cells = Object.fromEntries(header.map((h, j) => [h, rows[i][j] ?? '']));
        const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(cells.uid.trim());
        if (!row) return { status: 400, body: { ...apiError('bad_request', `Linha ${i + 1}: uid desconhecido "${cells.uid}".`), line: i + 1 } };
        const changes = Object.fromEntries(editable.map((f) => [f, fromCsv(f, cells[f])]));
        const plan = planChanges(row, changes, defaults);
        if (plan.error) return { status: 400, body: { ...apiError('bad_request', `Linha ${i + 1}: valor inválido em ${plan.field}.`), line: i + 1, field: plan.field } };
        plans.push({ row, plan });
      }
      const preview = plans.map(({ row, plan }) => ({ uid: row.uid, name: row.name, changes: diff(row, plan.next) })).filter((p) => Object.keys(p.changes).length);
      if (!req.body.dryRun) for (const { row, plan } of plans) applyUpdates(db, row, plan.updates, req.auth.user.id, req.clientIp, 'catalog.import');
      return { status: 200, body: { dryRun: Boolean(req.body.dryRun), rows: plans.length, changed: preview.length, preview } };
    });
    return reply.code(result.status).send(result.body);
  });

  app.get('/api/admin/rarity-defaults', { preValidation: g.staff }, async () => ({
    rarities: db.prepare('SELECT rarity, price_credits AS price, sell_credits AS sellPrice FROM rarity_defaults ORDER BY sort').all().map((r) => ({ ...r })),
  }));

  app.put('/api/admin/rarity-defaults/:rarity', {
    preValidation: g.admin,
    schema: { body: { type: 'object', required: ['price', 'sellPrice'], additionalProperties: false, properties: { price: { type: 'integer', minimum: 0 }, sellPrice: { type: 'integer', minimum: 0 } } } },
  }, async (req, reply) => {
    const before = db.prepare('SELECT * FROM rarity_defaults WHERE rarity = ?').get(req.params.rarity);
    if (!before) return reply.code(404).send(apiError('not_found'));
    if (req.body.sellPrice > req.body.price) return reply.code(400).send({ ...apiError('invalid_value'), field: 'sellPrice' });
    transaction(db, () => {
      db.prepare('UPDATE rarity_defaults SET price_credits = ?, sell_credits = ? WHERE rarity = ?').run(req.body.price, req.body.sellPrice, req.params.rarity);
      audit(db, { actor: req.auth.user.id, action: 'rarity.update', target: `rarity:${req.params.rarity}`, before: { price: before.price_credits, sellPrice: before.sell_credits }, after: req.body, ip: req.clientIp });
    });
    return { rarity: req.params.rarity, ...req.body };
  });
}

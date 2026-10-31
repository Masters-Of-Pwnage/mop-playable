import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { requireUser } from '../auth/session.js';
import { audit } from '../auth/users.js';
import { adminGuards } from '../admin/guards.js';
import { balances, EconomyError } from '../economy/ledger.js';
import { openPack, parseSlots, pools, publicOdds } from '../economy/packs.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Random packs (docs/sdd/02-economia.md §5.7), behind the owner-only `packs` flag. */
export function registerPackRoutes(app, { db, config }) {
  const auth = requireUser(db, config);
  const g = adminGuards(db, config);
  const enabled = () => config.features.has('packs');
  const cardsPerPack = (slots) => slots.reduce((n, s) => n + s.count, 0);
  const view = (p, pool) => {
    const slots = JSON.parse(p.slots);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price_credits,
      cardsPerPack: cardsPerPack(slots),
      version: p.version,
      availableFrom: p.available_from,
      availableUntil: p.available_until,
      dailyLimit: p.daily_limit,
      odds: publicOdds(slots, pool).map((s) => ({ count: s.count, rarities: s.rarities })),
    };
  };

  app.get('/api/packs', async () => {
    if (!enabled()) return { enabled: false, products: [] };
    const pool = pools(db);
    return { enabled: true, products: db.prepare('SELECT * FROM pack_products WHERE active = 1 ORDER BY price_credits').all().map((p) => view(p, pool)) };
  });

  /** Odds per rarity and per card, for every slot (RF-2.25). */
  app.get('/api/packs/:id/odds', async (req, reply) => {
    const p = db.prepare('SELECT * FROM pack_products WHERE id = ? AND active = 1').get(Number(req.params.id));
    if (!enabled() || !p) return reply.code(404).send(apiError('not_found'));
    return { id: p.id, name: p.name, version: p.version, slots: publicOdds(JSON.parse(p.slots), pools(db)) };
  });

  app.post('/api/packs/:id/open', {
    onRequest: auth,
    schema: { body: { type: 'object', required: ['expectedPrice'], additionalProperties: false, properties: { expectedPrice: { type: 'integer', minimum: 0 } } } },
  }, async (req, reply) => {
    if (!enabled()) return reply.code(403).send(apiError('packs_disabled'));
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) return reply.code(400).send(apiError('idempotency_required'));
    try {
      const { opening, replayed } = openPack(db, req.auth.user, Number(req.params.id), req.body.expectedPrice, key);
      return { opening: opening.id, replayed, cards: JSON.parse(opening.cards), pity: Boolean(opening.pity), balances: balances(db, req.auth.user.id) };
    } catch (err) {
      if (!(err instanceof EconomyError)) throw err;
      return reply.code(err.status).send({ ...apiError(err.code), ...err.details });
    }
  });

  app.get('/api/me/packs/history', { onRequest: auth }, async (req) => ({
    openings: db.prepare(`SELECT o.id, o.cards, o.pity, o.created_at, p.name FROM pack_openings o JOIN pack_products p ON p.id = o.product_id
                          WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50`).all(req.auth.user.id)
      .map((o) => ({ id: o.id, name: o.name, cards: JSON.parse(o.cards), pity: Boolean(o.pity), createdAt: o.created_at })),
  }));

  // ------------------------------------------------------------------ admin

  const productSchema = {
    type: 'object',
    required: ['name', 'price', 'slots'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 60 },
      description: { type: 'string', maxLength: 300 },
      price: { type: 'integer', minimum: 0, maximum: 1_000_000 },
      slots: { type: 'array' },
      active: { type: 'boolean' },
      availableFrom: { type: ['integer', 'null'] },
      availableUntil: { type: ['integer', 'null'] },
      dailyLimit: { type: ['integer', 'null'], minimum: 1 },
    },
  };

  app.get('/api/admin/packs', { onRequest: g.staff }, async () => {
    const pool = pools(db);
    return {
      poolSizes: Object.fromEntries(Object.entries(pool).map(([r, list]) => [r, list.length])),
      products: db.prepare('SELECT p.*, (SELECT COUNT(*) FROM pack_openings WHERE product_id = p.id) AS opened FROM pack_products p ORDER BY p.id').all()
        .map((p) => ({ ...view(p, pool), slots: JSON.parse(p.slots), active: Boolean(p.active), opened: p.opened, updatedAt: p.updated_at })),
    };
  });

  function save(req, reply, existing) {
    const slots = parseSlots(req.body.slots);
    if (!slots) return reply.code(400).send({ ...apiError('invalid_value'), field: 'slots' });
    const b = req.body;
    if (b.availableFrom && b.availableUntil && b.availableFrom >= b.availableUntil) return reply.code(400).send({ ...apiError('invalid_value'), field: 'availableUntil' });
    const now = Date.now();
    const id = transaction(db, () => {
      const slotsJson = JSON.stringify(slots);
      let productId;
      let version = 1;
      if (existing) {
        productId = existing.id;
        // New odds or price = new version (RF-2.29); openings keep pointing at the version they used.
        version = existing.slots !== slotsJson || existing.price_credits !== b.price ? existing.version + 1 : existing.version;
        db.prepare(`UPDATE pack_products SET name = ?, description = ?, price_credits = ?, slots = ?, version = ?, active = ?, available_from = ?, available_until = ?,
                    daily_limit = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
          .run(b.name, b.description || '', b.price, slotsJson, version, b.active ? 1 : 0, b.availableFrom ?? null, b.availableUntil ?? null, b.dailyLimit ?? null, now, req.auth.user.id, productId);
      } else {
        productId = Number(db.prepare(`INSERT INTO pack_products (name, description, price_credits, slots, version, active, available_from, available_until, daily_limit, updated_at, updated_by)
                                       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
          .run(b.name, b.description || '', b.price, slotsJson, b.active ? 1 : 0, b.availableFrom ?? null, b.availableUntil ?? null, b.dailyLimit ?? null, now, req.auth.user.id).lastInsertRowid);
      }
      if (!existing || version !== existing.version) {
        db.prepare('INSERT INTO pack_versions (product_id, version, slots, price_credits, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(productId, version, slotsJson, b.price, now, req.auth.user.id);
      }
      audit(db, { actor: req.auth.user.id, action: existing ? 'packs.update' : 'packs.create', target: `pack:${productId}`, after: { ...b, slots, version }, ip: req.clientIp });
      return productId;
    });
    return { id };
  }

  app.post('/api/admin/packs', { onRequest: g.admin, schema: { body: productSchema } }, async (req, reply) => save(req, reply, null));

  app.put('/api/admin/packs/:id', { onRequest: g.admin, schema: { body: productSchema } }, async (req, reply) => {
    const existing = db.prepare('SELECT * FROM pack_products WHERE id = ?').get(Number(req.params.id));
    if (!existing) return reply.code(404).send(apiError('not_found'));
    return save(req, reply, existing);
  });
}

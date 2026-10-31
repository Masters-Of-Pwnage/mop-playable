-- Random card packs (docs/sdd/02-economia.md §5.7). Behind the `packs` flag, off until legal validation.
-- Slots: JSON [{count, odds: {rarity: weight}}]; every change creates a new version.

CREATE TABLE pack_products (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_credits   INTEGER NOT NULL CHECK (price_credits >= 0),
  slots           TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 0,
  available_from  INTEGER,
  available_until INTEGER,
  daily_limit     INTEGER CHECK (daily_limit IS NULL OR daily_limit >= 1),
  updated_at      INTEGER NOT NULL,
  updated_by      INTEGER REFERENCES users(id)
);

CREATE TABLE pack_versions (
  product_id    INTEGER NOT NULL REFERENCES pack_products(id),
  version       INTEGER NOT NULL,
  slots         TEXT NOT NULL,
  price_credits INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  PRIMARY KEY (product_id, version)
);

CREATE TABLE pack_openings (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES pack_products(id),
  version    INTEGER NOT NULL,
  tx_id      INTEGER NOT NULL REFERENCES ledger_tx(id),
  cards      TEXT NOT NULL,                       -- JSON [{uid, rarity, refund}]
  pity       INTEGER NOT NULL DEFAULT 0,          -- 1 when the last slot was forced rare+
  created_at INTEGER NOT NULL
);
CREATE INDEX pack_openings_user ON pack_openings(user_id, created_at);

CREATE TABLE pack_pity (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES pack_products(id),
  since_rare INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, product_id)
);

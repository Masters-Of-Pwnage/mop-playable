-- Card catalog overlay, wallets, double-entry ledger and collections (docs/sdd/00-arquitetura.md §4, 02-economia.md).
-- Amounts are integers. A ledger transaction always sums to zero per currency.

CREATE TABLE card_catalog (
  uid               TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  kind              INTEGER NOT NULL,
  rarity            TEXT NOT NULL DEFAULT 'comum' CHECK (rarity IN ('comum', 'incomum', 'rara', 'mitica', 'lendaria')),
  price_credits     INTEGER CHECK (price_credits IS NULL OR price_credits >= 0),
  sell_credits      INTEGER CHECK (sell_credits IS NULL OR sell_credits >= 0),
  availability      TEXT NOT NULL DEFAULT 'loja' CHECK (availability IN ('loja', 'recompensa', 'evento', 'indisponivel')),
  available_from    INTEGER,
  available_until   INTEGER,
  stock_total       INTEGER CHECK (stock_total IS NULL OR stock_total >= 0),
  stock_sold        INTEGER NOT NULL DEFAULT 0 CHECK (stock_sold >= 0),
  per_user_limit    INTEGER CHECK (per_user_limit IS NULL OR per_user_limit >= 0),
  max_owned         INTEGER CHECK (max_owned IS NULL OR max_owned >= 0),
  tradeable         INTEGER NOT NULL DEFAULT 1,
  pack_weight       INTEGER NOT NULL DEFAULT 0 CHECK (pack_weight >= 0),
  animation_consent TEXT NOT NULL DEFAULT 'pendente' CHECK (animation_consent IN ('pendente', 'concedido', 'negado', 'nao_se_aplica')),
  animation_id      INTEGER,
  orphan            INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  updated_by        INTEGER REFERENCES users(id),
  CHECK (stock_total IS NULL OR stock_sold <= stock_total),
  CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
);

CREATE TABLE rarity_defaults (
  rarity        TEXT PRIMARY KEY,
  price_credits INTEGER NOT NULL CHECK (price_credits >= 0),
  sell_credits  INTEGER NOT NULL CHECK (sell_credits >= 0),
  sort          INTEGER NOT NULL
);
INSERT INTO rarity_defaults (rarity, price_credits, sell_credits, sort) VALUES
  ('comum', 50, 10, 1),
  ('incomum', 150, 30, 2),
  ('rara', 400, 80, 3),
  ('mitica', 1000, 200, 4),
  ('lendaria', 2500, 500, 5);

CREATE TABLE wallets (
  id        INTEGER PRIMARY KEY,
  owner     TEXT NOT NULL,
  currency  TEXT NOT NULL CHECK (currency IN ('PWC', 'CR')),
  balance   INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner, currency),
  -- Only system wallets may go negative (system:mint mirrors everything ever issued).
  CHECK (is_system = 1 OR balance >= 0)
);

CREATE TABLE ledger_tx (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_user_id   INTEGER REFERENCES users(id),
  reason          TEXT,
  reverses_tx_id  INTEGER REFERENCES ledger_tx(id),
  meta            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX ledger_tx_actor ON ledger_tx(actor_user_id, id);

CREATE TABLE ledger_entries (
  id        INTEGER PRIMARY KEY,
  tx_id     INTEGER NOT NULL REFERENCES ledger_tx(id),
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  amount    INTEGER NOT NULL CHECK (amount <> 0)
);
CREATE INDEX ledger_entries_wallet ON ledger_entries(wallet_id, tx_id);
CREATE INDEX ledger_entries_tx ON ledger_entries(tx_id);

CREATE TABLE user_cards (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  card_uid TEXT NOT NULL REFERENCES card_catalog(uid),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (user_id, card_uid)
);

CREATE TABLE inventory_moves (
  id         INTEGER PRIMARY KEY,
  tx_id      INTEGER NOT NULL REFERENCES ledger_tx(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  card_uid   TEXT NOT NULL,
  delta      INTEGER NOT NULL CHECK (delta <> 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX inventory_moves_user_card ON inventory_moves(user_id, card_uid);

-- The money trail is append-only: corrections are new (reversal) transactions.
CREATE TRIGGER ledger_tx_no_update BEFORE UPDATE ON ledger_tx BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_tx_no_delete BEFORE DELETE ON ledger_tx BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER inventory_moves_no_update BEFORE UPDATE ON inventory_moves BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER inventory_moves_no_delete BEFORE DELETE ON inventory_moves BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

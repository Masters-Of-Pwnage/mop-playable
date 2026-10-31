-- Player trades and wishlists (docs/sdd/02-economia.md §5.4). Offers are immutable: editing creates a new one.

CREATE TABLE trades (
  id            INTEGER PRIMARY KEY,
  public_id     TEXT NOT NULL UNIQUE,
  from_user     INTEGER NOT NULL REFERENCES users(id),
  to_user       INTEGER NOT NULL REFERENCES users(id),
  offer         TEXT NOT NULL,                    -- JSON {pwc, cards:[{uid, qty}]}
  request       TEXT NOT NULL,                    -- idem
  content_hash  TEXT NOT NULL,
  value_offer   INTEGER NOT NULL,                 -- estimated value in CR at creation
  value_request INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('aberta', 'em_revisao', 'aceita', 'recusada', 'cancelada', 'expirada', 'revertida')),
  tx_id         INTEGER REFERENCES ledger_tx(id),
  reviewed_by   INTEGER REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  CHECK (from_user <> to_user)
);
CREATE INDEX trades_to ON trades(to_user, status);
CREATE INDEX trades_from ON trades(from_user, status);
CREATE INDEX trades_status ON trades(status, expires_at);

CREATE TABLE wishlist (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  card_uid TEXT NOT NULL REFERENCES card_catalog(uid),
  qty      INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 60),
  PRIMARY KEY (user_id, card_uid)
);

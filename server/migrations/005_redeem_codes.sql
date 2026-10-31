-- Redeem codes for events (docs/sdd/02-economia.md §5.5). Only hashes are stored; the codes are
-- shown once, when the batch is created.

CREATE TABLE redeem_batches (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  reward      TEXT NOT NULL,                      -- JSON {pwc, cr, cards:[{uid, qty}]}
  codes_count INTEGER NOT NULL,
  max_uses    INTEGER NOT NULL CHECK (max_uses >= 1),
  expires_at  INTEGER,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE redeem_codes (
  code_hash TEXT PRIMARY KEY,
  batch_id  INTEGER NOT NULL REFERENCES redeem_batches(id),
  uses      INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0)
);
CREATE INDEX redeem_codes_batch ON redeem_codes(batch_id);

CREATE TABLE redeem_uses (
  code_hash  TEXT NOT NULL REFERENCES redeem_codes(code_hash),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  tx_id      INTEGER NOT NULL REFERENCES ledger_tx(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code_hash, user_id)
);

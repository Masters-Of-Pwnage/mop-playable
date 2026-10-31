-- Accounts, sessions, operator tokens, settings and the admin audit trail (docs/sdd/00-arquitetura.md §4).
-- Times are epoch milliseconds.

CREATE TABLE users (
  id                 INTEGER PRIMARY KEY,
  public_id          TEXT NOT NULL UNIQUE,
  google_sub         TEXT UNIQUE,
  email              TEXT,
  display_name       TEXT NOT NULL,
  avatar_url         TEXT,
  show_avatar        INTEGER NOT NULL DEFAULT 0,
  role               TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin', 'owner')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
  suspended_until    INTEGER,
  trade_locked_until INTEGER,
  adult_confirmed_at INTEGER,
  created_at         INTEGER NOT NULL,
  last_login_at      INTEGER
);

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  auth_time  INTEGER NOT NULL,
  csrf_token TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE api_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  scopes     TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  action        TEXT NOT NULL,
  target        TEXT,
  before        TEXT,
  after         TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX audit_log_created ON audit_log(created_at);

-- The audit trail is append-only.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

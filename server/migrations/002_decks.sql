-- Account decks (docs/sdd/01-login-google.md §5). Same card list format as src/stores/decks.js: [{uid, amount}].

CREATE TABLE decks (
  id         TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  cards      TEXT NOT NULL,
  imported   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Results of "Coleção" rooms and daily reward counters (docs/sdd/02-economia.md §3, 00-arquitetura §6).

CREATE TABLE match_results (
  id          INTEGER PRIMARY KEY,
  room_code   TEXT NOT NULL,
  p0_user     INTEGER NOT NULL REFERENCES users(id),
  p1_user     INTEGER NOT NULL REFERENCES users(id),
  winner_seat INTEGER,                             -- -1 = draw, NULL = no agreement
  turns       INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL CHECK (status IN ('consenso', 'divergente', 'curta')),
  rewarded    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX match_results_p0 ON match_results(p0_user, created_at);
CREATE INDEX match_results_p1 ON match_results(p1_user, created_at);

CREATE TABLE reward_counters (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day     TEXT NOT NULL,
  kind    TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

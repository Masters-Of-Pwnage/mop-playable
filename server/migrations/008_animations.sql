-- Character animations (docs/sdd/03-animacoes.md): uploaded by the operator pipeline, reviewed in the admin.

CREATE TABLE animations (
  id          INTEGER PRIMARY KEY,
  card_uid    TEXT NOT NULL REFERENCES card_catalog(uid),
  tier        TEXT NOT NULL DEFAULT 'video' CHECK (tier IN ('css', 'video')),
  status      TEXT NOT NULL CHECK (status IN ('revisao', 'aprovada', 'rejeitada', 'arquivada')),
  files       TEXT NOT NULL,           -- JSON {webm, mp4, poster, bytes}
  provenance  TEXT,                    -- JSON {modelo, prompt, custo, tentativas, gerado_em}
  crop        TEXT NOT NULL,           -- JSON {x, y, w, h} in % of the card
  reason      TEXT,                    -- rejection reason
  created_by  INTEGER REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER
);
CREATE INDEX animations_card ON animations(card_uid, status);
-- At most one approved animation per card.
CREATE UNIQUE INDEX animations_one_approved ON animations(card_uid) WHERE status = 'aprovada';

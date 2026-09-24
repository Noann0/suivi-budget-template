/**
 * Migration 001, schema initial.
 *
 * Le SQL vit dans un module TypeScript et non dans un fichier .sql : le tracing de
 * `output: 'standalone'` ne recopie que les fichiers effectivement importes par le
 * graphe de modules. Un .sql lu au runtime via fs serait absent de l'image finale et
 * l'application planterait au premier demarrage en production, pas en local.
 *
 * Regles structurantes appliquees ici :
 * - tous les montants sont des INTEGER en centimes, aucune colonne REAL n'existe ;
 * - categories stocke une teinte (hue 1..16) et une intensite optionnelle, jamais un
 *   code hexadecimal : le mapping teinte vers couleur appartient au frontend ;
 * - categories et subcategories s'archivent, elles ne se suppriment pas : effacer une
 *   categorie rendrait faux tout l'historique des mois passes qui la referencent ;
 * - la suppression d'un mois, elle, cascade volontairement sur ses entrees et ses
 *   allocations : c'est une action explicite et locale a ce mois.
 */

export const migration001 = `
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE credentials (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL UNIQUE,
  public_key     BLOB NOT NULL,
  counter        INTEGER NOT NULL DEFAULT 0,
  transports     TEXT,
  device_name    TEXT,
  created_at     TEXT NOT NULL,
  last_used_at   TEXT
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

CREATE TABLE recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  used_at     TEXT,
  -- Tant que cette colonne est NULL, le code n'a pas ete montre ET confirme lu.
  -- L'utilisatrice connectee est alors renvoyee vers l'ecran qui le lui presente.
  -- Sans cet etat, l'affichage dependait d'une course entre le rendu client et la
  -- redirection serveur declenchee par la pose du cookie de session : le code etait
  -- genere, hache, et jamais vu par personne. Donc irrecuperable des le premier jour.
  acknowledged_at TEXT
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id, used_at);
CREATE INDEX idx_recovery_codes_pending ON recovery_codes(user_id, used_at, acknowledged_at);

CREATE TABLE enrollment_codes (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('initial', 'device', 'recovery')),
  -- Renseigne uniquement pour kind = 'recovery' : identifie le code de secours qui a
  -- produit ce code d'enrolement. Le code de secours n'est marque consomme qu'a la
  -- creation effective de la passkey, pas au moment de l'echange. Sans ce lien, une
  -- utilisatrice qui abandonne en cours de route perdait son code de secours pour rien
  -- et se retrouvait sans aucun moyen de reprendre la main.
  recovery_code_id TEXT REFERENCES recovery_codes(id) ON DELETE SET NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_enrollment_codes_open ON enrollment_codes(used_at, expires_at);

CREATE TABLE webauthn_challenges (
  id          TEXT PRIMARY KEY,
  challenge   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE rate_limits (
  bucket        TEXT NOT NULL,
  window_start  TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

-- Preferences utilisateur, table cle/valeur volontairement generique.
-- Premiere cle : color_intensity, valant 'soft' ou 'vivid', defaut 'soft'.
CREATE TABLE user_preferences (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE categories (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  hue         INTEGER NOT NULL CHECK (hue BETWEEN 1 AND 16),
  -- Nullable a dessein : NULL signifie "suit le reglage global d'intensite".
  -- Le designer a mesure qu'un secteur sature au milieu de pastels cree une fausse
  -- hierarchie visuelle, d'ou un interrupteur global plutot qu'un choix par categorie.
  -- La colonne reste la pour ouvrir un choix par categorie sans migration si besoin.
  intensity   TEXT CHECK (intensity IS NULL OR intensity IN ('soft', 'vivid')),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_categories_user_kind ON categories(user_id, kind, sort_order);

CREATE TABLE subcategories (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_subcategories_category ON subcategories(category_id, sort_order);

CREATE TABLE months (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  note        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, year, month)
);
CREATE INDEX idx_months_user_period ON months(user_id, year, month);

CREATE TABLE entries (
  id              TEXT PRIMARY KEY,
  month_id        TEXT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  subcategory_id  TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
  is_carried      INTEGER NOT NULL DEFAULT 0 CHECK (is_carried IN (0, 1)),
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (month_id, subcategory_id)
);
CREATE INDEX idx_entries_month ON entries(month_id);
CREATE INDEX idx_entries_subcategory ON entries(subcategory_id);

CREATE TABLE allocations (
  id            TEXT PRIMARY KEY,
  month_id      TEXT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('savings', 'debt')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_allocations_month ON allocations(month_id);
`;

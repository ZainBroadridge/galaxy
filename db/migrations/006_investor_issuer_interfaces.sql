-- Additive migration: existing events, snapshots, ballots and jobs are untouched.
ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS disclaimer_version text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS disclaimer_version text;
-- Older sessions have NULL disclaimer_version and cannot authenticate the new investor portal.

CREATE TABLE IF NOT EXISTS issuer_sessions (
  token_hash char(64) PRIMARY KEY,
  origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issuer_sessions_expiry_idx ON issuer_sessions(expires_at);

-- Small, validated issuer images live with the branding metadata. This avoids a
-- second storage service and keeps bundled presets independent of R2 documents.
CREATE TABLE IF NOT EXISTS issuer_logos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by varchar(42) NOT NULL,
  mime_type varchar(20) NOT NULL CHECK (mime_type IN ('image/png','image/jpeg')),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND 524288),
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(uploaded_by, sha256)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS issuer_name varchar(160) NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS token_platform varchar(80) NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS issuer_logo_preset varchar(24);
ALTER TABLE events ADD COLUMN IF NOT EXISTS issuer_logo_id uuid REFERENCES issuer_logos(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS issuer_theme_color varchar(7) NOT NULL DEFAULT '#24506e';
-- Do not infer an underlying issuer or platform from a historical token symbol.
-- Existing events fall back to token name in the presentation layer.

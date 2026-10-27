-- Native apps: refresh tokens rotate; one login = one family
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,              -- SHA-256; the token itself is never stored
  platform   text CHECK (platform IN ('ios', 'android', 'macos', 'windows', 'linux')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,                        -- rotated: presenting it again is reuse
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- Apple/Google accounts: the provider's sub is the stable key, not the email
CREATE TABLE user_identities (
  provider   text NOT NULL CHECK (provider IN ('apple', 'google')),
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

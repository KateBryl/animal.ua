-- Keep access tokens short-lived while refresh tokens remain valid for 30 days.
ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

UPDATE app_sessions
SET access_expires_at = LEAST(expires_at, created_at + interval '1 hour')
WHERE access_expires_at IS NULL;

ALTER TABLE app_sessions
  ALTER COLUMN access_expires_at SET DEFAULT (now() + interval '1 hour'),
  ALTER COLUMN access_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS pets_owner_created_at_idx ON pets(owner_id, created_at);

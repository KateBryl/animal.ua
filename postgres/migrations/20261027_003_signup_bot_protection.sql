CREATE TABLE IF NOT EXISTS signup_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_rate_limits_updated_at_idx
  ON signup_rate_limits(updated_at);

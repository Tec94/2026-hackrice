CREATE TABLE datasets (
  id text PRIMARY KEY, source text NOT NULL, start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL, candle_count integer NOT NULL CHECK(candle_count > 0)
);
CREATE TABLE candles (
  dataset_id text NOT NULL REFERENCES datasets(id), open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL, open numeric NOT NULL, high numeric NOT NULL,
  low numeric NOT NULL, close numeric NOT NULL, volume numeric NOT NULL,
  PRIMARY KEY(dataset_id, open_time),
  CHECK(close_time > open_time AND low >= 0 AND volume >= 0),
  CHECK(high >= open AND high >= close AND low <= open AND low <= close)
);
CREATE TABLE replay_sessions (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id),
  state jsonb NOT NULL, expires_at timestamptz NOT NULL,
  deleting boolean NOT NULL DEFAULT false
);
CREATE INDEX replay_owner_idx ON replay_sessions(user_id);
CREATE TABLE idempotency (
  user_id text NOT NULL REFERENCES "user"(id), scope text NOT NULL, key uuid NOT NULL,
  request_hash text NOT NULL, resource_id uuid, response jsonb,
  expires_at timestamptz NOT NULL, PRIMARY KEY(user_id,scope,key)
);
CREATE TABLE provider_owners (
  user_id text PRIMARY KEY REFERENCES "user"(id), backboard jsonb
);
CREATE TABLE deletions (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id),
  session_id uuid NOT NULL UNIQUE, public jsonb NOT NULL, cleanup jsonb NOT NULL
);

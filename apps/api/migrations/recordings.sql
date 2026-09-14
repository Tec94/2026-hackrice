CREATE TABLE recording_streams (
  id uuid PRIMARY KEY,
  finished boolean NOT NULL DEFAULT false
);

CREATE TABLE recording_chunks (
  recording_id uuid NOT NULL REFERENCES recording_streams(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  pcm bytea NOT NULL,
  PRIMARY KEY (recording_id, sequence)
);

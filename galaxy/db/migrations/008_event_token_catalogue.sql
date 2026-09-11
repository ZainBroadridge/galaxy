-- Presentation identity is copied onto each NEW event. Catalogue edits never
-- relabel previous events, rewrite metadata hashes, or modify snapshot entries.
ALTER TABLE events ADD COLUMN IF NOT EXISTS token_catalogue_id varchar(100);
ALTER TABLE events ADD COLUMN IF NOT EXISTS cusip varchar(9);
CREATE INDEX IF NOT EXISTS events_cusip_idx ON events(cusip) WHERE cusip IS NOT NULL;

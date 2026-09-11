-- Presentation only. Do not change historical metadata hashes, proposals, votes,
-- snapshot entries, or infer a share class from a token name/symbol.
ALTER TABLE events ADD COLUMN IF NOT EXISTS security_name varchar(240) NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS security_ticker varchar(24) NOT NULL DEFAULT '';

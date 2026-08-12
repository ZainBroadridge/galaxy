ALTER TABLE events
  ADD COLUMN IF NOT EXISTS announcement_message jsonb,
  ADD COLUMN IF NOT EXISTS announcement_signature text,
  ADD COLUMN IF NOT EXISTS announcement_published_at timestamptz;

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS signed_contract_address varchar(42);

UPDATE communications c
   SET signed_contract_address=e.contract_address
  FROM events e
 WHERE c.event_id=e.id
   AND c.scope='EVENT'
   AND c.signed_contract_address IS NULL;

CREATE TABLE IF NOT EXISTS event_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_name varchar(120) NOT NULL,
  object_key text NOT NULL UNIQUE,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  page_count integer NOT NULL CHECK (page_count > 0),
  sha256 char(64) NOT NULL,
  uploaded_by varchar(42) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS event_documents_event_idx
  ON event_documents(event_id, created_at)
  WHERE deleted_at IS NULL;

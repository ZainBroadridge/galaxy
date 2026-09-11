-- A separate durable email job must never be confused with relayer/deployment work.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('BUILD_SNAPSHOT','DEPLOY_EVENT','RELAY_VOTE','VERIFY_CONTRACT','SEND_VOTE_RECEIPT'));

CREATE TABLE IF NOT EXISTS vote_receipt_emails (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  vote_id uuid NOT NULL UNIQUE REFERENCES votes(id) ON DELETE CASCADE,
  recipient varchar(254),
  request_payload jsonb,
  first_attempt_at timestamptz,
  provider_message_id varchar(128),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_payload IS NULL OR (jsonb_typeof(request_payload) = 'object' AND recipient IS NOT NULL)),
  CHECK ((accepted_at IS NULL AND provider_message_id IS NULL) OR
         (accepted_at IS NOT NULL AND provider_message_id IS NOT NULL))
);

-- Execute com uma credencial administrativa primeiro no banco de Preview/test.
-- O UUID público impede que o identificador sequencial interno seja exposto nas URLs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE histories
  ADD COLUMN IF NOT EXISTS public_id TEXT;

UPDATE histories
SET public_id = gen_random_uuid()::text
WHERE public_id IS NULL;

ALTER TABLE histories
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_histories_public_id
  ON histories (public_id);

COMMIT;

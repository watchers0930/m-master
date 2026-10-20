-- Additive consulting migration. Compare existing structure before applying. Production application is out of scope.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "consulting_reports" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ko-KR',
    "diagnosis_summary" TEXT,
    "strategy_json" JSONB,
    "budget_proposal" JSONB,
    "priority_actions" JSONB,
    "input_snapshot_hash" TEXT NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT 'v1',
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "fail_code" TEXT,
    "attempt_id" TEXT NOT NULL,
    "ledger_id" TEXT,
    "cost_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserved_krw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consulting_reports_pkey" PRIMARY KEY ("id")
);


-- Fail closed on drift before adding indexes/FKs to a pre-existing table.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM (VALUES
    ('id','text',true),
    ('domain_id','text',true),
    ('owner_id','text',true),
    ('market','text',true),
    ('diagnosis_summary','text',false),
    ('strategy_json','jsonb',false),
    ('budget_proposal','jsonb',false),
    ('priority_actions','jsonb',false),
    ('input_snapshot_hash','text',true),
    ('input_snapshot','jsonb',true),
    ('schema_version','text',true),
    ('prompt_version','text',true),
    ('model','text',true),
    ('status','text',true),
    ('fail_code','text',false),
    ('attempt_id','text',true),
    ('ledger_id','text',false),
    ('cost_krw','double precision',true),
    ('reserved_krw','double precision',true),
    ('started_at','timestamp(3) without time zone',false),
    ('generated_at','timestamp(3) without time zone',false),
    ('created_at','timestamp(3) without time zone',true)
  ) AS expected(name, type, required)
  LEFT JOIN pg_attribute a ON a.attrelid='consulting_reports'::regclass AND a.attname=expected.name AND NOT a.attisdropped
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.type OR a.attnotnull<>expected.required
 ) OR (SELECT count(*) FROM pg_attribute WHERE attrelid='consulting_reports'::regclass AND attnum>0 AND NOT attisdropped)<>22 THEN
  RAISE EXCEPTION 'consulting_reports schema drift; review required';
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "consulting_reports_domain_id_market_input_snapshot_hash_key"
 ON "consulting_reports"("domain_id", "market", "input_snapshot_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "consulting_reports_ledger_id_key"
 ON "consulting_reports"("ledger_id");
CREATE INDEX IF NOT EXISTS "consulting_reports_domain_id_created_at_id_idx"
 ON "consulting_reports"("domain_id", "created_at" DESC, "id");
CREATE INDEX IF NOT EXISTS "consulting_reports_owner_id_created_at_id_idx"
 ON "consulting_reports"("owner_id", "created_at" DESC, "id");

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consulting_reports_domain_id_fkey' AND conrelid = '"consulting_reports"'::regclass) THEN
  ALTER TABLE "consulting_reports" ADD CONSTRAINT "consulting_reports_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;

DO $$
DECLARE expected RECORD; actual TEXT;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('consulting_reports_pkey','CREATE UNIQUE INDEX consulting_reports_pkey ON public.consulting_reports USING btree (id)'),
  ('consulting_reports_domain_id_market_input_snapshot_hash_key','CREATE UNIQUE INDEX consulting_reports_domain_id_market_input_snapshot_hash_key ON public.consulting_reports USING btree (domain_id, market, input_snapshot_hash)'),
  ('consulting_reports_ledger_id_key','CREATE UNIQUE INDEX consulting_reports_ledger_id_key ON public.consulting_reports USING btree (ledger_id)'),
  ('consulting_reports_domain_id_created_at_id_idx','CREATE INDEX consulting_reports_domain_id_created_at_id_idx ON public.consulting_reports USING btree (domain_id, created_at DESC, id)'),
  ('consulting_reports_owner_id_created_at_id_idx','CREATE INDEX consulting_reports_owner_id_created_at_id_idx ON public.consulting_reports USING btree (owner_id, created_at DESC, id)')
 ) e(name, definition) LOOP
  SELECT pg_get_indexdef(indexrelid) INTO actual FROM pg_index WHERE indrelid='consulting_reports'::regclass AND indexrelid=to_regclass(expected.name) AND indisvalid;
  IF actual IS DISTINCT FROM expected.definition THEN RAISE EXCEPTION 'consulting_reports index drift: %',expected.name; END IF;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='consulting_reports'::regclass
  AND conname='consulting_reports_domain_id_fkey' AND contype='f'
  AND pg_get_constraintdef(oid)='FOREIGN KEY (domain_id) REFERENCES domains(id) ON UPDATE CASCADE ON DELETE CASCADE')
 OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='consulting_reports'::regclass AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)') THEN
  RAISE EXCEPTION 'consulting_reports constraint drift';
 END IF;
END $$;
COMMIT;

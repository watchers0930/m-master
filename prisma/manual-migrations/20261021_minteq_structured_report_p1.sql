-- P1 additive migration. Isolated DB verification only; production deployment is separate.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS difficulty INTEGER;
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS cpc DOUBLE PRECISION;
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS ad_competition TEXT;
ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS ad_value DOUBLE PRECISION;
CREATE TABLE IF NOT EXISTS seo_demand_points (
  id TEXT NOT NULL PRIMARY KEY,
  domain_id TEXT NOT NULL,
  keyword_id TEXT,
  market TEXT NOT NULL,
  location INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  volume INTEGER NOT NULL,
  audit_id TEXT NOT NULL
);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('seo_keywords','competition','double precision',false),
      ('seo_keywords','difficulty','integer',false),
      ('seo_keywords','cpc','double precision',false),
      ('seo_keywords','ad_competition','text',false),
      ('seo_keywords','ad_value','double precision',false),
      ('seo_demand_points','id','text',true),
      ('seo_demand_points','domain_id','text',true),
      ('seo_demand_points','keyword_id','text',false),
      ('seo_demand_points','market','text',true),
      ('seo_demand_points','location','integer',true),
      ('seo_demand_points','year','integer',true),
      ('seo_demand_points','month','integer',true),
      ('seo_demand_points','volume','integer',true),
      ('seo_demand_points','audit_id','text',true)
    ) expected(tbl,col,typ,required)
    LEFT JOIN information_schema.columns c ON c.table_schema=current_schema() AND c.table_name=expected.tbl AND c.column_name=expected.col
    WHERE c.column_name IS NULL OR c.data_type<>expected.typ OR (c.is_nullable='NO')<>expected.required
  ) THEN RAISE EXCEPTION 'P1 column schema drift'; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS seo_demand_points_keyword_id_location_year_month_key ON seo_demand_points(keyword_id,location,year,month);
CREATE INDEX IF NOT EXISTS seo_demand_points_domain_id_market_location_idx ON seo_demand_points(domain_id,market,location);
DO $$
DECLARE r RECORD; actual TEXT;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('seo_demand_points_keyword_id_location_year_month_key',true,'keyword_id, location, year, month'),
    ('seo_demand_points_domain_id_market_location_idx',false,'domain_id, market, location')
  ) v(name,uniq,cols) LOOP
    SELECT string_agg(pg_get_indexdef(i.indexrelid,n,true),', ' ORDER BY n) INTO actual
    FROM pg_index i CROSS JOIN LATERAL generate_series(1,i.indnkeyatts) n
    WHERE i.indexrelid=to_regclass(r.name) AND i.indrelid='seo_demand_points'::regclass
      AND i.indisunique=r.uniq AND i.indisvalid AND i.indpred IS NULL;
    IF actual IS DISTINCT FROM r.cols THEN RAISE EXCEPTION 'P1 index drift: %',r.name; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('domain_id','domains'),('keyword_id','seo_keywords'),('audit_id','seo_audits')) v(col,tbl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='seo_demand_points_'||r.col||'_fkey' AND conrelid='seo_demand_points'::regclass) THEN
      EXECUTE format('ALTER TABLE seo_demand_points ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE',
        'seo_demand_points_'||r.col||'_fkey',r.col,r.tbl);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname=r.col
      JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attname='id'
      WHERE c.conname='seo_demand_points_'||r.col||'_fkey' AND c.contype='f' AND c.conrelid='seo_demand_points'::regclass
      AND c.confrelid=to_regclass(r.tbl) AND c.confdeltype='c' AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[b.attnum])
    THEN RAISE EXCEPTION 'P1 FK drift: %',r.col; END IF;
  END LOOP;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='seo_demand_points'::regclass AND contype='p'
    AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='seo_demand_points'::regclass AND attname='id')])
  THEN RAISE EXCEPTION 'P1 primary key drift'; END IF;
END $$;
COMMIT;

-- Failed concurrent builds leave INVALID indexes that IF NOT EXISTS cannot repair.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid=to_regclass('seo_tasks_frozen_input_path_idx') AND NOT indisvalid)
  THEN DROP INDEX IF EXISTS seo_tasks_frozen_input_path_idx; END IF;
END $$;

-- @> containment uses jsonb_path_ops; this operator class does not support ?.
CREATE INDEX CONCURRENTLY IF NOT EXISTS seo_tasks_frozen_input_path_idx ON seo_tasks USING GIN (frozen_input jsonb_path_ops);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_am am ON am.oid=c.relam
    JOIN pg_opclass op ON op.oid=i.indclass[0]
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='frozen_input'
    WHERE i.indexrelid=to_regclass('seo_tasks_frozen_input_path_idx')
      AND i.indrelid='seo_tasks'::regclass AND am.amname='gin' AND op.opcname='jsonb_path_ops'
      AND i.indisvalid AND NOT i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
  ) THEN RAISE EXCEPTION 'P1 metric provenance index drift'; END IF;
END $$;

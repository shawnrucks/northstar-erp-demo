-- Durable demo reset controls, canonical seed templates, and database-level
-- integrity rules. The live demo data can be restored from these templates
-- without running an operating-system process from the web application.

CREATE TABLE northstar_demo_user_templates (
  email text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'ADMIN',
    'SALES_COORDINATOR',
    'BUYER',
    'PRODUCTION_PLANNER',
    'OPERATIONS_ANALYST',
    'ACCOUNTS_PAYABLE',
    'QUALITY_SPECIALIST'
  )),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0)
);

CREATE TABLE northstar_demo_record_templates (
  number text PRIMARY KEY,
  type text NOT NULL CHECK (type ~ '^[A-Z][A-Z0-9_]*$'),
  title text NOT NULL,
  party text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status ~ '^[A-Z][A-Z0-9_]*$'),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT')),
  owner text NOT NULL DEFAULT '',
  due_date date,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object')
);

CREATE TABLE northstar_demo_relation_templates (
  parent_number text NOT NULL REFERENCES northstar_demo_record_templates(number) ON UPDATE CASCADE ON DELETE CASCADE,
  child_number text NOT NULL REFERENCES northstar_demo_record_templates(number) ON UPDATE CASCADE ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type ~ '^[A-Z][A-Z0-9_]*$'),
  CHECK (parent_number <> child_number),
  PRIMARY KEY (parent_number, child_number, relation_type)
);

CREATE TABLE northstar_demo_cost_line_templates (
  record_number text NOT NULL REFERENCES northstar_demo_record_templates(number) ON UPDATE CASCADE ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'MATERIAL',
    'OUTSIDE_PROCESSING',
    'LABOR',
    'MACHINE',
    'SETUP',
    'TOOLING',
    'PACKAGING',
    'FREIGHT',
    'SCRAP',
    'OVERHEAD',
    'OTHER'
  )),
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_cost numeric(18, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (record_number, sort_order, category, description)
);

CREATE TABLE demo_reset_runs (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  requested_by text NOT NULL,
  requested_by_role text NOT NULL,
  requested_session text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  record_count integer,
  generation bigint,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX demo_reset_runs_requested_at ON demo_reset_runs (requested_at DESC);

CREATE TABLE demo_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seed_version integer NOT NULL DEFAULT 0 CHECK (seed_version >= 0),
  anchor_date date,
  canonical_record_count integer NOT NULL DEFAULT 0 CHECK (canonical_record_count >= 0),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  reset_in_progress boolean NOT NULL DEFAULT false,
  active_reset_run_id uuid,
  last_reset_started_at timestamptz,
  last_reset_completed_at timestamptz,
  last_reset_by text,
  cooldown_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (reset_in_progress AND active_reset_run_id IS NOT NULL AND last_reset_started_at IS NOT NULL)
    OR (NOT reset_in_progress AND active_reset_run_id IS NULL)
  )
);

INSERT INTO demo_state (singleton) VALUES (true);

CREATE FUNCTION northstar_reject_audit_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only and cannot be truncated';
END;
$$;

CREATE TRIGGER audit_events_reject_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION northstar_reject_audit_truncate();

CREATE FUNCTION northstar_protect_final_report()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('northstar.demo_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'final reports are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_protect_final_update_delete
BEFORE UPDATE OR DELETE ON reports
FOR EACH ROW EXECUTE FUNCTION northstar_protect_final_report();

CREATE FUNCTION northstar_protect_final_report_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('northstar.demo_reset', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM reports WHERE status = 'FINAL') THEN
    RAISE EXCEPTION 'final reports are immutable';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER reports_protect_final_truncate
BEFORE TRUNCATE ON reports
FOR EACH STATEMENT EXECUTE FUNCTION northstar_protect_final_report_truncate();

CREATE FUNCTION northstar_protect_final_report_records()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  report_is_final boolean;
  report_changed_in_transaction boolean;
BEGIN
  IF current_setting('northstar.demo_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE must authorize both sides. Otherwise a linked row could be moved
  -- out of a previously finalized report and into a draft report.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status = 'FINAL', xmin::text::bigint = txid_current()
      INTO report_is_final, report_changed_in_transaction
      FROM reports
     WHERE id = OLD.report_id;
    IF report_is_final AND NOT report_changed_in_transaction THEN
      RAISE EXCEPTION 'final report record snapshots are immutable';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status = 'FINAL', xmin::text::bigint = txid_current()
      INTO report_is_final, report_changed_in_transaction
      FROM reports
     WHERE id = NEW.report_id;
    -- A report may establish its included-record snapshot in the same
    -- transaction that changes it from DRAFT to FINAL. Later changes are denied.
    IF report_is_final AND NOT report_changed_in_transaction THEN
      RAISE EXCEPTION 'final report record snapshots are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_records_protect_final_mutation
BEFORE INSERT OR UPDATE OR DELETE ON report_records
FOR EACH ROW EXECUTE FUNCTION northstar_protect_final_report_records();

CREATE FUNCTION northstar_protect_final_report_records_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('northstar.demo_reset', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM reports WHERE status = 'FINAL') THEN
    RAISE EXCEPTION 'final report record snapshots are immutable';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER report_records_protect_final_truncate
BEFORE TRUNCATE ON report_records
FOR EACH STATEMENT EXECUTE FUNCTION northstar_protect_final_report_records_truncate();

CREATE FUNCTION northstar_apply_demo_templates(
  p_run_id uuid,
  p_user_name text,
  p_user_role text,
  p_session_id text,
  p_cooldown_seconds integer DEFAULT 300
)
RETURNS TABLE (completed_generation bigint, restored_record_count integer, reset_completed_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  template_count integer;
  expected_count integer;
  next_generation bigint;
  completion_time timestamptz := clock_timestamp();
BEGIN
  IF current_setting('northstar.demo_reset', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'demo reset context is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('northstar_demo_data_v1'));

  SELECT canonical_record_count
    INTO expected_count
    FROM demo_state
   WHERE singleton = true
   FOR UPDATE;

  SELECT count(*)::integer INTO template_count FROM northstar_demo_record_templates;
  IF template_count <> expected_count OR template_count <> 2090 THEN
    RAISE EXCEPTION 'canonical demo templates are incomplete';
  END IF;
  IF (SELECT count(*) FROM northstar_demo_user_templates) <> 7 THEN
    RAISE EXCEPTION 'canonical demo user templates are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM demo_reset_runs WHERE id = p_run_id AND status = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'demo reset run is not active';
  END IF;

  -- TRUNCATE obtains ACCESS EXCLUSIVE table locks, preventing a live mutation
  -- from observing or writing a partially restored dataset. audit_events and
  -- reset-control tables are deliberately excluded and remain durable.
  TRUNCATE TABLE
    northstar_sessions,
    report_records,
    reports,
    tasks,
    communications,
    notes,
    record_cost_lines,
    record_relations,
    records,
    users
  RESTART IDENTITY CASCADE;

  INSERT INTO users (email, name, role, password_hash, active, credential_version)
  SELECT email, name, role, password_hash, active, credential_version
    FROM northstar_demo_user_templates
   ORDER BY email;

  INSERT INTO records (type, number, title, party, status, priority, owner, due_date, data)
  SELECT type, number, title, party, status, priority, owner, due_date, data
    FROM northstar_demo_record_templates
   ORDER BY number;

  INSERT INTO record_relations (parent_number, child_number, relation_type)
  SELECT parent_number, child_number, relation_type
    FROM northstar_demo_relation_templates
   ORDER BY parent_number, child_number, relation_type;

  INSERT INTO record_cost_lines
    (record_number, category, description, quantity, unit_cost, sort_order)
  SELECT record_number, category, description, quantity, unit_cost, sort_order
    FROM northstar_demo_cost_line_templates
   ORDER BY record_number, sort_order, category, description;

  UPDATE demo_state
     SET generation = generation + 1,
         reset_in_progress = false,
         active_reset_run_id = NULL,
         last_reset_completed_at = completion_time,
         last_reset_by = p_user_name,
         cooldown_until = completion_time
           + make_interval(secs => greatest(0, least(p_cooldown_seconds, 86400))),
         updated_at = completion_time
   WHERE singleton = true
   RETURNING generation INTO next_generation;

  UPDATE demo_reset_runs
     SET status = 'SUCCEEDED',
         completed_at = completion_time,
         record_count = template_count,
         generation = next_generation
   WHERE id = p_run_id;

  INSERT INTO northstar_meta (key, value)
  SELECT 'demo_seed', jsonb_build_object(
    'version', seed_version,
    'anchorDate', anchor_date,
    'recordCount', canonical_record_count,
    'generation', generation,
    'lastResetAt', completion_time
  )
    FROM demo_state
   WHERE singleton = true
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  INSERT INTO audit_events
    (user_name, user_role, module, record_type, record_number, action,
     field_changed, previous_value, new_value, note, session_id, metadata)
  VALUES
    (p_user_name, p_user_role, 'Administration', 'Demo Data', 'SYSTEM-DEMO',
     'Demo data reset', 'generation', (next_generation - 1)::text,
     next_generation::text, 'Canonical demo data restored; prior audit history retained.',
     p_session_id, jsonb_build_object(
       'resetRunId', p_run_id,
       'recordCount', template_count,
       'generation', next_generation,
       'auditPreserved', true
     ));

  RETURN QUERY SELECT next_generation, template_count, completion_time;
END;
$$;

COMMENT ON TABLE northstar_demo_record_templates IS 'Canonical immutable-at-runtime source rows used by the controlled demo reset.';
COMMENT ON TABLE demo_reset_runs IS 'Durable, idempotent history of controlled demo reset attempts.';
COMMENT ON TABLE demo_state IS 'Singleton demo generation, reset state, template metadata, and cooldown.';

-- KytosHub: Sprint 4 - Parking control, parking loans and guard gate sessions
-- 1) parking_spots / vehicles / parking_loans / parking_access_logs per tenant schema
-- 2) guard_gate_sessions: persists which gate a security agent is assigned to,
--    so entry/exit records and cart loans know the guard's gate without re-picking.
-- 3) Feature flag `parking_control` in condo_settings (enabled by default).

-- Idempotent helper: provisions Sprint 4 tables + module flag for a tenant schema
CREATE OR REPLACE FUNCTION public.seed_parking_control(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_tbl text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_spots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_number varchar(20) NOT NULL UNIQUE,
        type varchar(20) NOT NULL DEFAULT ''PROPIO'' CHECK (type IN (''PROPIO'', ''VISITA'', ''DISCAPACITADOS'')),
        department_id uuid REFERENCES %I.departments(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT ''DISPONIBLE'' CHECK (status IN (''DISPONIBLE'', ''OCUPADO'')),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.vehicles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        license_plate varchar(20) NOT NULL,
        brand varchar(60),
        model varchar(60),
        color varchar(30),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(department_id, license_plate)
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_loans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_id uuid NOT NULL REFERENCES %I.parking_spots(id) ON DELETE CASCADE,
        lender_department_id uuid REFERENCES %I.departments(id) ON DELETE CASCADE,
        borrower_department_id uuid REFERENCES %I.departments(id) ON DELETE CASCADE,
        borrower_vehicle_plate varchar(20),
        start_time timestamptz NOT NULL,
        end_time timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT ''PENDIENTE'' CHECK (status IN (''PENDIENTE'', ''ACTIVO'', ''FINALIZADO'', ''CANCELADO'')),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_access_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_id uuid REFERENCES %I.parking_spots(id) ON DELETE SET NULL,
        license_plate varchar(20) NOT NULL,
        driver_name varchar(120),
        entry_time timestamptz NOT NULL DEFAULT now(),
        exit_time timestamptz,
        entry_gate_id uuid REFERENCES %I.condo_gates(id) ON DELETE SET NULL,
        exit_gate_id uuid REFERENCES %I.condo_gates(id) ON DELETE SET NULL,
        authorized_by_user_id uuid,
        guard_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.guard_gate_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        gate_id uuid NOT NULL REFERENCES %I.condo_gates(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_spots_dept ON %I.parking_spots(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_dept ON %I.vehicles(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON %I.vehicles(license_plate)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_loans_spot ON %I.parking_loans(spot_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_loans_borrower ON %I.parking_loans(borrower_department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_logs_plate ON %I.parking_access_logs(license_plate)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_logs_open ON %I.parking_access_logs(exit_time) WHERE exit_time IS NULL', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_guard_sessions_user ON %I.guard_gate_sessions(user_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['parking_spots', 'vehicles', 'parking_loans', 'parking_access_logs', 'guard_gate_sessions']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read parking') THEN
            EXECUTE format('CREATE POLICY "read parking" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write parking') THEN
            EXECUTE format('CREATE POLICY "admin write parking" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''parking_control'', true, ''{}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_parking_control(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_parking_control(t.id);
    END LOOP;
END $$;
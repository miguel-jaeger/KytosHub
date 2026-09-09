-- KytosHub: Condominium gates (garitas) with name and per-type cart capacity
-- Gates/doors are a condominium-level concern (they will also be the entry/exit
-- points for the future parking module). They are stored in a per-schema table
-- `condo_gates` and referenced by carts via `gate_id`.

-- Provision/backfill helper: ensures condo_gates exists and seeds defaults.
CREATE OR REPLACE FUNCTION public.seed_condo_gates(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_gates_count int := 2;
    v_default_carts int := 5;
    v_idx int;
    v_gate_id uuid;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_gates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL,
        code varchar(30),
        is_entry_exit boolean NOT NULL DEFAULT true,
        carts_carga int NOT NULL DEFAULT 0,
        carts_compra int NOT NULL DEFAULT 0,
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    -- Read existing cart_lending config to seed sensible capacity defaults
    BEGIN
        EXECUTE format('SELECT (config_json->>''gates_count'')::int, (config_json->>''carts_per_gate'')::int
            FROM %I.condo_settings WHERE module_key = ''cart_lending'' LIMIT 1', v_schema)
            INTO v_gates_count, v_default_carts;
        IF v_gates_count IS NULL OR v_gates_count <= 0 THEN v_gates_count := 2; END IF;
        IF v_default_carts IS NULL OR v_default_carts <= 0 THEN v_default_carts := 5; END IF;
    EXCEPTION WHEN OTHERS THEN
        v_gates_count := 2; v_default_carts := 5;
    END;

    -- Seed default gates if none exist
    EXECUTE format('SELECT count(*) FROM %I.condo_gates', v_schema) INTO v_idx;
    IF v_idx = 0 THEN
        FOR v_idx IN 1..v_gates_count LOOP
            EXECUTE format('INSERT INTO %I.condo_gates (name, code, is_entry_exit, carts_carga, carts_compra, sort_order)
                VALUES (%L, %L, true, %L, %L, %L) RETURNING id',
                v_schema,
                'Puerta ' || v_idx,
                'P' || v_idx,
                (v_idx % 2 = 1)::int * v_default_carts,
                (v_idx % 2 = 0)::int * v_default_carts,
                v_idx)
                INTO v_gate_id;
        END LOOP;
    END IF;

    -- Convert carts.gate (integer) to gate_id (uuid FK). The carts table may
    -- not exist yet in some schemas (it is created by seed_condo_modules once
    -- the base structure exists), so guard the migration.
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema AND c.relname = 'carts' AND c.relkind = 'r'
    ) THEN
        EXECUTE format('ALTER TABLE %I.carts ADD COLUMN IF NOT EXISTS gate_id uuid REFERENCES %I.condo_gates(id)', v_schema, v_schema);

        -- Backfill gate_id from the old integer gate position
        EXECUTE format('UPDATE %I.carts c SET gate_id = g.id
            FROM %I.condo_gates g
            WHERE c.gate_id IS NULL AND c.gate IS NOT NULL
              AND g.sort_order = c.gate', v_schema, v_schema);
    END IF;

    EXECUTE format('GRANT SELECT ON %I.condo_gates TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I.condo_gates TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON %I.condo_gates TO project_admin', v_schema);
    EXECUTE format('ALTER TABLE %I.condo_gates ENABLE ROW LEVEL SECURITY', v_schema);

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_gates' AND policyname = 'read gates') THEN
        EXECUTE format('CREATE POLICY "read gates" ON %I.condo_gates FOR SELECT TO anon, authenticated USING (true)', v_schema);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_gates' AND policyname = 'admin write gates') THEN
        EXECUTE format('CREATE POLICY "admin write gates" ON %I.condo_gates FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, p_tenant_id, p_tenant_id);
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_condo_gates(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_condo_gates(t.id);
    END LOOP;
END $$;

-- KytosHub: Sprint 6 - Tower Boards and General Board modules
-- 1) tower_boards / tower_board_members per tenant schema: elected board
--    (PRESIDENTE, SECRETARIO, TESORERO) per tower, elected only from tower
--    residents, with a 1-year term (extendable via new elections) and an
--    active flag that tracks which board is currently in force.
-- 2) general_boards / general_board_members: the condominium-wide board with
--    the same structure, elected only from members of the tower boards.
-- 3) Feature flags `tower_boards` and `general_board` in condo_settings (off).

CREATE OR REPLACE FUNCTION public.seed_tower_general_boards(p_tenant_id uuid)
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

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.tower_boards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.tower_board_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id uuid NOT NULL REFERENCES %I.tower_boards(id) ON DELETE CASCADE,
        resident_id uuid NOT NULL REFERENCES %I.residents(id) ON DELETE CASCADE,
        role varchar(20) NOT NULL CHECK (role IN (''PRESIDENTE'', ''SECRETARIO'', ''TESORERO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(board_id, role)
    )', v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.general_boards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.general_board_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id uuid NOT NULL REFERENCES %I.general_boards(id) ON DELETE CASCADE,
        board_member_id uuid NOT NULL REFERENCES %I.tower_board_members(id) ON DELETE CASCADE,
        role varchar(20) NOT NULL CHECK (role IN (''PRESIDENTE'', ''SECRETARIO'', ''TESORERO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(board_id, role)
    )', v_schema, v_schema, v_schema);

    -- At most one active board per tower (tower boards)
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_tower_boards_active ON %I.tower_boards(tower_id) WHERE is_active', v_schema);
    -- At most one active general board
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_general_boards_active ON %I.general_boards(is_active) WHERE is_active', v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_boards_tower ON %I.tower_boards(tower_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_board_members_board ON %I.tower_board_members(board_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_board_members_resident ON %I.tower_board_members(resident_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_general_board_members_board ON %I.general_board_members(board_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['tower_boards', 'tower_board_members', 'general_boards', 'general_board_members']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read boards') THEN
            EXECUTE format('CREATE POLICY "read boards" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write boards') THEN
            EXECUTE format('CREATE POLICY "admin write boards" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    -- Feature flags: off by default, like other optional modules
    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''tower_boards'', false, ''{"term_months":12}''::jsonb),
        (''general_board'', false, ''{"term_months":12}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_tower_general_boards(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_tower_general_boards(t.id);
    END LOOP;
END $$;
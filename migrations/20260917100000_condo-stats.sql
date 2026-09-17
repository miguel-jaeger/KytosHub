-- KytosHub: condo_stats — cached aggregate statistics per condominium schema.
-- The frontend reads this single row instead of recomputing aggregates from the
-- full tables (logs, vehicles, loans, spots) on every page load, which was slow.
-- A refresh function recomputes the counters. Statement-level triggers call it
-- whenever a cart loan is created/returned, a cart changes state, a vehicle
-- enters/exits or a spot, vehicle or parking loan changes. A one-time backfill
-- captures current values.

CREATE OR REPLACE FUNCTION public.seed_condo_stats(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_stats (
        id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        access_total bigint NOT NULL DEFAULT 0,
        access_inside bigint NOT NULL DEFAULT 0,
        access_entry_today bigint NOT NULL DEFAULT 0,
        access_exit_total bigint NOT NULL DEFAULT 0,
        access_exit_today bigint NOT NULL DEFAULT 0,
        vehicles_total bigint NOT NULL DEFAULT 0,
        spots_total bigint NOT NULL DEFAULT 0,
        spots_occupied bigint NOT NULL DEFAULT 0,
        parking_loans_total bigint NOT NULL DEFAULT 0,
        parking_loans_active bigint NOT NULL DEFAULT 0,
        carts_total bigint NOT NULL DEFAULT 0,
        carts_disponible bigint NOT NULL DEFAULT 0,
        carts_prestado bigint NOT NULL DEFAULT 0,
        carts_mantenimiento bigint NOT NULL DEFAULT 0,
        cart_loans_total bigint NOT NULL DEFAULT 0,
        cart_loans_active bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    EXECUTE format('GRANT SELECT ON %I.condo_stats TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I.condo_stats TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON %I.condo_stats TO project_admin', v_schema);
    EXECUTE format('ALTER TABLE %I.condo_stats ENABLE ROW LEVEL SECURITY', v_schema);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_stats' AND policyname = 'read stats') THEN
        EXECUTE format('CREATE POLICY "read stats" ON %I.condo_stats FOR SELECT TO anon, authenticated USING (true)', v_schema);
    END IF;

    -- Refresh function: recomputes every counter (safe to call directly).
    EXECUTE format($f1$
CREATE OR REPLACE FUNCTION %1$I.refresh_condo_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $f2$
DECLARE
    v_access_total bigint;
    v_access_inside bigint;
    v_access_entry_today bigint;
    v_access_exit_total bigint;
    v_access_exit_today bigint;
    v_vehicles_total bigint;
    v_spots_total bigint;
    v_spots_occupied bigint;
    v_parking_loans_total bigint;
    v_parking_loans_active bigint;
    v_carts_total bigint := 0;
    v_carts_disponible bigint := 0;
    v_carts_prestado bigint := 0;
    v_carts_mantenimiento bigint := 0;
    v_cart_loans_total bigint := 0;
    v_cart_loans_active bigint := 0;
BEGIN
    SELECT COUNT(*) INTO v_access_total FROM %1$I.parking_access_logs;
    SELECT COUNT(*) INTO v_access_inside FROM %1$I.parking_access_logs WHERE exit_time IS NULL;
    SELECT COUNT(*) INTO v_access_entry_today FROM %1$I.parking_access_logs WHERE entry_time::date = CURRENT_DATE;
    SELECT COUNT(*) INTO v_access_exit_total FROM %1$I.parking_access_logs WHERE exit_time IS NOT NULL;
    SELECT COUNT(*) INTO v_access_exit_today FROM %1$I.parking_access_logs WHERE exit_time IS NOT NULL AND exit_time::date = CURRENT_DATE;
    SELECT COUNT(*) INTO v_vehicles_total FROM %1$I.vehicles;
    SELECT COUNT(*) INTO v_spots_total FROM %1$I.parking_spots;
    SELECT COUNT(*) INTO v_spots_occupied FROM %1$I.parking_spots
        WHERE status = 'OCUPADO' OR id IN (SELECT spot_id FROM %1$I.parking_access_logs WHERE exit_time IS NULL AND spot_id IS NOT NULL);
    SELECT COUNT(*) INTO v_parking_loans_total FROM %1$I.parking_loans;
    SELECT COUNT(*) INTO v_parking_loans_active FROM %1$I.parking_loans WHERE status = 'ACTIVO';

    IF to_regclass(%2$L) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_carts_total FROM %1$I.carts;
        SELECT COUNT(*) INTO v_carts_disponible FROM %1$I.carts WHERE status = 'DISPONIBLE';
        SELECT COUNT(*) INTO v_carts_prestado FROM %1$I.carts WHERE status = 'PRESTADO';
        SELECT COUNT(*) INTO v_carts_mantenimiento FROM %1$I.carts WHERE status = 'MANTENIMIENTO';
        SELECT COUNT(*) INTO v_cart_loans_total FROM %1$I.cart_loans;
        SELECT COUNT(*) INTO v_cart_loans_active FROM %1$I.cart_loans WHERE status IN ('ACTIVO', 'ATRASADO');
    END IF;

    INSERT INTO %1$I.condo_stats (id, access_total, access_inside, access_entry_today, access_exit_total, access_exit_today,
        vehicles_total, spots_total, spots_occupied, parking_loans_total, parking_loans_active,
        carts_total, carts_disponible, carts_prestado, carts_mantenimiento, cart_loans_total, cart_loans_active, updated_at)
    VALUES (1, v_access_total, v_access_inside, v_access_entry_today, v_access_exit_total, v_access_exit_today,
        v_vehicles_total, v_spots_total, v_spots_occupied, v_parking_loans_total, v_parking_loans_active,
        v_carts_total, v_carts_disponible, v_carts_prestado, v_carts_mantenimiento, v_cart_loans_total, v_cart_loans_active, now())
    ON CONFLICT (id) DO UPDATE SET
        access_total = EXCLUDED.access_total,
        access_inside = EXCLUDED.access_inside,
        access_entry_today = EXCLUDED.access_entry_today,
        access_exit_total = EXCLUDED.access_exit_total,
        access_exit_today = EXCLUDED.access_exit_today,
        vehicles_total = EXCLUDED.vehicles_total,
        spots_total = EXCLUDED.spots_total,
        spots_occupied = EXCLUDED.spots_occupied,
        parking_loans_total = EXCLUDED.parking_loans_total,
        parking_loans_active = EXCLUDED.parking_loans_active,
        carts_total = EXCLUDED.carts_total,
        carts_disponible = EXCLUDED.carts_disponible,
        carts_prestado = EXCLUDED.carts_prestado,
        carts_mantenimiento = EXCLUDED.carts_mantenimiento,
        cart_loans_total = EXCLUDED.cart_loans_total,
        cart_loans_active = EXCLUDED.cart_loans_active,
        updated_at = now();
END;
$f2$
$f1$, v_schema, v_schema || '.carts');
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.refresh_condo_stats() TO public', v_schema);

    -- Statement-level trigger wrapper (fires once per statement, even multi-row)
    EXECUTE format($t1$
CREATE OR REPLACE FUNCTION %1$I.recompute_condo_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $t2$
BEGIN
    PERFORM %1$I.refresh_condo_stats();
    RETURN NULL;
END;
$t2$
$t1$, v_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.recompute_condo_stats() TO public', v_schema);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_access ON %I.parking_access_logs', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_access AFTER INSERT OR UPDATE OR DELETE ON %I.parking_access_logs FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_spots ON %I.parking_spots', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_spots AFTER INSERT OR UPDATE OR DELETE ON %I.parking_spots FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_vehicles ON %I.vehicles', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_vehicles AFTER INSERT OR UPDATE OR DELETE ON %I.vehicles FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_parking_loans ON %I.parking_loans', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_parking_loans AFTER INSERT OR UPDATE OR DELETE ON %I.parking_loans FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);

    IF to_regclass(v_schema || '.carts') IS NOT NULL THEN
        EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_carts ON %I.carts', v_schema);
        EXECUTE format('CREATE TRIGGER trg_condo_stats_carts AFTER INSERT OR UPDATE OR DELETE ON %I.carts FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_cart_loans ON %I.cart_loans', v_schema);
        EXECUTE format('CREATE TRIGGER trg_condo_stats_cart_loans AFTER INSERT OR UPDATE OR DELETE ON %I.cart_loans FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    END IF;

    -- Backfill: capture current values once
    EXECUTE format('SELECT %I.refresh_condo_stats()', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_condo_stats(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_condo_stats(t.id);
    END LOOP;
END $$;
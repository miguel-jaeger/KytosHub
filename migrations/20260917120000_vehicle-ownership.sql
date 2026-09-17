-- KytosHub: vehicle ownership
-- Tracks which user created each vehicle so residents can only edit/delete the
-- vehicles they registered themselves. Admin/security keep full control.

DO $$
DECLARE s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.vehicles ADD COLUMN IF NOT EXISTS created_by_user_id uuid', s);
            EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_created_by ON %I.vehicles(created_by_user_id)', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
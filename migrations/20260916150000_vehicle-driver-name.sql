-- KytosHub: Sprint 4 - Driver/owner name per vehicle
-- When a car of a PROPIO spot enters the garage, the gate logs the vehicle's
-- driver_name automatically (set when the vehicle is registered by its owner,
-- e.g. the department owner) instead of asking the guard every time. Visitors
-- and rented parking keep the manual driver input.

DO $$
DECLARE s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.vehicles ADD COLUMN IF NOT EXISTS driver_name varchar(120)', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
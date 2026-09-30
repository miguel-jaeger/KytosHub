-- KytosHub: Sprint 4 - Cocheras are MULTIPLE by default
-- Individual cocheras host a single vehicle; multiple cocheras host up to 3
-- vehicles (at most one auto, the rest motos). Existing spots are backfilled to
-- MULTIPLE so the new default applies to the whole parking.

DO $$
DECLARE
    s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.parking_spots DROP CONSTRAINT IF EXISTS parking_spots_cochera_type_check', s);
            EXECUTE format('UPDATE %I.parking_spots SET cochera_type = ''MULTIPLE'' WHERE cochera_type IS NULL OR cochera_type NOT IN (''INDIVIDUAL'', ''MULTIPLE'')', s);
            EXECUTE format('ALTER TABLE %I.parking_spots ALTER COLUMN cochera_type SET DEFAULT ''MULTIPLE''', s);
            EXECUTE format('ALTER TABLE %I.parking_spots ADD CONSTRAINT parking_spots_cochera_type_check CHECK (cochera_type IN (''INDIVIDUAL'', ''MULTIPLE''))', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
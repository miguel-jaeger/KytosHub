-- KytosHub: Sprint 4 - Parking spot type (cochera type): INDIVIDUAL or MULTIPLE
-- Adds cochera_type to parking_spots so each cochera can be marked as individual
-- (a single vehicle) or multiple (several vehicles may share it).

DO $$
DECLARE
    s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.parking_spots ADD COLUMN IF NOT EXISTS cochera_type varchar(20) NOT NULL DEFAULT ''INDIVIDUAL''', s);
            EXECUTE format('ALTER TABLE %I.parking_spots DROP CONSTRAINT IF EXISTS parking_spots_cochera_type_check', s);
            EXECUTE format('ALTER TABLE %I.parking_spots ADD CONSTRAINT parking_spots_cochera_type_check CHECK (cochera_type IN (''INDIVIDUAL'', ''MULTIPLE''))', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
-- KytosHub: Sprint 4 - parking loans store borrower vehicle type (AUTO/MOTO)
-- The owner lends to a person + vehicle; knowing the vehicle type helps the
-- garita occupancy rule (motos may share) and the loan table shows the type.

DO $$
DECLARE s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I.parking_loans ADD COLUMN IF NOT EXISTS borrower_vehicle_type varchar(10)', s);
            EXECUTE format('ALTER TABLE %I.parking_loans DROP CONSTRAINT IF EXISTS parking_loans_borrower_vehicle_type_check', s);
            EXECUTE format('ALTER TABLE %I.parking_loans ADD CONSTRAINT parking_loans_borrower_vehicle_type_check CHECK (borrower_vehicle_type IS NULL OR borrower_vehicle_type IN (''AUTO'', ''MOTO''))', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
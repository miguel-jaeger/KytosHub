-- KytosHub: Sprint 4 - Reset persisted parking layout configuration
-- Deletes the saved parking_control layout (rows, spots per row, row names and
-- orientation) from condo_settings.config_json for every tenant, so the parking
-- configuration starts clean and the new layout settings are saved from zero.

DO $$
DECLARE
    s text;
    cfg jsonb;
    spotted boolean;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        BEGIN
            EXECUTE format('SELECT config_json FROM %I.condo_settings WHERE module_key = ''parking_control'' LIMIT 1', s)
                INTO cfg;
            IF cfg IS NULL THEN
                CONTINUE;
            END IF;
            IF cfg ? 'layout' THEN
                EXECUTE format(
                    'UPDATE %I.condo_settings
                     SET config_json = config_json - ''layout'', updated_at = now()
                     WHERE module_key = ''parking_control''',
                    s
                );
            END IF;
            -- Clear positional hints on existing spots so the map falls back until
            -- the admin regenerates the layout.
            EXECUTE format('UPDATE %I.parking_spots SET spot_row = NULL, spot_index = NULL', s);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
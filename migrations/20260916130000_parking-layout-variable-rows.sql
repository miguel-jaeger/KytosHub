-- KytosHub: Sprint 4 - Variable spots per row in parking layout
-- Replaces provision_parking_layout(uuid, int, int) with a version that accepts
-- an integer array (one count per row), so each row can have a different number
-- of spots. Layout config persists spots_per_row as an array.

DROP FUNCTION IF EXISTS public.provision_parking_layout(uuid, int, int);

CREATE OR REPLACE FUNCTION public.provision_parking_layout(p_tenant_id uuid, p_rows int, p_spots_per_row integer[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_total int;
    v_width int;
    v_index int;
    v_row int;
    v_col int;
    v_count int;
    v_num text;
    v_flag boolean;
    v_created int := 0;
    v_updated int := 0;
    v_counts integer[];
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'tenant_not_found');
    END IF;

    IF p_rows IS NULL OR p_rows < 1 OR p_spots_per_row IS NULL OR cardinality(p_spots_per_row) < 1 THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'invalid_layout');
    END IF;

    EXECUTE format('ALTER TABLE %I.parking_spots ADD COLUMN IF NOT EXISTS spot_row integer', v_schema);
    EXECUTE format('ALTER TABLE %I.parking_spots ADD COLUMN IF NOT EXISTS spot_index integer', v_schema);

    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''parking_control'', true, ''{}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);

    v_counts := p_spots_per_row;
    IF cardinality(v_counts) < p_rows THEN
        v_counts := v_counts || array_fill(1, ARRAY[p_rows - cardinality(v_counts)]);
    ELSIF cardinality(v_counts) > p_rows THEN
        v_counts := v_counts[1:p_rows];
    END IF;

    v_total := 0;
    FOR v_row IN 1..p_rows LOOP
        v_total := v_total + greatest(1, coalesce(v_counts[v_row], 1));
    END LOOP;

    v_width := length(v_total::text);
    v_index := 1;

    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, v_width, '0');
            EXECUTE format(
                'INSERT INTO %I.parking_spots (spot_number, type, status, spot_row, spot_index)
                 VALUES (%L, ''PROPIO'', ''DISPONIBLE'', %s, %s)
                 ON CONFLICT (spot_number) DO UPDATE
                 SET spot_row = EXCLUDED.spot_row, spot_index = EXCLUDED.spot_index
                 RETURNING (xmax = 0) AS inserted',
                v_schema, v_num, v_row, v_col
            ) INTO v_flag;
            IF v_flag THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
            v_index := v_index + 1;
        END LOOP;
    END LOOP;

    EXECUTE format(
        'UPDATE %I.condo_settings SET config_json = config_json || %L::jsonb, updated_at = now()
         WHERE module_key = ''parking_control''',
        v_schema, jsonb_build_object('layout', jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts))
    );

    RETURN jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts, 'total', v_total, 'created', v_created, 'updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_parking_layout(uuid, int, integer[]) TO project_admin;
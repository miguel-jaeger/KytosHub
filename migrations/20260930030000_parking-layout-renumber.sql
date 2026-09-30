-- KytosHub: Sprint 4 - Force consecutive spot numbering on every layout provision
-- The previous upsert-by-number kept the old spot_number of existing spots, so after
-- reconfiguring rows/counts the layout could show non-consecutive numbers. This
-- version renumbers every spot in row order (fila 1: 1..x, fila 2: x+1..n, fila 3:
-- n+1..z, ...) while keeping spots that fall outside the new layout after the range
-- (so nothing is deleted and the spot_number unique constraint is never violated).

DROP FUNCTION IF EXISTS public.provision_parking_layout(uuid, int, integer[]);
DROP FUNCTION IF EXISTS public.provision_parking_layout(uuid, int, integer[], text[]);
DROP FUNCTION IF EXISTS public.provision_parking_layout(uuid, int, integer[], text[], text);
DROP FUNCTION IF EXISTS public.provision_parking_layout(uuid, int, int);

CREATE OR REPLACE FUNCTION public.provision_parking_layout(
    p_tenant_id uuid,
    p_rows int,
    p_spots_per_row integer[],
    p_row_names text[] DEFAULT NULL,
    p_orientation text DEFAULT 'HORIZONTAL'
)
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
    v_names text[];
    v_orientation text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'tenant_not_found');
    END IF;

    IF p_rows IS NULL OR p_rows < 1 OR p_spots_per_row IS NULL OR cardinality(p_spots_per_row) < 1 THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'invalid_layout');
    END IF;

    v_orientation := CASE WHEN upper(btrim(p_orientation)) = 'VERTICAL' THEN 'VERTICAL' ELSE 'HORIZONTAL' END;

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

    -- Row names: use the provided col, fall back to "Fila N".
    v_names := ARRAY[]::text[];
    FOR v_row IN 1..p_rows LOOP
        IF p_row_names IS NOT NULL AND v_row <= cardinality(p_row_names)
           AND p_row_names[v_row] IS NOT NULL AND btrim(p_row_names[v_row]) <> '' THEN
            v_names := v_names || btrim(left(p_row_names[v_row], 60));
        ELSE
            v_names := v_names || ('Fila ' || v_row);
        END IF;
    END LOOP;

    v_total := 0;
    FOR v_row IN 1..p_rows LOOP
        v_total := v_total + greatest(1, coalesce(v_counts[v_row], 1));
    END LOOP;

    v_width := length(v_total::text);
    v_index := 1;

    -- Phase 1: ensure every (row, col) slot exists (upsert by old number keeps
    -- existing spots and just repositions them to the new layout).
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

    -- Phase 2: renumber consecutively so the display is always
    -- fila 1 -> 1..x, fila 2 -> x+1..n, fila 3 -> n+1..z, ...
    -- Neutralize all numbers first (unique sentinel) to avoid collisions on the
    -- spot_number unique constraint while we rewrite them.
    EXECUTE format('UPDATE %I.parking_spots SET spot_number = ''tmp-'' || id::text', v_schema);

    v_index := 1;
    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, v_width, '0');
            EXECUTE format(
                'UPDATE %I.parking_spots SET spot_number = %L WHERE spot_row = %s AND spot_index = %s',
                v_schema, v_num, v_row, v_col
            );
            v_index := v_index + 1;
        END LOOP;
    END LOOP;

    -- Phase 3: spots outside the new layout keep existing but are renumbered after
    -- the layout range so the sequence stays unique and nothing is lost.
    EXECUTE format(
        'WITH leftover AS (
             SELECT id
             FROM %I.parking_spots
             WHERE spot_number LIKE ''tmp-%%''
             ORDER BY created_at, id
         ), numbered AS (
             SELECT id, row_number() OVER () AS rn FROM leftover
         )
         UPDATE %I.parking_spots AS s
         SET spot_number = lpad((%s + numbered.rn)::text, %s, ''0'')
         FROM numbered
         WHERE s.id = numbered.id',
        v_schema, v_schema, v_total, v_width
    );

    EXECUTE format(
        'UPDATE %I.condo_settings SET config_json = config_json || %L::jsonb, updated_at = now()
         WHERE module_key = ''parking_control''',
        v_schema, jsonb_build_object('layout',
            jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts, 'row_names', v_names, 'orientation', v_orientation))
    );

    RETURN jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts, 'row_names', v_names, 'orientation', v_orientation, 'total', v_total, 'created', v_created, 'updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_parking_layout(uuid, int, integer[], text[], text) TO project_admin;
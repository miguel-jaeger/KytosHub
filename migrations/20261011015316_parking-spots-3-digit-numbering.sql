-- Canonicalize parking numbers to 001-999 and merge legacy duplicate rows.
DO $$
DECLARE
    t record;
    v_schema text;
    v_spot record;
    v_target record;
    v_number integer;
    v_canonical text;
BEGIN
    FOR t IN SELECT schema_name FROM public.tenants WHERE schema_name IS NOT NULL LOOP
        v_schema := t.schema_name;
        IF to_regclass(format('%I.parking_spots', v_schema)) IS NULL THEN CONTINUE; END IF;

        FOR v_spot IN EXECUTE format(
            'SELECT id, spot_number, department_id, type, status, cochera_type
             FROM %I.parking_spots
             WHERE spot_number !~ ''^[0-9]{3}$'' OR spot_number = ''000''
             ORDER BY created_at, id',
            v_schema
        ) LOOP
            IF v_spot.spot_number !~ '^[0-9]{1,3}$' THEN
                RAISE EXCEPTION 'Cannot safely normalize parking spot % in schema %', v_spot.spot_number, v_schema;
            END IF;

            v_number := v_spot.spot_number::integer;
            IF v_number < 1 OR v_number > 999 THEN
                RAISE EXCEPTION 'Parking spot % is outside the supported range 001-999 in schema %', v_spot.spot_number, v_schema;
            END IF;
            v_canonical := lpad(v_number::text, 3, '0');

            EXECUTE format('SELECT id, department_id FROM %I.parking_spots WHERE spot_number = %L', v_schema, v_canonical)
                INTO v_target;
            IF v_target.id IS NOT NULL AND v_target.id <> v_spot.id THEN
                IF v_target.department_id IS NOT NULL
                   AND v_spot.department_id IS NOT NULL
                   AND v_target.department_id <> v_spot.department_id THEN
                    RAISE EXCEPTION 'Conflicting department assignments for parking spot % in schema %', v_canonical, v_schema;
                END IF;

                EXECUTE format(
                    'UPDATE %I.parking_spots AS canonical
                     SET department_id = COALESCE(canonical.department_id, source.department_id),
                         type = CASE WHEN canonical.department_id IS NULL AND source.department_id IS NOT NULL THEN source.type ELSE canonical.type END,
                         cochera_type = CASE WHEN canonical.department_id IS NULL AND source.department_id IS NOT NULL THEN source.cochera_type ELSE canonical.cochera_type END,
                         status = CASE WHEN canonical.status = ''OCUPADO'' OR source.status = ''OCUPADO'' THEN ''OCUPADO'' ELSE canonical.status END
                     FROM %I.parking_spots AS source
                     WHERE canonical.id = %L AND source.id = %L',
                    v_schema, v_schema, v_target.id, v_spot.id
                );
                IF to_regclass(format('%I.parking_loans', v_schema)) IS NOT NULL THEN
                    EXECUTE format('UPDATE %I.parking_loans SET spot_id = %L WHERE spot_id = %L', v_schema, v_target.id, v_spot.id);
                END IF;
                IF to_regclass(format('%I.parking_access_logs', v_schema)) IS NOT NULL THEN
                    EXECUTE format('UPDATE %I.parking_access_logs SET spot_id = %L WHERE spot_id = %L', v_schema, v_target.id, v_spot.id);
                END IF;
                EXECUTE format('DELETE FROM %I.parking_spots WHERE id = %L', v_schema, v_spot.id);
            ELSE
                EXECUTE format('UPDATE %I.parking_spots SET spot_number = %L WHERE id = %L', v_schema, v_canonical, v_spot.id);
            END IF;
        END LOOP;

        EXECUTE format('SELECT count(*) FROM %I.parking_spots WHERE spot_number !~ ''^[0-9]{3}$''', v_schema) INTO v_number;
        IF v_number > 0 THEN
            RAISE EXCEPTION 'Found % parking spots without three-digit numbers in schema %', v_number, v_schema;
        END IF;
    END LOOP;
END;
$$;

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
    v_index int;
    v_row int;
    v_col int;
    v_count int;
    v_num text;
    v_flag boolean;
    v_created int := 0;
    v_updated int := 0;
    v_leftovers int;
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
    IF v_total > 999 THEN
        RAISE EXCEPTION 'Parking layout exceeds the three-digit limit of 999 spots';
    END IF;

    v_index := 1;
    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, 3, '0');
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

    EXECUTE format('UPDATE %I.parking_spots SET spot_number = ''tmp-'' || id::text', v_schema);
    v_index := 1;
    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, 3, '0');
            EXECUTE format(
                'UPDATE %I.parking_spots SET spot_number = %L WHERE spot_row = %s AND spot_index = %s',
                v_schema, v_num, v_row, v_col
            );
            v_index := v_index + 1;
        END LOOP;
    END LOOP;

    EXECUTE format('SELECT count(*) FROM %I.parking_spots WHERE spot_number LIKE ''tmp-%%''', v_schema) INTO v_leftovers;
    IF v_total + v_leftovers > 999 THEN
        RAISE EXCEPTION 'Parking layout and preserved extra spots exceed the three-digit limit of 999';
    END IF;
    EXECUTE format(
        'WITH leftover AS (
             SELECT id FROM %I.parking_spots WHERE spot_number LIKE ''tmp-%%'' ORDER BY created_at, id
         ), numbered AS (
             SELECT id, row_number() OVER () AS rn FROM leftover
         )
         UPDATE %I.parking_spots AS s
         SET spot_number = lpad((%s + numbered.rn)::text, 3, ''0'')
         FROM numbered WHERE s.id = numbered.id',
        v_schema, v_schema, v_total
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

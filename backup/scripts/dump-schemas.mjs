import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DUMPS_DIR,
  REPORTS_DIR,
  cliJson,
  dateParts,
  ensureBackupDirs,
  log,
  normalizeSource,
  parseArgs,
  printHelp,
  sha256,
  warn,
  writeJson,
} from './lib.mjs'

// Esquemas que forman el sistema: datos de la app, cuentas y un esquema por
// condominio (multi-tenant). Los esquemas internos de la plataforma
// (storage, schedules, payments, realtime, ...) van en el snapshot cloud.
const TARGET_SCHEMAS = "(table_schema = 'public' or table_schema = 'auth' or table_schema like 'condo%')"
const BATCH_SIZE = 200

const HELP = `Uso: node backup/scripts/dump-schemas.mjs [opciones]

Exporta los DATOS de todos los esquemas del sistema (public, auth y todos los
condo_* multi-tenant) a un unico archivo SQL portable con INSERTs, y verifica
los conteos fila por fila contra la base.

Opciones:
  --output <archivo>   Ruta de salida (default backup/dumps/all-schemas-<fecha>.sql)
  --schemas <lista>    Esquemas separados por coma (default: public,auth,condo%)
  --help               Muestra esta ayuda`

function ident(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function valueLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function listTargetTables() {
  const query = `select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' and ${TARGET_SCHEMAS} order by table_schema, table_name`
  const result = cliJson(['db', 'query', query, '--json'])
  return result.rows ?? []
}

function listColumnsByTable() {
  const query = `select table_schema, table_name, column_name from information_schema.columns where ${TARGET_SCHEMAS} order by table_schema, table_name, ordinal_position`
  const result = cliJson(['db', 'query', query, '--json'])
  const columns = new Map()
  for (const row of result.rows ?? []) {
    const key = `${row.table_schema}.${row.table_name}`
    if (!columns.has(key)) columns.set(key, [])
    columns.get(key).push(row.column_name)
  }
  return columns
}

function fetchRows(schema, table, columns) {
  const projection = columns.map((column) => `${ident(column)}::text as ${ident(column)}`).join(', ')
  const query = `select coalesce(json_agg(x), '[]'::json) as filas from (select ${projection} from ${ident(schema)}.${ident(table)}) x`
  const result = cliJson(['db', 'query', query, '--json'])
  let rows = result.rows?.[0]?.filas ?? []
  if (typeof rows === 'string') rows = JSON.parse(rows)
  return rows
}

function insertStatements(schema, table, columns, rows) {
  const target = `${ident(schema)}.${ident(table)}`
  const columnList = columns.map(ident).join(', ')
  const blocks = []
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE)
    const values = batch
      .map((row) => `(${columns.map((column) => valueLiteral(row[column])).join(', ')})`)
      .join(',\n  ')
    blocks.push(`INSERT INTO ${target} (${columnList}) VALUES\n  ${values};`)
  }
  return blocks.join('\n')
}

function liveRowCounts() {
  const query = `select schemaname, relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text::bigint as filas from pg_stat_user_tables where schemaname = 'public' or schemaname = 'auth' or schemaname like 'condo%' order by 1, 2`
  const result = cliJson(['db', 'query', query, '--json'])
  const counts = new Map()
  for (const row of result.rows ?? []) counts.set(`${row.schemaname}.${row.relname}`, Number(row.filas))
  return counts
}

export function captureStructureInventory() {
  const catalog = {
    schemas: `select nspname as schema from pg_namespace where nspname = 'public' or nspname = 'auth' or nspname like 'condo%' order by 1`,
    columns: `select table_schema, table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' or table_schema = 'auth' or table_schema like 'condo%' order by 1, 2, ordinal_position`,
    indexes: `select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = 'public' or schemaname = 'auth' or schemaname like 'condo%' order by 1, 2, 3`,
    constraints: `select n.nspname as schema, c.relname as table, con.conname as name, pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' or n.nspname = 'auth' or n.nspname like 'condo%' order by 1, 2, 3`,
    policies: `select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' or schemaname = 'auth' or schemaname like 'condo%' order by 1, 2, 3`,
    functions: `select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' or n.nspname = 'auth' or n.nspname like 'condo%' order by 1, 2, 3`,
    triggers: `select n.nspname as schema, c.relname as table, t.tgname as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and (n.nspname = 'public' or n.nspname = 'auth' or n.nspname like 'condo%') order by 1, 2, 3`,
    views: `select schemaname, viewname from pg_views where schemaname = 'public' or schemaname = 'auth' or schemaname like 'condo%' order by 1, 2`,
  }

  const structure = {}
  for (const [key, query] of Object.entries(catalog)) {
    structure[key] = cliJson(['db', 'query', query, '--json']).rows ?? []
  }
  return structure
}

export function dumpAllSchemas({ output = null, verbose = true } = {}) {
  ensureBackupDirs()
  const stamp = dateParts().stamp
  const file = output ?? join(DUMPS_DIR, `all-schemas-${stamp}.sql`)
  const tables = listTargetTables()
  if (!tables.length) throw new Error('No se encontraron tablas para exportar')
  const columnsByTable = listColumnsByTable()

  const lines = [
    '-- Salva completa multi-tenant (datos) — KytosHub / InsForge',
    `-- Generado: ${new Date().toISOString()}`,
    `-- Esquemas: public, auth y todos los condo_* (${new Set(tables.map((t) => t.table_schema)).size} esquemas)`,
    `-- Tablas: ${tables.length}`,
    '--',
    '-- Restauracion (requiere los esquemas/tablas creados por migrations/):',
    '--   psql "$INSFORGE_DATABASE_URL" -v ON_ERROR_STOP=1 -f <este archivo>',
    '--   o: npx -y @insforge/cli db import <este archivo>',
    '--',
    'SET statement_timeout = 0;',
    "SET client_encoding = 'UTF8';",
    'SET standard_conforming_strings = on;',
    'SET session_replication_role = replica;',
    'BEGIN;',
    '',
  ]

  const byTable = {}
  let totalRows = 0
  let currentSchema = null

  for (const { table_schema: schema, table_name: table } of tables) {
    const columns = columnsByTable.get(`${schema}.${table}`) ?? []
    if (!columns.length) continue
    const rows = fetchRows(schema, table, columns)
    if (schema !== currentSchema) {
      lines.push('', `-- Esquema: ${schema}`, '')
      currentSchema = schema
    }
    lines.push(`-- Tabla: ${schema}.${table} (${rows.length} filas)`)
    if (rows.length) lines.push(insertStatements(schema, table, columns, rows))
    lines.push('')
    byTable[`${schema}.${table}`] = rows.length
    totalRows += rows.length
    if (verbose) log(`  ${schema}.${table}: ${rows.length} filas`)
  }

  lines.push('COMMIT;', 'RESET session_replication_role;', '')

  const sql = normalizeSource(lines.join('\n'))
  const buffer = Buffer.from(sql)
  writeFileSync(file, buffer)
  const hash = sha256(buffer)
  writeFileSync(`${file}.sha256`, `${hash}  ${file.split(/[\\/]/).pop()}\n`)

  const live = liveRowCounts()
  const mismatches = []
  for (const [key, dumped] of Object.entries(byTable)) {
    const expected = live.get(key)
    if (expected === undefined) continue
    if (expected !== dumped) mismatches.push({ table: key, db: expected, dump: dumped })
  }

  const bySchema = {}
  for (const [key, count] of Object.entries(byTable)) {
    const schema = key.split('.')[0]
    if (!bySchema[schema]) bySchema[schema] = { tables: 0, rows: 0 }
    bySchema[schema].tables += 1
    bySchema[schema].rows += count
  }

  if (verbose) {
    log(`  archivo: ${file}`)
    log(`  ${Object.keys(bySchema).length} esquemas, ${Object.keys(byTable).length} tablas, ${totalRows} filas`)
  }
  if (mismatches.length) {
    warn(`  AVISO: conteos distintos entre la base y la salva: ${mismatches.map((m) => `${m.table}(${m.db}/${m.dump})`).join(', ')}`)
  }

  return {
    file,
    bytes: buffer.length,
    sha256: hash,
    schemas: Object.keys(bySchema).sort(),
    tables: Object.keys(byTable).length,
    rows: totalRows,
    bySchema,
    byTable,
    mismatches,
  }
}

export function writeStructureInventory() {
  ensureBackupDirs()
  const structure = captureStructureInventory()
  const file = join(REPORTS_DIR, `structure-inventory-${dateParts().day}.json`)
  writeJson(file, { generatedAt: new Date().toISOString(), ...structure })
  return { file, counts: Object.fromEntries(Object.entries(structure).map(([key, value]) => [key, value.length])) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp([HELP])
    return
  }
  log('Salva multi-tenant (datos)')
  const result = dumpAllSchemas({ output: args.output ?? null })
  const inventory = writeStructureInventory()
  log(`Inventario de estructura: ${inventory.file}`)
  log(`  ${JSON.stringify(inventory.counts)}`)
  if (result.mismatches.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  })
}

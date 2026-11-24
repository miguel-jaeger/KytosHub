import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { captureFunctions } from './audit.mjs'
import { dumpAllSchemas, writeStructureInventory } from './dump-schemas.mjs'
import {
  CLOUD_DIR,
  DEFAULT_KEEP,
  DUMPS_DIR,
  EXPORT_ROW_LIMIT,
  MANIFEST_FILE,
  REPORTS_DIR,
  SCHEMA_DIR,
  cliJson,
  countDumpStats,
  dateParts,
  downloadFile,
  ensureBackupDirs,
  formatBytes,
  getProject,
  log,
  normalizeSource,
  parseArgs,
  printHelp,
  projectLabel,
  pruneCloud,
  pruneDumps,
  readJson,
  runCli,
  sha256,
  warn,
  writeJson,
} from './lib.mjs'

const HELP = `Uso: node backup/scripts/backup.mjs [opciones]

Hace la salva completa del proyecto InsForge enlazado:
  1. Descarga el snapshot cloud actual (pg_dump completo: esquema + datos + auth)
  2. Rota el snapshot cloud (borra el descargado y crea uno nuevo del dia)
  3. Exporta datos del esquema public (db export) a backup/dumps/
  4. Exporta DATOS de todos los esquemas multi-tenant (public, auth, condo_*)
  5. Guarda el esquema sin datos en backup/schema/schema-latest.sql
  6. Copia el codigo desplegado de las edge functions a backup/functions/
  7. Genera inventario de estructura y verifica conteos contra la base

Opciones:
  --keep <n>      Cantidad de salvas locales a conservar (default ${DEFAULT_KEEP})
  --no-cloud      No toca los backups cloud de InsForge
  --no-dump       No exporta los datos de la base
  --no-schema     No regenera el esquema
  --no-functions  No copia las edge functions
  --help          Muestra esta ayuda`

function parseCliJson(stdout) {
  const start = stdout.search(/[{[]/)
  if (start < 0) return null
  return JSON.parse(stdout.slice(start))
}

function validateSnapshot(buffer, file) {
  const plain = gunzipSync(buffer)
  if (plain.length < 1024) throw new Error(`El snapshot cloud ${file} parece vacio tras descomprimir`)
  const text = plain.toString('utf8')
  const copyBlocks = (text.match(/^COPY /gm) ?? []).length
  const hasAuthUsers = /^COPY auth\.users /m.test(text)
  const tenantBlocks = (text.match(/^COPY condo_/gm) ?? []).length
  if (!copyBlocks) throw new Error(`El snapshot cloud ${file} no contiene bloques COPY (dump vacio o invalido)`)
  return { plain, text, copyBlocks, hasAuthUsers, tenantBlocks }
}

async function downloadSnapshot(latest, { warnings, label }) {
  if (!latest?.download_url || !latest?.file) return null
  const dest = join(CLOUD_DIR, latest.file)
  if (existsSync(dest)) {
    const buffer = readFileSync(dest)
    const validation = validateSnapshot(buffer, latest.file)
    log(`  snapshot cloud ya descargado: ${latest.file} (${formatBytes(buffer.length)})`)
    return { file: latest.file, bytes: buffer.length, skipped: true, copyBlocks: validation.copyBlocks, hasAuthUsers: validation.hasAuthUsers, tenantBlocks: validation.tenantBlocks }
  }
  const buffer = await downloadFile(latest.download_url, dest)
  const validation = validateSnapshot(buffer, latest.file)
  writeFileSync(`${dest}.sha256`, `${sha256(buffer)}  ${latest.file}\n`)
  log(`  ${label}: ${latest.file} (${formatBytes(buffer.length)}, ${validation.copyBlocks} tablas con datos)`)
  if (!validation.hasAuthUsers) warnings.push(`El snapshot ${latest.file} no contiene auth.users`)
  if (!validation.tenantBlocks) warnings.push(`El snapshot ${latest.file} no contiene tablas condo_*`)
  return { file: latest.file, bytes: buffer.length, sha256: sha256(buffer), copyBlocks: validation.copyBlocks, hasAuthUsers: validation.hasAuthUsers, tenantBlocks: validation.tenantBlocks }
}

async function saveCloudSnapshot({ warnings }) {
  const list = cliJson(['backups', 'list', '--json'])
  const backups = Array.isArray(list) ? list : []
  const completed = backups
    .filter((backup) => backup.status === 'completed')
    .sort((a, b) => String(b.triggered_at).localeCompare(String(a.triggered_at)))

  let latest = null
  const latestResult = runCli(['backups', 'latest', '--json'], { allowFailure: true })
  if (latestResult.ok) {
    try {
      latest = parseCliJson(latestResult.stdout)
    } catch {
      warnings.push('No se pudo leer la respuesta de "backups latest"')
    }
  }

  const savedBefore = latest ? await downloadSnapshot(latest, { warnings, label: 'snapshot cloud previo guardado' }) : null
  if (!savedBefore) warnings.push('No hay snapshot cloud previo descargable')

  if (completed.length === 1 && savedBefore) {
    const target = completed[0]
    const removed = runCli(['backups', 'delete', target.id, '-y', '--json'], { allowFailure: true })
    if (removed.ok) log(`  snapshot cloud liberado: ${target.name ?? target.id}`)
    else warnings.push(`No se pudo borrar el snapshot cloud ${target.id}; revisa la cuota manualmente`)
  } else if (completed.length > 1) {
    warnings.push(`Hay ${completed.length} backups cloud; no se borra ninguno automaticamente`)
  } else if (!savedBefore) {
    warnings.push('No se borra el snapshot cloud previo porque no se pudo descargar')
  }

  const name = `full-${dateParts().day}`
  const created = runCli(['backups', 'create', '--name', name, '--wait', '--json'], { allowFailure: true })
  if (!created.ok) {
    const detail = (created.stderr || created.stdout).trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ')
    warnings.push(`No se pudo crear el snapshot cloud: ${detail}`)
    return { savedBefore, savedAfter: null, created: null }
  }
  log(`  snapshot cloud creado: ${name}`)

  let savedAfter = null
  const afterResult = runCli(['backups', 'latest', '--json'], { allowFailure: true })
  if (afterResult.ok) {
    try {
      const after = parseCliJson(afterResult.stdout)
      savedAfter = await downloadSnapshot(after, { warnings, label: 'snapshot cloud nuevo guardado' })
    } catch (error) {
      warnings.push(`No se pudo descargar el snapshot cloud nuevo: ${error.message}`)
    }
  } else {
    warnings.push('No se pudo consultar el snapshot cloud nuevo despues de crearlo')
  }

  return { savedBefore, savedAfter, created: { name } }
}

function exportSql({ withData }) {
  const tmp = join(DUMPS_DIR, `.export-${process.pid}.json`)
  const args = ['db', 'export', '--include-functions', '--include-sequences', '--include-views', '--output', tmp]
  if (withData) args.push('--row-limit', String(EXPORT_ROW_LIMIT))
  else args.push('--no-data')

  runCli(args)
  const raw = readFileSync(tmp, 'utf8')
  unlinkSync(tmp)

  let sql = raw
  let meta = {}
  if (raw.trimStart().startsWith('{')) {
    const parsed = JSON.parse(raw)
    if (typeof parsed.data !== 'string') throw new Error('El export no trae el campo "data" con el SQL')
    sql = parsed.data
    meta = parsed
  }
  if (!/CREATE TABLE/i.test(sql)) throw new Error('El export no contiene sentencias CREATE TABLE')
  return { sql: normalizeSource(sql), meta }
}

function verifyRowCounts(tableNames, insertsByTable, warnings) {
  if (!tableNames.length) return null
  const query = tableNames
    .map((table) => `select '${table}' as tabla, count(*)::bigint as filas from public.${table}`)
    .join(' union all ')
  let rows
  try {
    const result = cliJson(['db', 'query', query, '--json'])
    rows = result.rows ?? []
  } catch (error) {
    warnings.push(`No se pudieron verificar los conteos de public contra la base: ${error.message}`)
    return null
  }
  const mismatches = []
  for (const row of rows) {
    const expected = Number(row.filas)
    const dumped = insertsByTable[row.tabla] ?? 0
    if (expected !== dumped) mismatches.push({ table: row.tabla, db: expected, dump: dumped })
  }
  if (mismatches.length) {
    warnings.push(`Conteos distintos entre la base y el dump de public: ${mismatches.map((m) => `${m.table}(${m.db}/${m.dump})`).join(', ')}`)
  }
  return { tables: rows.length, mismatches }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp([HELP])
    return
  }

  ensureBackupDirs()
  const keep = Number(args.keep ?? DEFAULT_KEEP)
  if (!Number.isFinite(keep) || keep < 1) throw new Error('--keep debe ser un numero mayor o igual a 1')

  const project = getProject()
  const today = dateParts()
  const warnings = []
  const result = {
    ranAt: new Date().toISOString(),
    host: process.env.COMPUTERNAME || process.env.HOSTNAME || 'local',
    project,
    cloud: null,
    dump: null,
    allSchemas: null,
    schema: null,
    functions: null,
    structure: null,
    warnings,
  }

  log(`Salva completa multi-tenant — ${today.day}`)
  log(`Proyecto: ${projectLabel(project)}`)
  log('')

  if (!args.noCloud) {
    log('[1/7] Snapshot cloud completo (esquema + datos + auth)')
    result.cloud = await saveCloudSnapshot({ warnings })
    if (result.cloud?.savedAfter?.file) {
      const gz = join(CLOUD_DIR, result.cloud.savedAfter.file)
      const plainFile = join(DUMPS_DIR, `full-system-${today.stamp}.sql`)
      const plain = gunzipSync(readFileSync(gz))
      writeFileSync(plainFile, plain)
      writeFileSync(`${plainFile}.sha256`, `${sha256(plain)}  full-system-${today.stamp}.sql\n`)
      result.fullSystem = {
        file: `backup/dumps/full-system-${today.stamp}.sql`,
        bytes: plain.length,
        sha256: sha256(plain),
        source: result.cloud.savedAfter.file,
      }
      log(`  dump completo descomprimido: ${plainFile} (${formatBytes(plain.length)})`)
    }
  } else {
    log('[1/7] Snapshot cloud omitido (--no-cloud)')
  }

  if (!args.noDump) {
    log('[2/7] Exportando datos del esquema public (db export)')
    const { sql, meta } = exportSql({ withData: true })
    const stats = countDumpStats(sql)
    const file = join(DUMPS_DIR, `db-${today.stamp}.sql`)
    const buffer = Buffer.from(sql)
    writeFileSync(file, buffer)
    const hash = sha256(buffer)
    writeFileSync(`${file}.sha256`, `${hash}  db-${today.stamp}.sql\n`)

    const truncatedTables = meta.truncatedTables ?? []
    if (truncatedTables.length) {
      warnings.push(`Tablas de public truncadas por el limite de ${meta.rowLimit ?? EXPORT_ROW_LIMIT} filas: ${truncatedTables.join(', ')}`)
    }

    log(`  archivo: ${file}`)
    log(`  ${stats.tables.length} tablas, ${Object.values(stats.insertsByTable).reduce((a, b) => a + b, 0)} filas, ${stats.functions} funciones, ${stats.policies} politicas, ${stats.triggers} triggers`)
    const verification = verifyRowCounts(stats.tables, stats.insertsByTable, warnings)

    result.dump = {
      file: `backup/dumps/db-${today.stamp}.sql`,
      bytes: buffer.length,
      sha256: hash,
      tables: stats.tables.length,
      rows: Object.values(stats.insertsByTable).reduce((a, b) => a + b, 0),
      functions: stats.functions,
      policies: stats.policies,
      triggers: stats.triggers,
      truncatedTables,
      verification,
    }

    log('[3/7] Exportando TODOS los esquemas multi-tenant (public, auth, condo_*)')
    const allSchemas = dumpAllSchemas({ verbose: true })
    if (allSchemas.mismatches.length) {
      warnings.push(`Conteos distintos en la salva multi-tenant: ${allSchemas.mismatches.map((m) => `${m.table}(${m.db}/${m.dump})`).join(', ')}`)
    }
    result.allSchemas = {
      file: `backup/dumps/all-schemas-${today.stamp}.sql`,
      bytes: allSchemas.bytes,
      sha256: allSchemas.sha256,
      schemas: allSchemas.schemas,
      tables: allSchemas.tables,
      rows: allSchemas.rows,
      bySchema: allSchemas.bySchema,
      mismatches: allSchemas.mismatches,
    }
  } else {
    log('[2/7] Export de datos omitido (--no-dump)')
  }

  if (!args.noSchema) {
    log('[4/7] Guardando esquema sin datos')
    const { sql } = exportSql({ withData: false })
    const file = join(SCHEMA_DIR, 'schema-latest.sql')
    const buffer = Buffer.from(sql)
    writeFileSync(file, buffer)
    const stats = countDumpStats(sql)
    writeFileSync(`${file}.sha256`, `${sha256(buffer)}  schema-latest.sql\n`)
    log(`  archivo: ${file} (${formatBytes(buffer.length)}, ${stats.tables.length} tablas)`)
    result.schema = { file: 'backup/schema/schema-latest.sql', bytes: buffer.length, sha256: sha256(buffer), tables: stats.tables.length }
  } else {
    log('[4/7] Esquema omitido (--no-schema)')
  }

  if (!args.noFunctions) {
    log('[5/7] Copiando edge functions desplegadas')
    const captured = captureFunctions()
    log(`  ${captured.entries.length} funciones en backup/functions/`)
    if (captured.missingRepo.length) warnings.push(`Funciones desplegadas sin copia en el repo: ${captured.missingRepo.join(', ')}`)
    if (captured.mismatches.length) warnings.push(`Codigo desplegado distinto al repo: ${captured.mismatches.join(', ')}`)
    result.functions = {
      count: captured.entries.length,
      mismatches: captured.mismatches,
      missingRepo: captured.missingRepo,
      orphanRepo: captured.orphanRepo,
    }
  } else {
    log('[5/7] Edge functions omitidas (--no-functions)')
  }

  log('[6/7] Inventario de estructura (tablas, indices, RLS, funciones, triggers)')
  const inventory = writeStructureInventory()
  log(`  archivo: ${inventory.file}`)
  log(`  ${JSON.stringify(inventory.counts)}`)
  result.structure = { file: inventory.file, counts: inventory.counts }

  log('[7/7] Actualizando historial y rotacion')
  const manifest = readJson(MANIFEST_FILE, [])
  manifest.unshift(result)
  writeJson(MANIFEST_FILE, manifest.slice(0, 120))
  const removedDumps = pruneDumps(keep)
  const removedCloud = pruneCloud(keep)
  if (removedDumps.length) log(`  salvas locales eliminadas: ${removedDumps.join(', ')}`)
  if (removedCloud.length) log(`  snapshots cloud locales eliminados: ${removedCloud.join(', ')}`)

  writeJson(join(REPORTS_DIR, `backup-${today.day}.json`), result)

  if (warnings.length) {
    log('')
    for (const warning of warnings) warn(`AVISO: ${warning}`)
    process.exitCode = 1
  } else {
    log('')
    log('Salva completa finalizada sin avisos.')
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})

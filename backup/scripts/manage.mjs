import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  BACKUP_DIR,
  CLOUD_DIR,
  DEFAULT_KEEP,
  DUMPS_DIR,
  MANIFEST_FILE,
  cliJson,
  countDumpStats,
  dateParts,
  ensureBackupDirs,
  formatBytes,
  getProject,
  listFiles,
  log,
  parseArgs,
  printHelp,
  projectLabel,
  pruneCloud,
  pruneDumps,
  readJson,
  runCli,
  sha256,
  warn,
} from './lib.mjs'

const HELP = `Uso: node backup/scripts/manage.mjs <comando> [opciones]

Comandos:
  list                      Salvas locales, snapshots cloud descargados y backups en InsForge
  verify [archivo]          Verifica integridad (sha256 + contenido) de una salva o de la última
  restore <archivo> --yes   Restaura una salva en la base del proyecto enlazado (DESTRUCTIVO)
  prune [--keep <n>]        Borra las salvas locales más antiguas
  cloud list                Lista los backups cloud de InsForge
  cloud download            Descarga el último snapshot cloud a backup/cloud/
  cloud create [--name x]   Crea un backup cloud (la cuota manual de Free es 1)
  cloud restore <id> --yes  Restaura un backup cloud (DESTRUCTIVO)
  cloud delete <id> --yes   Borra un backup cloud

Opciones:
  --truncate   En restore: vacía las tablas antes de importar
  --keep <n>   Salvas locales a conservar (default ${DEFAULT_KEEP})
  --yes        Confirma operaciones destructivas
  --help       Muestra esta ayuda`

function latestDump() {
  const dumps = listFiles(DUMPS_DIR, /^db-.*\.sql$/).sort((a, b) => b.file.localeCompare(a.file))
  return dumps[0]?.full ?? null
}

function listCommand() {
  ensureBackupDirs()
  const project = getProject()
  log(`Proyecto: ${projectLabel(project)}`)
  log('')

  const manifest = readJson(MANIFEST_FILE, [])
  const dumps = listFiles(DUMPS_DIR, /^db-.*\.sql$/)
  log(`Salvas locales (${dumps.length}) — ${relative(process.cwd(), DUMPS_DIR)}`)
  if (!dumps.length) log('  (vacío)')
  for (const dump of dumps) {
    const entry = manifest.find((item) => item.dump?.file?.endsWith(dump.file))
    const resumen = entry?.dump
      ? `${entry.dump.tables} tablas / ${entry.dump.rows} filas`
      : 'sin metadatos'
    log(`  ${dump.file}  ${formatBytes(dump.bytes).padStart(8)}  ${resumen}`)
  }
  log('')

  const snapshots = listFiles(CLOUD_DIR, /\.sql\.gz$/)
  log(`Snapshots cloud descargados (${snapshots.length}) — ${relative(process.cwd(), CLOUD_DIR)}`)
  if (!snapshots.length) log('  (vacío)')
  for (const snapshot of snapshots) log(`  ${snapshot.file}  ${formatBytes(snapshot.bytes).padStart(8)}`)
  log('')

  const listResult = runCli(['backups', 'list', '--json'], { allowFailure: true })
  log('Backups en InsForge')
  if (!listResult.ok) {
    log('  (no disponible; revisa la sesión del CLI)')
  } else {
    try {
      const start = listResult.stdout.search(/[{[]/)
      const backups = JSON.parse(listResult.stdout.slice(start))
      if (!backups.length) log('  (ninguno)')
      for (const backup of backups) {
        log(`  ${backup.id}  ${backup.status.padEnd(10)}  ${backup.name ?? '-'}  ${backup.triggered_at}`)
      }
    } catch {
      log('  (respuesta ilegible)')
    }
  }
}

function verifyCommand(args) {
  ensureBackupDirs()
  const target = args._[1] ? join(process.cwd(), args._[1]) : latestDump()
  if (!target) throw new Error('No hay salvas locales para verificar')
  if (!existsSync(target)) throw new Error(`No existe el archivo ${target}`)

  const file = target.split(/[\\/]/).pop()
  const buffer = readFileSync(target)
  const hash = sha256(buffer)
  const sidecarFile = `${target}.sha256`
  const sidecar = existsSync(sidecarFile) ? readFileSync(sidecarFile, 'utf8').trim().split(/\s+/)[0] : null
  const manifest = readJson(MANIFEST_FILE, [])
  const entry = manifest.find((item) => item.dump?.file?.endsWith(file))

  let sql = null
  if (target.endsWith('.gz')) {
    const plain = gunzipSync(buffer)
    sql = plain.toString('utf8')
  } else if (target.endsWith('.sql')) {
    sql = buffer.toString('utf8')
  } else {
    throw new Error('Solo se verifican archivos .sql o .sql.gz')
  }

  const stats = countDumpStats(sql)
  const rows = Object.values(stats.insertsByTable).reduce((a, b) => a + b, 0)

  log(`Archivo:    ${target}`)
  log(`Tamaño:     ${formatBytes(buffer.length)}`)
  log(`SHA256:     ${hash}`)
  if (sidecar) log(`Sidecar:    ${sidecar === hash ? 'coincide' : 'NO COINCIDE'}`)
  if (entry?.dump?.sha256) log(`Manifest:   ${entry.dump.sha256 === hash ? 'coincide' : 'NO COINCIDE'}`)
  log(`Tablas:     ${stats.tables.length}`)
  log(`Filas:      ${rows}`)
  log(`Funciones:  ${stats.functions}`)
  log(`Políticas:  ${stats.policies}`)
  log(`Triggers:   ${stats.triggers}`)

  const problems = []
  if (sidecar && sidecar !== hash) problems.push('el sha256 no coincide con el sidecar')
  if (entry?.dump?.sha256 && entry.dump.sha256 !== hash) problems.push('el sha256 no coincide con el manifest')
  if (!stats.tables.length) problems.push('el archivo no contiene tablas')
  if (stats.functions === 0) problems.push('el archivo no contiene funciones de base de datos')

  if (problems.length) {
    warn('')
    for (const problem of problems) warn(`FALLO: ${problem}`)
    process.exitCode = 1
    return
  }
  log('')
  log('Verificación correcta.')
}

function restoreCommand(args) {
  const target = args._[1]
  if (!target) throw new Error('Indica el archivo a restaurar: manage.mjs restore backup/dumps/db-....sql')
  if (!args.yes) throw new Error('Restaurar sobrescribe datos. Repite el comando con --yes si estás seguro.')
  const full = join(process.cwd(), target)
  if (!existsSync(full)) throw new Error(`No existe el archivo ${full}`)

  const project = getProject()
  log(`Proyecto destino: ${projectLabel(project)}`)
  log(`Archivo:          ${full}`)

  let importFile = full
  let tempFile = null
  if (full.endsWith('.gz')) {
    tempFile = join(BACKUP_DIR, `restore-${dateParts().stamp}.sql`)
    writeFileSync(tempFile, gunzipSync(readFileSync(full)))
    importFile = tempFile
    log(`Descomprimido en: ${tempFile}`)
  }

  const cliArgs = ['db', 'import', importFile]
  if (args.truncate) cliArgs.push('--truncate')
  const result = runCli(cliArgs, { allowFailure: true })
  if (tempFile && existsSync(tempFile)) unlinkSync(tempFile)

  if (!result.ok) {
    const detail = (result.stderr || result.stdout).trim()
    throw new Error(`La restauración falló: ${detail}`)
  }
  log(result.stdout.trim())
  log('Restauración completada. Verifica conteos con: npx -y @insforge/cli db query "select count(*) from profiles"')
}

function pruneCommand(args) {
  ensureBackupDirs()
  const keep = Number(args.keep ?? DEFAULT_KEEP)
  if (!Number.isFinite(keep) || keep < 1) throw new Error('--keep debe ser un número mayor o igual a 1')
  const dumps = pruneDumps(keep)
  const cloud = pruneCloud(keep)
  log(`Salvas eliminadas: ${dumps.length ? dumps.join(', ') : 'ninguna'}`)
  log(`Snapshots cloud locales eliminados: ${cloud.length ? cloud.join(', ') : 'ninguno'}`)
  log(`Se conservan las ${keep} más recientes.`)
}

async function cloudCommand(args) {
  const action = args._[1] ?? 'list'
  ensureBackupDirs()

  if (action === 'list') {
    listCommand()
    return
  }

  if (action === 'download') {
    const latestResult = runCli(['backups', 'latest', '--json'], { allowFailure: true })
    if (!latestResult.ok) throw new Error('No hay snapshot cloud disponible')
    const start = latestResult.stdout.search(/[{[]/)
    const latest = JSON.parse(latestResult.stdout.slice(start))
    if (!latest.download_url) throw new Error('El snapshot cloud no expone download_url')
    const dest = join(CLOUD_DIR, latest.file)
    const response = await fetch(latest.download_url)
    if (!response.ok) throw new Error(`La descarga falló con HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    gunzipSync(buffer)
    writeFileSync(dest, buffer)
    writeFileSync(`${dest}.sha256`, `${sha256(buffer)}  ${latest.file}\n`)
    log(`Descargado: ${dest} (${formatBytes(buffer.length)})`)
    return
  }

  if (action === 'create') {
    const name = args.name ?? `manual-${dateParts().stamp}`
    const result = runCli(['backups', 'create', '--name', name, '--wait', '--json'], { allowFailure: true })
    if (!result.ok) throw new Error((result.stderr || result.stdout).trim())
    log(result.stdout.trim())
    return
  }

  if (action === 'restore' || action === 'delete') {
    const id = args._[2]
    if (!id) throw new Error(`Indica el id del backup: cloud ${action} <id> --yes`)
    if (!args.yes) throw new Error(`Operación destructiva. Repite con --yes si estás seguro.`)
    const result = runCli(['backups', action, id, '-y', '--json'], { allowFailure: true })
    if (!result.ok) throw new Error((result.stderr || result.stdout).trim())
    log(result.stdout.trim() || `${action} completado`)
    return
  }

  throw new Error(`Acción cloud desconocida: ${action}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]

  if (!command || args.help) {
    printHelp([HELP])
    return
  }

  switch (command) {
    case 'list':
      listCommand()
      break
    case 'verify':
      verifyCommand(args)
      break
    case 'restore':
      restoreCommand(args)
      break
    case 'prune':
      pruneCommand(args)
      break
    case 'cloud':
      await cloudCommand(args)
      break
    default:
      printHelp([HELP])
      process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})

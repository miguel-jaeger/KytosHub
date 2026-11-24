import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FUNCTIONS_DIR,
  FUNCTIONS_MANIFEST_FILE,
  REPORTS_DIR,
  REPO_FUNCTIONS_DIR,
  cliJson,
  dateParts,
  ensureBackupDirs,
  extractFunctionSource,
  getProject,
  log,
  normalizeSource,
  parseArgs,
  projectLabel,
  runCli,
  sha256,
  warn,
  writeJson,
} from './lib.mjs'

export function captureFunctions({ write = true } = {}) {
  const project = getProject()
  const deployed = cliJson(['functions', 'list', '--json'])
  const functions = deployed?.functions ?? []
  const entries = []
  const mismatches = []
  const missingRepo = []

  for (const fn of functions) {
    const { stdout } = runCli(['functions', 'code', fn.slug])
    const source = extractFunctionSource(stdout)
    const repoFile = `functions/${fn.slug}.ts`
    const repoPath = join(REPO_FUNCTIONS_DIR, `${fn.slug}.ts`)
    const hasRepoCopy = existsSync(repoPath)
    const repoSource = hasRepoCopy ? normalizeSource(readFileSync(repoPath, 'utf8')) : null
    const matchesRepo = hasRepoCopy && repoSource === source

    if (write) {
      writeFileSync(join(FUNCTIONS_DIR, `${fn.slug}.ts`), source)
    }

    const entry = {
      slug: fn.slug,
      id: fn.id,
      status: fn.status,
      deployedAt: fn.deployedAt,
      updatedAt: fn.updatedAt,
      bytes: Buffer.byteLength(source),
      sha256: sha256(source),
      repoFile: hasRepoCopy ? repoFile : null,
      matchesRepo,
    }
    entries.push(entry)
    if (!hasRepoCopy) missingRepo.push(fn.slug)
    else if (!matchesRepo) mismatches.push(fn.slug)
  }

  const deployedSlugs = new Set(functions.map((fn) => fn.slug))
  const orphanRepo = existsSync(REPO_FUNCTIONS_DIR)
    ? readdirSync(REPO_FUNCTIONS_DIR)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.replace(/\.ts$/, ''))
      .filter((slug) => !deployedSlugs.has(slug))
    : []

  if (write) {
    ensureBackupDirs()
    writeJson(FUNCTIONS_MANIFEST_FILE, {
      generatedAt: new Date().toISOString(),
      project,
      deploymentUrl: deployed?.deploymentUrl ?? null,
      runtime: deployed?.runtime ?? null,
      functions: entries,
    })
  }

  return { project, deploymentUrl: deployed?.deploymentUrl ?? null, entries, mismatches, missingRepo, orphanRepo }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureBackupDirs()

  if (args.help) {
    log(`Uso: node backup/scripts/audit.mjs [--json]\n\nCopia las funciones desplegadas en InsForge a backup/functions/ y compara cada una con functions/<slug>.ts del repositorio.`)
    return
  }

  const result = captureFunctions()
  const generatedAt = new Date().toISOString()
  const report = {
    generatedAt,
    project: result.project,
    deploymentUrl: result.deploymentUrl,
    functions: result.entries,
    missingRepo: result.missingRepo,
    mismatches: result.mismatches,
    orphanRepo: result.orphanRepo,
  }
  const reportFile = join(REPORTS_DIR, `functions-audit-${dateParts().day}.json`)
  writeJson(reportFile, report)

  if (args.json) {
    log(JSON.stringify(report, null, 2))
  } else {
    log(`Proyecto: ${projectLabel(result.project)}`)
    log(`Funciones desplegadas: ${result.entries.length}`)
    log('')
    log('Funcion                     Estado      Bytes  Repo')
    log('--------------------------  ----------  -----  ----')
    for (const entry of result.entries) {
      const estado = entry.matchesRepo ? 'igual' : entry.repoFile ? 'DIFERENTE' : 'SIN COPIAR'
      log(`${entry.slug.padEnd(26)}  ${estado.padEnd(10)}  ${String(entry.bytes).padStart(5)}  ${entry.repoFile ?? '-'}`)
    }
    log('')
    log(`Copia de seguridad: backup/functions/ (${result.entries.length} archivos + manifest.json)`)
    log(`Reporte: ${reportFile}`)
    if (result.missingRepo.length) warn(`AVISO: funciones desplegadas sin archivo en el repo: ${result.missingRepo.join(', ')}`)
    if (result.mismatches.length) warn(`AVISO: el codigo desplegado difiere del repo: ${result.mismatches.join(', ')}`)
    if (result.orphanRepo.length) warn(`AVISO: archivos en functions/ sin funcion desplegada: ${result.orphanRepo.join(', ')}`)
    if (!result.missingRepo.length && !result.mismatches.length) log('OK: todas las funciones desplegadas tienen copia identica en el repositorio.')
  }

  if (result.missingRepo.length || result.mismatches.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  })
}

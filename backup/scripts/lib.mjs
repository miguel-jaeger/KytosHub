import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BACKUP_DIR = join(ROOT, 'backup')
export const DUMPS_DIR = join(BACKUP_DIR, 'dumps')
export const CLOUD_DIR = join(BACKUP_DIR, 'cloud')
export const SCHEMA_DIR = join(BACKUP_DIR, 'schema')
export const FUNCTIONS_DIR = join(BACKUP_DIR, 'functions')
export const REPORTS_DIR = join(BACKUP_DIR, 'reports')
export const REPO_FUNCTIONS_DIR = join(ROOT, 'functions')
export const MANIFEST_FILE = join(DUMPS_DIR, 'manifest.json')
export const FUNCTIONS_MANIFEST_FILE = join(FUNCTIONS_DIR, 'manifest.json')
export const DEFAULT_KEEP = 14
export const EXPORT_ROW_LIMIT = 10000

export const log = (...args) => console.log(...args)
export const warn = (...args) => console.warn(...args)

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function ensureBackupDirs() {
  for (const dir of [DUMPS_DIR, CLOUD_DIR, SCHEMA_DIR, FUNCTIONS_DIR, REPORTS_DIR]) ensureDir(dir)
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value >= 10 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`
}

export function dateParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`
  return { day, time, stamp: `${day}_${time}` }
}

export function normalizeSource(text) {
  return `${String(text).replace(/\r\n/g, '\n').trimEnd()}\n`
}

export function quoteArg(arg) {
  const value = String(arg)
  if (process.platform !== 'win32') return `'${value.replace(/'/g, `'\\''`)}'`
  return `"${value.replace(/"/g, '\\"')}"`
}

export function runCli(args, { allowFailure = false, timeout = 20 * 60 * 1000 } = {}) {
  const line = ['npx', '-y', '@insforge/cli', ...args].map(quoteArg).join(' ')
  const result = spawnSync(line, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    timeout,
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error) throw new Error(`No se pudo ejecutar el CLI de InsForge: ${result.error.message}`)
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const ok = result.status === 0
  if (!ok && !allowFailure) {
    const detail = (stderr || stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(' | ')
    throw new Error(`insforge ${args.join(' ')} falló (código ${result.status}): ${detail}`)
  }
  return { ok, status: result.status, stdout, stderr }
}

export function cliJson(args, options) {
  const { stdout } = runCli(args, options)
  const start = stdout.search(/[[{]/)
  if (start < 0) throw new Error(`insforge ${args.join(' ')} no devolvió JSON: ${stdout.trim().slice(0, 200)}`)
  const end = Math.max(stdout.lastIndexOf('}'), stdout.lastIndexOf(']'))
  if (end < start) throw new Error(`insforge ${args.join(' ')} devolvió JSON incompleto`)
  return JSON.parse(stdout.slice(start, end + 1))
}

export function getProject() {
  const fromEnv = process.env.INSFORGE_PROJECT_ID || process.env.INSFORGE_PROJECT || null
  const envBase = process.env.INSFORGE_BASE_URL || process.env.INSFORGE_API_BASE_URL || null
  try {
    const current = cliJson(['current', '--json'], { allowFailure: true })
    const project = current?.project ?? {}
    return {
      projectId: project.project_id ?? fromEnv,
      name: project.project_name ?? null,
      region: project.region ?? null,
      url: project.oss_host ?? envBase,
      appkey: project.appkey ?? null,
    }
  } catch {
    return { projectId: fromEnv, name: null, region: null, url: envBase, appkey: null }
  }
}

export function projectLabel(project) {
  if (!project) return 'proyecto no identificado'
  if (project.name) return `${project.name} (${project.projectId ?? 'sin id'})`
  return project.projectId ?? 'proyecto no identificado'
}

export async function downloadFile(url, dest) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`La descarga falló con HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('La descarga devolvió un archivo vacío')
  writeFileSync(dest, buffer)
  return buffer
}

export function listFiles(dir, pattern) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => pattern.test(file))
    .map((file) => {
      const full = join(dir, file)
      const stats = statSync(full)
      return { file, full, bytes: stats.size, mtime: stats.mtimeMs }
    })
    .sort((a, b) => b.file.localeCompare(a.file))
}

export function pruneDumps(keep) {
  const removed = []
  const dumps = listFiles(DUMPS_DIR, /^db-.*\.sql$/).sort((a, b) => b.file.localeCompare(a.file))
  for (const dump of dumps.slice(keep)) {
    unlinkSync(dump.full)
    const sidecar = `${dump.full}.sha256`
    if (existsSync(sidecar)) unlinkSync(sidecar)
    removed.push(dump.file)
  }
  return removed
}

export function pruneCloud(keep) {
  const removed = []
  const snapshots = listFiles(CLOUD_DIR, /\.sql\.gz$/).sort((a, b) => b.file.localeCompare(a.file))
  for (const snapshot of snapshots.slice(keep)) {
    unlinkSync(snapshot.full)
    const sidecar = `${snapshot.full}.sha256`
    if (existsSync(sidecar)) unlinkSync(sidecar)
    removed.push(snapshot.file)
  }
  return removed
}

export function extractFunctionSource(output) {
  const lines = String(output).replace(/\r\n/g, '\n').split('\n')
  const headerEnd = lines.findIndex((line) => line.trim() === '---')
  const body = headerEnd >= 0 ? lines.slice(headerEnd + 1) : lines
  return normalizeSource(body.join('\n').replace(/^\n+/, ''))
}

export function countDumpStats(sql) {
  const tables = [...sql.matchAll(/^-- Table: (\S+)$/gm)].map((match) => match[1])
  const insertsByTable = {}
  for (const match of sql.matchAll(/^INSERT INTO (\S+) /gm)) {
    insertsByTable[match[1]] = (insertsByTable[match[1]] ?? 0) + 1
  }
  const functions = (sql.match(/^CREATE (?:OR REPLACE )?FUNCTION /gm) ?? []).length
  const policies = (sql.match(/^CREATE POLICY /gm) ?? []).length
  const triggers = (sql.match(/^CREATE TRIGGER /gm) ?? []).length
  return { tables, insertsByTable, functions, policies, triggers }
}

export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const [rawKey, inlineValue] = token.slice(2).split('=')
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (inlineValue !== undefined) {
      args[key] = inlineValue
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1]
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

export function printHelp(lines) {
  log(lines.join('\n'))
}

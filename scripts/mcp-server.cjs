#!/usr/bin/env node
/**
 * MCP server (stdio) for IELTS Reading Lab.
 *
 * Read-only access to the desktop app's real SQLite data, plus a fixed
 * whitelist of project commands. Stdout is reserved for JSON-RPC: all
 * diagnostics go to stderr.
 *
 * Safety rules:
 *  - The database is opened from a Buffer and NEVER written back. The app's
 *    electron/db.ts rewrites the whole file on every write, so a concurrent
 *    writer would corrupt both sides.
 *  - No arbitrary shell, no deleteAllData, no database writes.
 *  - Commands come from a fixed map; user arguments never become shell input.
 *  - File exports are confined to <root>/.tmp via path.basename().
 */
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js')

const ROOT = path.resolve(process.env.LAB_ROOT || path.join(__dirname, '..'))
const DEFAULT_USER_DATA = path.join(
  process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming'),
  'ielts-reading-lab',
)
const DB_PATH = path.resolve(
  process.env.LAB_DB_PATH || path.join(process.env.LAB_USER_DATA || DEFAULT_USER_DATA, 'reading-lab.sqlite'),
)
const MAX_OUTPUT = 12000
const log = (...parts) => process.stderr.write('[lab-mcp] ' + parts.join(' ') + '\n')

/* ----------------------------- data access ----------------------------- */

let sqlPromise = null
async function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('数据库不存在：' + DB_PATH + '。请先启动一次桌面应用，或用 LAB_DB_PATH 指定路径。')
  }
  if (!sqlPromise) sqlPromise = require('sql.js')()
  const SQL = await sqlPromise
  // The app rewrites this file in place; retry a read that raced a write.
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try {
      return new SQL.Database(fs.readFileSync(DB_PATH))
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 60))
    }
  }
  throw lastErr || new Error('无法读取数据库')
}

function query(db, sql, params = []) {
  const res = db.exec(sql, params)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
}

function readKind(db, kind) {
  return query(db, 'SELECT id, payload FROM records WHERE kind = ? ORDER BY seq', [kind])
    .map((r) => {
      try { return JSON.parse(r.payload) } catch (_) { return null }
    })
    .filter(Boolean)
}

function withDb(fn) {
  return async (args) => {
    const db = await openDb()
    try { return await fn(db, args || {}) } finally { db.close() }
  }
}

function limitOf(args, fallback = 20) {
  const n = Number(args.limit ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(100, Math.trunc(n)))
}

function short(value, max = 400) {
  const s = String(value ?? '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

function truncate(s) {
  if (s.length <= MAX_OUTPUT) return s
  return s.slice(0, 4000) + '\n… (输出已截断) …\n' + s.slice(-7000)
}

/* ------------------------------ npm runner ----------------------------- */

const COMMANDS = {
  run_typecheck: { scripts: ['typecheck'], timeout: 180000 },
  run_tests: { scripts: ['test'], timeout: 300000 },
  run_smoke: { scripts: ['smoke'], timeout: 300000 },
  run_test_all: { scripts: ['test:all'], timeout: 600000 },
  verify_interactions: { scripts: ['verify:middleclick', 'verify:wrongwords'], timeout: 300000 },
  build_app: { scripts: ['build'], timeout: 240000 },
  package_app: { scripts: ['package'], timeout: 300000 },
}

function npmInvocation() {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (fs.existsSync(cli)) return { file: process.execPath, prefix: [cli, 'run'], shell: false }
  return { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: ['run'], shell: process.platform === 'win32' }
}

function runScript(script, timeoutMs) {
  const inv = npmInvocation()
  return new Promise((resolve) => {
    const child = spawn(inv.file, [...inv.prefix, script], {
      cwd: ROOT,
      shell: inv.shell,
      windowsHide: true,
      env: { ...process.env, LAB_ROOT: ROOT },
    })
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ script, exitCode: -1, timedOut: true, output: truncate(output + '\n[超时]') })
    }, timeoutMs)
    child.stdout.on('data', (d) => { output += d.toString() })
    child.stderr.on('data', (d) => { output += d.toString() })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ script, exitCode: -1, output: e.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ script, exitCode: code, output: truncate(output) })
    })
  })
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return (r.stdout || r.stderr || '').trim()
}

/* --------------------------- spec consistency -------------------------- */

function countLines(file, re) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) return -1
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => re.test(l)).length
}

function countTestFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) n += countTestFiles(p)
    else if (/\.test\.tsx?$/.test(entry.name)) n++
  }
  return n
}

function checkSpecConsistency() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec.json'), 'utf8'))
  const apiSrc = fs.readFileSync(path.join(ROOT, 'electron/apiMethods.ts'), 'utf8')
  const whitelist = [...apiSrc.matchAll(/^\s+'([A-Za-z]+)'/gm)].map((m) => m[1])
  const machine = fs.readFileSync(path.join(ROOT, 'src/core/machine.ts'), 'utf8')
  const types = fs.readFileSync(path.join(ROOT, 'src/core/types.ts'), 'utf8')
  const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
  const checks = []
  const add = (name, expected, actual) => checks.push({ name, expected, actual, pass: String(expected) === String(actual) })

  add('API 方法数 = 白名单数', spec.api.methodCount, whitelist.length)
  add('API 方法名集合一致',
    [...spec.api.methods].sort().join(','), [...whitelist].sort().join(','))
  add('离线词条数', spec.content.dictionary.rows, countLines('src/data/dictionary.ts', /^  \["/))
  add('离线解析条数', spec.content.offlineExplanations.rows, countLines('src/data/explanations.ts', /^  \["/))
  add('对抗样本数', spec.teachingPolicy.benchmark.adversarialCases,
    countLines('src/core/samples.ts', /^  \{ id: 'A\d+'/))
  for (const [k, v] of Object.entries(spec.teachingPolicy.limits)) {
    add('策略上限 ' + k, v, (machine.match(new RegExp(k + ': (\\d+)')) || [])[1])
  }
  add('策略版本', spec.teachingPolicy.policyVersion, (types.match(/POLICY_VERSION = '([^']+)'/) || [])[1])
  add('视图与 App 一致', spec.product.views.length,
    spec.product.views.filter((v) => app.includes("'" + v.key + "'")).length)
  add('测试文件数', spec.verification.vitest.files, countTestFiles(path.join(ROOT, 'tests')))

  // git HEAD is a snapshot, not an invariant: every new commit changes it.
  // Report the drift as information instead of failing the check.
  const gitHead = git('rev-parse', '--short', 'HEAD')

  const drifts = []
  const contract = fs.readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8')
  const arch = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8')
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  if (/9 条对抗样本/.test(contract)) drifts.push('docs/CONTRACT.md 仍写 9 条对抗样本（实际 10 条）')
  if (arch.includes('onSentenceAuxClick')) drifts.push('docs/ARCHITECTURE.md 仍写 onSentenceAuxClick（代码已改 onSentenceMouseDown）')
  if (/89 项单测/.test(readme)) drifts.push('README.md 仍写 89 项单测（当前为 ' + spec.verification.vitest.total + ' 项）')

  return {
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    ok: checks.every((c) => c.pass),
    checks,
    knownDocDrift: drifts,
    gitHead,
    specSnapshotHead: spec.project.git.head,
    note: 'git HEAD 是生成 spec 时的快照，每次提交都会变化，不作为失败项。测试总数只做 spec.json 与 docs/TESTING.md 的交叉比对，未重跑 vitest；用 run_tests 验证真实数量。',
    testingDocTotal: (fs.readFileSync(path.join(ROOT, 'docs/TESTING.md'), 'utf8').match(/Vitest 总计：\*\*(\d+) 项/) || [])[1],
    specTotal: spec.verification.vitest.total,
  }
}

/* -------------------------------- tools -------------------------------- */

const TOOLS = [
  {
    name: 'get_storage_info',
    description: '返回桌面应用真实数据库的位置、大小、修改时间与各 record kind 的数量。用于确认读的是当前正在使用的那份数据。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: withDb((db) => {
      const stat = fs.statSync(DB_PATH)
      const kinds = query(db, 'SELECT kind, COUNT(*) AS n FROM records GROUP BY kind ORDER BY kind')
      return { dbPath: DB_PATH, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), kinds }
    }),
  },
  {
    name: 'list_articles',
    description: '列出内置/导入文章的 id、标题、创建时间、原文字数与句子数量。limit 最大 100。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    handler: withDb((db, args) => readKind(db, 'article').slice(0, limitOf(args)).map((a) => ({
      id: a.id, title: a.title, createdAt: a.createdAt, sourceType: a.sourceType,
      chars: (a.originalText || '').length,
      paragraphCount: (a.originalText || '').split(/\n\s*\n/).filter(Boolean).length,
    }))),
  },
  {
    name: 'get_article',
    description: '按 articleId 返回一篇文章的标题与原文全文（长文会截断）。',
    inputSchema: { type: 'object', properties: { articleId: { type: 'string', maxLength: 200 } }, required: ['articleId'], additionalProperties: false },
    handler: withDb((db, args) => {
      const a = readKind(db, 'article').find((x) => x.id === args.articleId)
      if (!a) throw new Error('未找到文章：' + args.articleId)
      return { id: a.id, title: a.title, createdAt: a.createdAt, originalText: short(a.originalText, 20000) }
    }),
  },
  {
    name: 'list_wrong_words',
    description: '列出错词本全部词条：单词、取词原文、释义快照、标签、来源句、收录时间。可按关键字筛选。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 100 } }, additionalProperties: false },
    handler: withDb((db, args) => {
      const q = String(args.query || '').trim().toLowerCase()
      const all = readKind(db, 'wrongWord').reverse()
      const rows = q ? all.filter((w) => (w.word || '').toLowerCase().includes(q) || (w.query || '').toLowerCase().includes(q)) : all
      return { total: all.length, returned: rows.length, words: rows.map((w) => ({
        id: w.id, word: w.word, query: w.query, phonetic: w.phonetic, found: w.found,
        translation: short(w.translation, 300), tags: w.tags, base: w.base,
        sentenceText: short(w.sentenceText, 300), createdAt: w.createdAt,
      })) }
    }),
  },
  {
    name: 'get_profile',
    description: '汇总学习档案原始记录：训练会话、作答、观察、决策、反馈、复测、标记、曝光的条数，以及最近会话摘要。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: withDb((db) => {
      const kinds = Object.fromEntries(query(db, 'SELECT kind, COUNT(*) AS n FROM records GROUP BY kind').map((r) => [r.kind, r.n]))
      const observations = readKind(db, 'observation')
      const byResult = {}
      for (const o of observations) byResult[o.result] = (byResult[o.result] || 0) + 1
      const sessions = readKind(db, 'session').slice(-5).reverse().map((s) => ({
        id: s.id, state: s.state, currentLevel: s.currentLevel, answerRevealed: s.answerRevealed,
        startedAt: s.startedAt, sentenceText: short(s.sentenceText, 160),
      }))
      return {
        counts: {
          articles: kinds.article || 0, sessions: kinds.session || 0, attempts: kinds.attempt || 0,
          diagnoses: kinds.diagnosis || 0, decisions: kinds.decision || 0, feedback: kinds.feedback || 0,
          observations: kinds.observation || 0, reviewTasks: kinds.review || 0, marks: kinds.mark || 0,
          exposures: kinds.exposure || 0, wrongWords: kinds.wrongWord || 0,
        },
        observationsByResult: byResult,
        recentSessions: sessions,
        note: '这是 records 表的原始计数，不是 runtime.getProfile() 计算后的统计（后者会做最新曝光去重）。',
      }
    }),
  },
  {
    name: 'list_sessions',
    description: '列出最近的训练会话（id、状态、等级、是否曝光、原句摘要、开始时间）。limit 最大 100。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    handler: withDb((db, args) => readKind(db, 'session').slice(-limitOf(args)).reverse().map((s) => ({
      id: s.id, state: s.state, currentLevel: s.currentLevel, answerRevealed: s.answerRevealed,
      disputed: !!s.disputed, startedAt: s.startedAt, endedAt: s.endedAt,
      sentenceText: short(s.sentenceText, 160),
    }))),
  },
  {
    name: 'get_session',
    description: '按 sessionId 返回完整训练轨迹：会话状态、每次作答、诊断证据、教学决策、反馈、迁移结果。',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string', maxLength: 200 } }, required: ['sessionId'], additionalProperties: false },
    handler: withDb((db, args) => {
      const s = readKind(db, 'session').find((x) => x.id === args.sessionId)
      if (!s) throw new Error('未找到会话：' + args.sessionId)
      const bySession = (kind) => readKind(db, kind).filter((x) => x.sessionId === args.sessionId)
      return {
        session: s,
        attempts: bySession('attempt'),
        diagnosis: bySession('diagnosis'),
        decisions: bySession('decision'),
        feedback: bySession('feedback'),
      }
    }),
  },
  {
    name: 'export_snapshot',
    description: '导出全量 records 的 JSON 快照。默认只返回统计摘要；提供 saveTo（仅文件名）时写入项目 .tmp/ 目录并返回路径。绝不包含加密凭据。',
    inputSchema: { type: 'object', properties: { saveTo: { type: 'string', maxLength: 100 } }, additionalProperties: false },
    handler: withDb((db, args) => {
      const rows = query(db, 'SELECT kind, id, payload FROM records ORDER BY seq').map((r) => {
        let payload = null
        try { payload = JSON.parse(r.payload) } catch (_) { payload = r.payload }
        return { kind: r.kind, id: r.id, payload }
      })
      const snapshot = { format: 'ielts-reading-lab-mcp-snapshot', exportedAt: new Date().toISOString(), source: DB_PATH, rows }
      const summary = { totalRows: rows.length, kinds: Object.fromEntries(query(db, 'SELECT kind, COUNT(*) AS n FROM records GROUP BY kind').map((r) => [r.kind, r.n])) }
      if (!args.saveTo) return { summary, hint: '传 saveTo 可写入 .tmp/ 下的文件。' }
      const dir = path.join(ROOT, '.tmp')
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, path.basename(String(args.saveTo)))
      if (!target.endsWith('.json')) throw new Error('saveTo 必须是 .json 文件名')
      fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), 'utf8')
      return { summary, savedTo: target, bytes: fs.statSync(target).size, note: '仅写入项目 .tmp/，不触碰应用数据库。' }
    }),
  },
  {
    name: 'get_spec',
    description: '返回项目根 spec.json 的完整内容（机器可读规格：架构、API、教学策略、内容规模、验证统计与已知缺口）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => JSON.parse(fs.readFileSync(path.join(ROOT, 'spec.json'), 'utf8')),
  },
  {
    name: 'check_spec_consistency',
    description: '核对 spec.json 与当前源码是否一致：API 白名单、词库/解析/对抗样本条数、策略上限、视图、git HEAD，并列出已知文档漂移。不跑测试。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => checkSpecConsistency(),
  },
  {
    name: 'get_git_status',
    description: '返回工作区状态、当前 HEAD、origin/main，判断是否有未提交改动或未推送提交。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({
      status: git('status', '--short'),
      branch: git('status', '-sb').split('\n')[0],
      head: git('rev-parse', '--short', 'HEAD'),
      originMain: git('rev-parse', '--short', 'origin/main'),
      synced: git('rev-parse', '--short', 'HEAD') === git('rev-parse', '--short', 'origin/main'),
    }),
  },
]

for (const [name, cfg] of Object.entries(COMMANDS)) {
  TOOLS.push({
    name,
    description: '执行项目白名单命令 npm run ' + cfg.scripts.join(' / npm run ') + '，返回退出码与截断后的输出。超时 ' + Math.round(cfg.timeout / 1000) + ' 秒。不执行任意命令。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const runs = []
      for (const script of cfg.scripts) {
        const r = await runScript(script, cfg.timeout)
        runs.push(r)
        if (r.exitCode !== 0) break
      }
      return { ok: runs.every((r) => r.exitCode === 0), runs }
    },
  })
}

/* ------------------------------- server -------------------------------- */

function asText(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] }
}

function createServer() {
  const server = new Server(
    { name: 'ielts-reading-lab', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ handler, ...def }) => def),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: '未知工具：' + req.params.name }] }
    try {
      return asText(await tool.handler(req.params.arguments || {}))
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: String((e && e.stack) || e) }] }
    }
  })
  return server
}

async function main() {
  log('starting, root=' + ROOT + ' db=' + DB_PATH)
  const server = createServer()
  await server.connect(new StdioServerTransport())
  log('ready, tools=' + TOOLS.length)
}

if (require.main === module) {
  main().catch((e) => { log('fatal: ' + String((e && e.stack) || e)); process.exit(1) })
}

module.exports = { TOOLS, COMMANDS, ROOT, DB_PATH, checkSpecConsistency, openDb, readKind, createServer }

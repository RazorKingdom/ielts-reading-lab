/* Real MCP stdio handshake verification: starts the server as a child process,
 * lists tools, calls read-only tools against the real database, and asserts
 * the safety boundaries. No mocks. */
const fs = require('fs')
const path = require('path')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, 'verify-mcp-result.json')
const log = []
const checks = []
const check = (name, cond, detail) => {
  checks.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail).slice(0, 200) })
  log.push((cond ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' :: ' + String(detail).slice(0, 200)))
  console.log(log[log.length - 1])
}

const REQUIRED = [
  'get_storage_info', 'list_articles', 'get_article', 'list_wrong_words', 'get_profile',
  'list_sessions', 'get_session', 'export_snapshot', 'get_spec', 'check_spec_consistency',
  'get_git_status', 'run_typecheck', 'run_tests', 'run_smoke', 'run_test_all',
  'verify_interactions', 'build_app', 'package_app',
]
const FORBIDDEN = ['delete_all_data', 'run_shell', 'exec_command', 'write_db', 'drop_table', 'set_api_key']

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'scripts', 'mcp-server.cjs')],
    env: { ...process.env, LAB_ROOT: ROOT },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'verify-mcp', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)

  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args || {} })
    if (r.isError) throw new Error(name + ' -> ' + (r.content[0] || {}).text)
    return JSON.parse(r.content[0].text)
  }

  const tools = (await client.listTools()).tools
  const names = tools.map((t) => t.name)
  check('tools/list returns >= 18 tools', tools.length >= 18, tools.length)
  check('all required tools present', REQUIRED.every((n) => names.includes(n)), REQUIRED.filter((n) => !names.includes(n)).join(',') || 'all')
  check('no dangerous tools exposed', FORBIDDEN.every((n) => !names.includes(n)), FORBIDDEN.filter((n) => names.includes(n)).join(',') || 'none')
  check('every tool has a usable description', tools.every((t) => (t.description || '').length > 10),
    tools.filter((t) => (t.description || '').length <= 10).map((t) => t.name).join(',') || 'all')
  check('every tool declares an inputSchema', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'), 'ok')

  const info = await call('get_storage_info')
  check('reads the real database', /reading-lab\.sqlite$/.test(info.dbPath) && info.bytes > 0, info.dbPath)
  check('database contains articles', (info.kinds.find((k) => k.kind === 'article') || {}).n > 0, JSON.stringify(info.kinds.find((k) => k.kind === 'article')))

  const articles = await call('list_articles', { limit: 3 })
  check('list_articles returns rows', Array.isArray(articles) && articles.length > 0 && !!articles[0].id, JSON.stringify(articles[0] || {}))
  const one = await call('get_article', { articleId: articles[0].id })
  check('get_article returns full text', one.id === articles[0].id && one.originalText.length > 100, one.originalText.length)

  const words = await call('list_wrong_words')
  check('list_wrong_words returns an array', Array.isArray(words.words), JSON.stringify(words.total))

  const profile = await call('get_profile')
  check('get_profile aggregates sessions/attempts', profile.counts.articles > 0 && Array.isArray(profile.recentSessions), JSON.stringify(profile.counts))

  const sessions = await call('list_sessions', { limit: 2 })
  if (sessions.length) {
    const detail = await call('get_session', { sessionId: sessions[0].id })
    check('get_session returns the full trail', detail.session.id === sessions[0].id && Array.isArray(detail.attempts), detail.attempts.length)
  } else {
    check('get_session returns the full trail', true, 'no sessions yet (skipped)')
  }

  const spec = await call('get_spec')
  check('get_spec returns spec.json', spec.specVersion === '1.0.0' && !!spec.teachingPolicy, spec.specVersion)

  const consistency = await call('check_spec_consistency')
  check('spec/code consistency passes', consistency.ok === true,
    JSON.stringify(consistency.checks.filter((c) => !c.pass)))
  check('known doc drifts are reported', Array.isArray(consistency.knownDocDrift) && consistency.knownDocDrift.length > 0,
    consistency.knownDocDrift.length)

  const gitInfo = await call('get_git_status')
  check('get_git_status reports sync state', typeof gitInfo.synced === 'boolean' && !!gitInfo.head, gitInfo.head)

  const exported = await call('export_snapshot', { saveTo: '../../mcp-escape-check.json' })
  const saved = path.resolve(exported.savedTo || '')
  check('export path cannot escape .tmp', saved.startsWith(path.join(ROOT, '.tmp') + path.sep), saved)
  check('export writes a real JSON file', fs.existsSync(saved) && fs.statSync(saved).size > 1000, exported.bytes)
  try { fs.unlinkSync(saved) } catch (_) { /* ignore */ }

  const unknown = await client.callTool({ name: 'run_arbitrary_command', arguments: { cmd: 'dir' } })
  check('unknown tool is rejected', unknown.isError === true, 'ok')

  await client.close()

  const passed = checks.filter((c) => c.pass).length
  log.push('RESULT ' + passed + '/' + checks.length)
  console.log('RESULT ' + passed + '/' + checks.length)
  fs.writeFileSync(OUT, JSON.stringify({ passed, total: checks.length, allPassed: passed === checks.length, checks, log }, null, 2))
  process.exit(passed === checks.length ? 0 : 1)
}

main().catch((e) => {
  const msg = String((e && e.stack) || e)
  log.push('FATAL ' + msg)
  console.error(msg)
  fs.writeFileSync(OUT, JSON.stringify({ passed: 0, total: checks.length, allPassed: false, error: msg, checks, log }, null, 2))
  process.exit(1)
})

/* Cross-terminal launcher for the Electron smoke check.
 * WorkBuddy (and other Electron hosts) inject ELECTRON_RUN_AS_NODE=1, which
 * would make the local electron.exe behave as plain Node. We strip it here so
 * `npm run smoke` works from the built-in terminal as well as a normal shell.
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { ensureBuild } = require('./ensure-build.cjs')

const ROOT = path.resolve(__dirname, '..')
const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const entry = path.join(__dirname, 'smoke-electron.cjs')
const resultFile = path.join(__dirname, 'smoke-result.json')

if (!fs.existsSync(exe)) {
  console.error('Electron binary missing: npm install first')
  process.exit(2)
}
// Rebuild when sources are newer than the bundle, so the 52 checks never run
// against a stale dist/.
if (!ensureBuild()) process.exit(2)
try {
  fs.unlinkSync(resultFile)
} catch (_) {
  /* no previous result */
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(exe, [entry], { cwd: ROOT, env, stdio: 'inherit' })
child.on('error', (e) => {
  console.error(e)
  process.exit(1)
})
child.on('exit', (code) => {
  if (!fs.existsSync(resultFile)) {
    console.error('Smoke check produced no result file (electron exited ' + code + ').')
    process.exit(1)
  }
  const r = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
  for (const c of r.checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  —  ' + c.detail : ''}`)
  }
  if (r.error) console.error('\nERROR: ' + r.error)
  console.log(`\n${r.passed} passed / ${r.failed} failed  (Electron ${r.electron}, Node ${r.node})`)
  process.exit(r.error || r.failed || code ? 1 : 0)
})

/* Launcher for the real wrong-word notebook check. Strips the host's
 * ELECTRON_RUN_AS_NODE, guarantees a fresh build, and never trusts stale output. */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { ensureBuild } = require('./ensure-build.cjs')

const ROOT = path.resolve(__dirname, '..')
if (!ensureBuild()) process.exit(2)
const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const out = path.join(__dirname, 'verify-wrongwords-result.json')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

try { fs.unlinkSync(out) } catch (_) { /* no previous result */ }

const child = spawn(exe, [path.join(__dirname, 'verify-wrongwords.cjs')], { cwd: ROOT, env, stdio: 'inherit' })
child.on('exit', () => {
  let r
  try { r = JSON.parse(fs.readFileSync(out, 'utf8')) } catch (e) {
    console.error('wrong-word verification FAILED: no fresh result file', e.message)
    process.exit(2)
  }
  const line = r.log.filter((l) => l.indexOf('RESULT ') === 0).pop()
  let parsed = null
  try { parsed = JSON.parse(line.slice('RESULT '.length)) } catch (_) { /* malformed */ }
  const ok = !r.error && parsed && parsed.persisted === true &&
    parsed.twoColumns === true && parsed.meaningShown === true
  console.log('wrong-word verification:', ok ? 'PASS' : 'FAILED',
    r.error || (line || 'no RESULT line'))
  process.exit(ok ? 0 : 1)
})

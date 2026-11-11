/* Launcher that strips ELECTRON_RUN_AS_NODE (injected by some hosts) and
 * validates the probe result. Never trust a stale result file. */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { ensureBuild } = require('./ensure-build.cjs')
const ROOT = path.resolve(__dirname, '..')
if (!ensureBuild()) process.exit(2)
const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const out = path.join(__dirname, 'verify-middleclick-result.json')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Remove the previous result so a crashed child cannot inherit a PASS.
try { fs.unlinkSync(out) } catch (_) { /* no previous result */ }

const child = spawn(exe, [path.join(__dirname, 'verify-middleclick.cjs')], { cwd: ROOT, env, stdio: 'inherit' })
child.on('exit', () => {
  let r
  try { r = JSON.parse(fs.readFileSync(out, 'utf8')) } catch (e) {
    console.error('middle-click verification FAILED: no fresh result file', e.message)
    process.exit(2)
  }
  const line = r.log.filter((l) => l.indexOf('RESULT ') === 0).pop()
  let parsed = null
  try { parsed = JSON.parse(line.slice('RESULT '.length)) } catch (_) { /* malformed */ }
  const ok = !r.error && parsed && parsed.menu === true &&
    parsed.hasAllItems === true &&
    Array.isArray(parsed.events) && parsed.events.indexOf('mousedown|1') >= 0
  console.log('middle-click verification:', ok ? 'PASS' : 'FAILED',
    r.error || (line || 'no RESULT line'))
  process.exit(ok ? 0 : 1)
})

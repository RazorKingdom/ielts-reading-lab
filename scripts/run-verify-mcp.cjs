/* Launcher for the MCP stdio verification. Never trusts a stale result file. */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const out = path.join(__dirname, 'verify-mcp-result.json')
try { fs.unlinkSync(out) } catch (_) { /* no previous result */ }

const child = spawn(process.execPath, [path.join(__dirname, 'verify-mcp.cjs')], {
  cwd: ROOT, env: { ...process.env, LAB_ROOT: ROOT }, stdio: 'inherit',
})
child.on('exit', () => {
  let r
  try { r = JSON.parse(fs.readFileSync(out, 'utf8')) } catch (e) {
    console.error('MCP verification FAILED: no fresh result file', e.message)
    process.exit(2)
  }
  console.log('MCP verification:', r.allPassed ? 'PASS' : 'FAILED', r.passed + '/' + r.total,
    r.error || '')
  process.exit(r.allPassed ? 0 : 1)
})

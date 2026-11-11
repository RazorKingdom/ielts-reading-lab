/* Launcher that strips ELECTRON_RUN_AS_NODE (injected by some hosts). */
const { spawn } = require('child_process')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [path.join(__dirname, 'verify-middleclick.cjs')], { cwd: ROOT, env, stdio: 'inherit' })
child.on('exit', (code) => {
  const fs = require('fs')
  const out = path.join(__dirname, 'verify-middleclick-result.json')
  try {
    const r = JSON.parse(fs.readFileSync(out, 'utf8'))
    const last = r.log.filter((l) => l.indexOf('RESULT') === 0).pop()
    console.log('middle-click verification:', r.error ? 'FAILED ' + r.error : (last || 'no result'))
    if (!r.error && last && last.indexOf('"menu":true') >= 0) process.exit(0)
    process.exit(1)
  } catch (e) { console.error('no verification result', e.message); process.exit(2) }
})

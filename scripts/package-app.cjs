/* Build a portable Windows app by assembling the Electron runtime with a
 * plain `resources/app` directory (no asar). This is the most robust layout:
 * Electron auto-detects resources/app and all files stay real on disk, so
 * sql.js can read its WASM via a normal path. Avoids electron-builder's temp
 * rename which is blocked in sandboxed hosts.
 *
 * Output: release/IELTS Reading Lab/  -> double-click "IELTS Reading Lab.exe"
 */
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'release', 'IELTS Reading Lab v5')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const APP = path.join(OUT, 'resources', 'app')
const EXE_NAME = 'IELTS Reading Lab.exe'

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch (_) {} }

function main() {
  for (const f of ['dist/index.html', 'dist-electron/electron/main.js', 'dist-electron/electron/preload.js']) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error('Missing ' + f + ' — run npm run build first')
  }
  rm(OUT)
  fs.mkdirSync(OUT, { recursive: true })

  // 1) Electron runtime (everything except its bundled resources).
  for (const entry of fs.readdirSync(ELECTRON_DIST, { withFileTypes: true })) {
    if (entry.name === 'resources') continue
    const s = path.join(ELECTRON_DIST, entry.name)
    const d = path.join(OUT, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, EXE_NAME))

  // 2) Application as a real directory under resources/app.
  copyDir(path.join(ROOT, 'dist'), path.join(APP, 'dist'))
  copyDir(path.join(ROOT, 'dist-electron'), path.join(APP, 'dist-electron'))
  // node_modules needed at runtime: only sql.js (WASM + loader).
  copyDir(path.join(ROOT, 'node_modules', 'sql.js'), path.join(APP, 'node_modules', 'sql.js'))
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  fs.writeFileSync(
    path.join(APP, 'package.json'),
    JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main }, null, 2),
  )

  const exe = path.join(OUT, EXE_NAME)
  console.log('OK portable app:', exe)
  console.log('exe:', (fs.statSync(exe).size / 1048576).toFixed(1), 'MiB')
  console.log('app dir:', path.relative(OUT, APP))
}
try { main() } catch (e) { console.error('FAILED:', e.stack || e.message); process.exit(1) }

/* Ensure dist/ and dist-electron/ are newer than the sources.
 *
 * smoke-electron.cjs and verify-middleclick.cjs both load the built bundle.
 * Without this guard, editing src/ and running `npm test` or `npm run smoke`
 * silently tests a stale bundle. Rebuild only when something actually changed,
 * so `npm run test:all` builds once instead of three times.
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function walk(dir, out) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|css|html|json)$/.test(e.name)) out.push(p)
  }
  return out
}

function newest(files) {
  let t = 0
  for (const f of files) {
    try { const m = fs.statSync(f).mtimeMs; if (m > t) t = m } catch (_) { /* ignore */ }
  }
  return t
}

function ensureBuild() {
  const sources = [
    ...walk(path.join(ROOT, 'src'), []),
    ...walk(path.join(ROOT, 'electron'), []),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'vite.config.ts'),
    path.join(ROOT, 'tsconfig.json'),
    path.join(ROOT, 'tsconfig.electron.json'),
    path.join(ROOT, 'package.json'),
  ]
  const artifacts = [
    ...walk(path.join(ROOT, 'dist'), []),
    ...walk(path.join(ROOT, 'dist-electron'), []),
  ]
  const srcTime = newest(sources)
  const artTime = artifacts.length ? newest(artifacts) : 0
  if (artifacts.length && artTime >= srcTime) {
    console.log('[ensure-build] artifacts are up to date')
    return true
  }
  console.log('[ensure-build] sources are newer than dist/ - rebuilding...')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error('[ensure-build] build failed')
    return false
  }
  return true
}

module.exports = { ensureBuild }

if (require.main === module) {
  if (!ensureBuild()) process.exit(1)
}

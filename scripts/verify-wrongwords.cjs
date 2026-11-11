/* Real end-to-end check for the wrong-word notebook.
 * Uses genuine Chromium input events in the packaged renderer, then verifies
 * the word actually landed in SQLite via the whitelisted IPC, and that the
 * notebook page renders two columns and shows a meaning on click. */
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const USER_DATA = path.join(ROOT, '.verify-ww-userdata')
const OUT = path.join(ROOT, 'scripts', 'verify-wrongwords-result.json')
const log = []
const say = (...a) => { const s = a.join(' '); log.push(s); try { console.log(s) } catch (_) {} }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const timer = setTimeout(() => finish(new Error('timeout')), 45000)

function finish(err) {
  clearTimeout(timer)
  try { fs.writeFileSync(OUT, JSON.stringify({ error: err ? String(err.stack || err) : null, log }, null, 2)) } catch (_) {}
  if (app && app.exit) app.exit(err ? 1 : 0)
}
process.on('uncaughtException', (e) => { say('FATAL', String((e && e.stack) || e)); finish(e) })

// Start from a clean database so a previous run can never fake a PASS.
try {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  app.setPath('userData', USER_DATA)
} catch (e) { finish(e) }

app.whenReady().then(async () => {
  try {
    const { openDatabase, createSqliteStore } = require('../dist-electron/electron/db.js')
    const { createRuntime } = require('../dist-electron/src/core/runtime.js')
    const { LAB_API_METHODS } = require('../dist-electron/electron/apiMethods.js')
    await openDatabase()
    const runtime = createRuntime({ store: createSqliteStore(), backendKind: 'electron-sqlite' })
    ipcMain.handle('lab:invoke', async (_e, m, a) => {
      if (!LAB_API_METHODS.includes(m)) throw new Error('not allowed: ' + m)
      return runtime[m](...(a || []))
    })
    ipcMain.handle('lab:hostInfo', () => ({ kind: 'electron', dbPath: 'x', electron: process.versions.electron, node: process.versions.node, platform: process.platform, dev: false }))

    const win = new BrowserWindow({
      width: 1280, height: 800, show: false,
      webPreferences: {
        preload: path.join(ROOT, 'dist-electron', 'electron', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    })
    const js = (code) => win.webContents.executeJavaScript(code)
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
    await wait(1200)

    // 1. Open the first article in the reader.
    await js(`Array.from(document.querySelectorAll('button')).filter(function(b){return b.innerText.trim()==='阅读'})[0].click()`)
    await wait(1400)
    const sentences = await js(`document.querySelectorAll('[data-sid]').length`)
    say('sentences', sentences)
    if (!sentences) { finish(new Error('reader did not open')); return }

    // 2. Find a point that truly hits the sentence span, then REAL left click.
    const pt = await js(`(function(){
      var s=document.querySelector('[data-sid]');var r=s.getBoundingClientRect();var f=null;
      for(var yy=Math.ceil(r.top)+3; yy<Math.floor(r.bottom)-3 && !f; yy+=4){
        for(var xx=Math.ceil(r.left)+30; xx<Math.floor(r.right)-3; xx+=4){
          var el=document.elementFromPoint(xx,yy);
          if(el===s || (el && el.closest && el.closest('[data-sid]')===s)){f={x:xx,y:yy};break}
        }
      }
      return f;
    })()`)
    if (!pt) { finish(new Error('no hittable point on sentence')); return }
    say('click point', JSON.stringify(pt))
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    await wait(500)

    // 3. The word card must contain the real "添加错词本" button.
    const card = await js(`(function(){
      var c=document.querySelector('.word-tool');
      if(!c) return {open:false};
      var b=Array.from(c.querySelectorAll('button')).filter(function(x){return x.innerText.indexOf('添加错词本')>=0})[0];
      return {open:true, query:(c.querySelector('.word-query')||{}).innerText||'', hasButton:!!b};
    })()`)
    say('WORD_CARD', JSON.stringify(card))
    if (!card.open || !card.hasButton) { finish(new Error('word card or add button missing: ' + JSON.stringify(card))); return }

    // 4. Click the button (a normal button click; no native special handling
    //    involved) and read the row back through the real IPC + SQLite.
    await js(`(function(){var c=document.querySelector('.word-tool');Array.from(c.querySelectorAll('button')).filter(function(x){return x.innerText.indexOf('添加错词本')>=0})[0].click();return true})()`)
    await wait(900)
    await js(`window.__ww=null;window.labAPI.listWrongWords().then(function(l){window.__ww=l.map(function(w){return {word:w.word,query:w.query,found:w.found,translation:String(w.translation).slice(0,40)}})})`)
    await wait(400)
    const stored = await js(`window.__ww`)
    say('STORED', JSON.stringify(stored))
    if (!Array.isArray(stored) || stored.length !== 1) {
      finish(new Error('word was not persisted through IPC: ' + JSON.stringify(stored))); return
    }

    // 5. Navigate to the notebook via the real sidebar nav button.
    const navigated = await js(`(function(){
      var b=Array.from(document.querySelectorAll('.nav-item')).filter(function(x){return x.innerText.trim()==='错词本'})[0];
      if(!b) return false; b.click(); return true;
    })()`)
    if (!navigated) { finish(new Error('错词本 nav item missing')); return }
    await wait(900)
    const page = await js(`(function(){
      return {columns:!!document.querySelector('.ww-columns'),
        col1:!!document.querySelector('[data-column="1"]'),
        col2:!!document.querySelector('[data-column="2"]'),
        rows:document.querySelectorAll('.ww-row').length,
        hasMeaningBefore:!!document.querySelector('.ww-meaning')};
    })()`)
    say('NOTEBOOK', JSON.stringify(page))
    if (!page.columns || !page.col1 || !page.col2 || page.rows !== 1) {
      finish(new Error('two-column notebook did not render: ' + JSON.stringify(page))); return
    }

    // 6. Click the word row; a meaning must appear.
    await js(`document.querySelector('.ww-row').click()`)
    await wait(400)
    const meaning = await js(`(function(){var m=document.querySelector('.ww-meaning');return m?m.innerText:''})()`)
    say('MEANING', JSON.stringify(meaning.slice(0, 80)))
    if (!meaning.trim()) { finish(new Error('clicking a word did not show its meaning')); return }

    const result = {
      stored: stored, page: page, meaning: meaning.slice(0, 80),
      persisted: stored.length === 1, twoColumns: page.col1 && page.col2,
      meaningShown: meaning.trim().length > 0,
    }
    say('RESULT', JSON.stringify(result))
    const ok = result.persisted && result.twoColumns && result.meaningShown && !page.hasMeaningBefore
    if (!ok) { finish(new Error('notebook verification failed: ' + JSON.stringify(result))); return }
    finish(null)
  } catch (e) { finish(e) }
})

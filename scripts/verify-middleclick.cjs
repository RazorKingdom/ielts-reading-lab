/* Minimal real-middle-click probe: navigate into the reader, send a genuine
 * middle mouse press via Chromium, then check whether a menu is in the DOM. */
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain } = require('electron')
const ROOT = path.resolve(__dirname, '..')
const USER_DATA = path.join(ROOT, '.probe-userdata')
const OUT = path.join(ROOT, 'scripts', 'verify-middleclick-result.json')
const log = []
const say = (...a) => { const s = a.join(' '); log.push(s); try { console.log(s) } catch (_) {} }
const timer = setTimeout(() => finish(new Error('timeout')), 30000)
function finish(err) {
  clearTimeout(timer)
  try { fs.writeFileSync(OUT, JSON.stringify({ error: err ? String(err.stack || err) : null, log }, null, 2)) } catch (_) {}
  if (app && app.exit) app.exit(err ? 1 : 0)
}
process.on('uncaughtException', (e) => { say('FATAL', String(e && e.stack || e)); finish(e) })
try { fs.mkdirSync(USER_DATA, { recursive: true }); app.setPath('userData', USER_DATA) } catch (e) { finish(e) }

app.whenReady().then(async () => {
  try {
    const { openDatabase, createSqliteStore } = require('../dist-electron/electron/db.js')
    const { createRuntime } = require('../dist-electron/src/core/runtime.js')
    const { LAB_API_METHODS } = require('../dist-electron/electron/apiMethods.js')
    // openDatabase() is async and derives its path from app.getPath('userData');
    // createSqliteStore() takes no arguments. (USER_DATA is set above.)
    await openDatabase()
    const runtime = createRuntime({ store: createSqliteStore(), backendKind: 'electron-sqlite' })
    ipcMain.handle('lab:invoke', async (_e, m, a) => {
      if (!LAB_API_METHODS.includes(m)) throw new Error('not allowed: ' + m)
      return runtime[m](...(a || []))
    })
    ipcMain.handle('lab:hostInfo', () => ({ kind: 'electron', dbPath: 'x', electron: process.versions.electron, node: process.versions.node, platform: process.platform, dev: false }))

    const win = new BrowserWindow({ width: 1280, height: 800, show: false,
      webPreferences: { preload: path.join(ROOT, 'dist-electron', 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
    await new Promise(r => setTimeout(r, 1200))

    // Enter reader via a per-article "阅读" button.
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).filter(function(b){return b.innerText.trim()==='阅读'})[0].click()`)
    await new Promise(r => setTimeout(r, 1500))
    const count = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-sid]').length`)
    say('sentences', count)
    if (!count) { finish(new Error('reader not open')); return }

    // Attach a capture listener using a plain string (no regex).
    await win.webContents.executeJavaScript(`window.__ev=[];var s=document.querySelector('[data-sid]');['mousedown','mouseup','auxclick','click'].forEach(function(t){s.addEventListener(t,function(e){window.__ev.push(t+'|'+e.button)})})`)

    // Scan for a point that actually hits the sentence span (inline text).
    const rect = await win.webContents.executeJavaScript(`(function(){
      var s=document.querySelector('[data-sid]');var r=s.getBoundingClientRect();
      var found=null;
      for(var yy=Math.ceil(r.top)+3; yy<Math.floor(r.bottom)-3 && !found; yy+=4){
        for(var xx=Math.ceil(r.left)+3; xx<Math.floor(r.right)-3; xx+=4){
          var el=document.elementFromPoint(xx,yy);
          if(el===s || (el && el.closest && el.closest('[data-sid]')===s)){found={x:xx,y:yy};break}
        }
      }
      return {found:found, rect:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
    })()`)
    say('rect', JSON.stringify(rect))
    if (!rect.found) { finish(new Error('no hittable point on sentence')); return }
    const pt = rect.found

    // Sanity check: a LEFT click at the same coordinates must reach the element.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 300))
    const left = await win.webContents.executeJavaScript(`window.__ev.join(',')`)
    say('AFTER_LEFT', left)
    if (left.indexOf('mousedown|0') < 0) { finish(new Error('left click did not reach the sentence (bad coordinates)')); return }

    // CRITICAL: a left click may have opened the word card. Both the word card
    // and the action menu share the .sentence-menu class, so a leftover card
    // would make a broken middle-click look like a pass. Dismiss all layers
    // with Escape and assert the DOM is clean BEFORE the middle click.
    // Dismiss overlays. Escape handling is a window keydown listener, so a DOM
    // KeyboardEvent is sufficient here (this is cleanup, not the behavior
    // under test). The middle-click itself still uses real sendInputEvent.
    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await new Promise(r => setTimeout(r, 250))
    const clean = await win.webContents.executeJavaScript(`document.querySelectorAll('.sentence-menu').length`)
    say('DOM_BEFORE_MIDDLE', clean)
    if (clean !== 0) { finish(new Error('stale .sentence-menu layer before middle click; cannot verify')); return }
    await win.webContents.executeJavaScript(`window.__ev=[]`)

    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'middle', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'middle', clickCount: 1 })
    await new Promise(r => setTimeout(r, 900))

    // Only the three-choice action menu counts. Never use the shared
    // .sentence-menu selector here.
    const result = await win.webContents.executeJavaScript(`(function(){
      var m=document.querySelector('.sentence-action-menu');
      var t=m?m.innerText:'';
      return {events:window.__ev, menu:!!m,
        hasAllItems: t.indexOf('直接解析')>=0 && t.indexOf('推导训练')>=0 && t.indexOf('加入复测')>=0,
        text:t.slice(0,80)};
    })()`)
    say('RESULT', JSON.stringify(result))
    const sawMiddleDown = result.events.some((e) => e === 'mousedown|1')
    const ok = result.menu && result.hasAllItems && sawMiddleDown
    if (!ok) { finish(new Error('middle-click menu did not open correctly: ' + JSON.stringify(result))); return }
    finish(null)
  } catch (e) { finish(e) }
})

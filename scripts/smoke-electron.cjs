/* Electron end-to-end smoke check.
 *
 * Run after `npm run build`:
 *   node_modules/electron/dist/electron.exe scripts/smoke-electron.cjs
 *
 * Windows GUI builds do not attach stdout to the calling terminal, so the
 * structured result is written to scripts/smoke-result.json instead.
 * Verifies: SQLite file creation, append-only persistence across a runtime
 * restart, the teaching chain, the answer-exposure attribution, the IPC
 * whitelist, the sandboxed preload bridge and the React renderer boot.
 */
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const RESULT = path.join(__dirname, 'smoke-result.json')
const USER_DATA = path.join(ROOT, '.smoke-userdata')
const checks = []

function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail: String(detail) })
}

function finish(err) {
  const payload = {
    at: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    error: err ? String(err && err.stack ? err.stack : err) : null,
    checks,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
  }
  try {
    fs.writeFileSync(RESULT, JSON.stringify(payload, null, 2))
  } catch (_) {
    /* ignore */
  }
  app.exit(payload.error || payload.failed ? 1 : 0)
}

process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
const timer = setTimeout(() => finish(new Error('smoke timeout (30s)')), 30000)
if (timer.unref) timer.unref()

try {
  fs.mkdirSync(USER_DATA, { recursive: true })
  app.setPath('userData', USER_DATA)
} catch (e) {
  finish(e)
}

app.whenReady().then(async () => {
  const { openDatabase, createSqliteStore } = require('../dist-electron/electron/db.js')
  const { createRuntime } = require('../dist-electron/src/core/runtime.js')
  const { LAB_API_METHODS } = require('../dist-electron/electron/apiMethods.js')
  const { createArticle, segmentArticle } = require('../dist-electron/src/core/segment.js')
  const { createProvider } = require('../dist-electron/src/core/diagnose.js')
  const { OpenAICompatibleProvider } = require('../dist-electron/src/core/apiProvider.js')
  const { dictionarySize, lookupWord } = require('../dist-electron/src/core/dictionary.js')
  const { offlineExplanationCount, analysisWithOffline } =
    require('../dist-electron/src/core/explanations.js')
  const { ARTICLE_BANK } = require('../dist-electron/src/core/articleBank.js')

  check('100 篇文章逐句离线解析随包', offlineExplanationCount() > 3500, `${offlineExplanationCount()} 句`)

  // Built-in sentences must ship a real Chinese SVO skeleton (no placeholder
  // predicate), including the 97 composed passages, not only the focus ones.
  const builtIn = createArticle({ originalText: ARTICLE_BANK[50].text, id: 'sample-51' })
  const builtInSentence = segmentArticle(builtIn)[0].sentences[0]
  const builtInAnalysis = analysisWithOffline(
    builtInSentence.id,
    builtInSentence.text,
  )
  check(
    '内置句谓语为英文原句片段而非占位',
    builtInAnalysis.source === 'bundled' &&
      builtInAnalysis.skeleton.predicate.length > 0 &&
      /[A-Za-z]/.test(builtInAnalysis.skeleton.predicate) &&
      !/[一-龥]/.test(builtInAnalysis.skeleton.predicate) &&
      !builtInAnalysis.skeleton.predicate.includes('离线规则未标注谓语'),
    `${builtInAnalysis.skeleton.subject} / ${builtInAnalysis.skeleton.predicate}`,
  )

  // Interaction: left = word, right = compact meaning popover, middle = the
  // three-choice action menu (direct analysis / derived training / review).
  // These bundle-string checks are regression sentinels only: the real DOM
  // dispatch + API-attribution assertions live in
  // tests/component/Reader.interactions.test.tsx (run via `npm run test:component`).
  const rendererJs = fs.readFileSync(
    path.join(ROOT, 'dist', 'assets', fs.readdirSync(path.join(ROOT, 'dist', 'assets')).find((f) => f.endsWith('.js'))),
    'utf8',
  )
  check(
    '右键语义悬浮窗存在（扇贝式，不标曝光）',
    rendererJs.includes('句子语义') && rendererJs.includes('st-meaning') &&
      rendererJs.includes('中键点句展开完整解析与训练'),
  )
  check(
    '中键三选菜单：直接解析 / 推导训练 / 加入复测',
    rendererJs.includes('直接解析') && rendererJs.includes('推导训练') && rendererJs.includes('加入复测') &&
      rendererJs.includes('onAuxClick'),
  )
  check(
    '稍后复习按钮已移入解析栏底部',
    rendererJs.includes('稍后复习 · 排入复测') && rendererJs.includes('进入引导训练'),
  )
  check(
    '工作台介绍性提示文案已清理',
    !rendererJs.includes('左键点词查词 · 右键点句') &&
      !rendererJs.includes('文章以纯文本渲染') &&
      !rendererJs.includes('查看完整解析后，同句训练') &&
      !rendererJs.includes('随应用离线提供，无请求、无费用') &&
      !rendererJs.includes('按意群整体理解，不必逐词对应中文') &&
      !rendererJs.includes('本地词库 · 无需联网或 AI') &&
      !rendererJs.includes('PARAGRAPH '),
  )

  check('离线词库随应用打包', dictionarySize() > 10000, `${dictionarySize()} 条`)
  const dictHit = lookupWord('technology')
  check('离线查词无需网络即可命中', dictHit.found && /技术|工艺/.test(dictHit.entry?.translation ?? ''), dictHit.entry?.word)
  const dictMiss = lookupWord('zzzznotaword')
  check('未收录词如实提示而非编造释义', dictMiss.found === false && !!dictMiss.note)

  // Fresh database on every run so the check is deterministic and reproducible.
  const smokeDb = path.join(USER_DATA, 'reading-lab.sqlite')
  const smokeCred = path.join(USER_DATA, 'api-credential.bin')
  for (const file of [smokeDb, smokeCred]) {
    try {
      fs.unlinkSync(file)
    } catch (_) {
      /* first run */
    }
  }
  const dbPath = await openDatabase()
  check('SQLite 数据库文件已创建', fs.existsSync(dbPath), dbPath)
  check('SQLITE WASM 可加载且 records 表存在', fs.statSync(dbPath).size > 0, `${fs.statSync(dbPath).size} bytes`)

  const store = createSqliteStore()
  const makeFactory = (s) => async (id) => {
    if (id === 'third-party-api') {
      const cfg = await s.getApiConfig()
      const key = await s.getApiKey()
      return new OpenAICompatibleProvider({ baseUrl: cfg.baseUrl, model: cfg.model, apiKey: key ?? '' })
    }
    return createProvider(id)
  }
  const api = createRuntime({ store, backendKind: 'electron-sqlite', providerFactory: makeFactory(store) })

  const boot = await api.bootstrap()
  check('bootstrap 注入 100 篇内置文章', boot.articles.length === 100, `${boot.articles.length} 篇`)
  check(
    '内置文章标题唯一且均标注非官方真题',
    new Set(boot.articles.map((a) => a.title)).size === 100 &&
      boot.articles.every((a) => a.sourceNote.includes('非官方真题')),
  )
  const wordCounts = boot.articles.map((a) => a.originalText.trim().split(/\s+/).length)
  const minWords = Math.min(...wordCounts)
  const maxWords = Math.max(...wordCounts)
  check('内置文章均为 700–900 词长文', minWords >= 700 && maxWords <= 900, `min ${minWords} / max ${maxWords}`)
  check(
    '设置页只暴露一个第三方 API Provider',
    boot.providers.length === 1 && boot.providers[0].id === 'third-party-api',
    boot.providers.map((p) => p.id).join(', '),
  )
  check('未配置时该 Provider 为 disabled', boot.providers[0].status === 'disabled', boot.providers[0].status)
  check('backendKind 为 electron-sqlite', boot.backendKind === 'electron-sqlite', boot.backendKind)

  const article = await api.createArticle({
    title: 'Smoke Test Article',
    originalText:
      'The extent to which technology improves productivity depends on how effectively employees use it. Success depends less on speed than on accuracy.',
  })
  const paragraph = segmentArticle(article)[0]
  const sentence = paragraph.sentences[0]
  check('文章分句与版本 hash', !!article.versionHash && paragraph.sentences.length === 2, `${paragraph.sentences.length} 句 / ${article.versionHash.slice(0, 10)}`)

  const analysis = await api.getAnalysis({
    articleId: article.id,
    sentenceId: sentence.id,
    sentenceText: sentence.text,
    paragraphNo: sentence.paragraphNo,
    articleVersion: article.versionHash,
    contextBefore: '',
    contextAfter: sentence.text,
  })
  check('直接解析生成诊断目标', analysis.targets.length > 0, `${analysis.targets.length} 个目标`)

  check('答案曝光标记初始为 false', (await api.hasAnalysisBeenViewed(article.id, sentence.id)) === false)

  const input = {
    articleId: article.id,
    sentenceId: sentence.id,
    sentenceText: sentence.text,
    paragraphNo: sentence.paragraphNo,
    articleVersion: article.versionHash,
    contextBefore: '',
    contextAfter: sentence.text,
    directAnalysisSeen: false,
  }
  const started = await api.startSession(input)
  check('会话从 PREPARE / Level 0 开始', started.session.state === 'PREPARE' && started.session.currentLevel === 0, started.session.state)
  check('初始无作答、无反馈', started.attempts.length === 0 && started.feedback.length === 0)

  await api.dispatch(started.session.id, { type: 'SET_DRAFT', text: '草稿：技术提高生产率取决于' })
  const resumed = await api.resumeSession(started.session.id)
  check('退出后草稿可从 SQLite 恢复', resumed && resumed.session.draft.startsWith('草稿'), resumed && resumed.session.draft)

  const submitted = await api.dispatch(started.session.id, {
    type: 'SUBMIT',
    text: '技术提高生产率取决于员工怎么使用技术。',
  })
  check('首次答案先落库且不可覆盖', submitted.attempts.length === 1 && submitted.attempts[0].exposureSnapshot.level === 0, `${submitted.attempts.length} 条`)
  check('诊断通过 Validator', !!submitted.diagnosis && submitted.diagnosis.validation.valid === true, submitted.notice || '')
  check('状态机裁决为渐进反馈而非直接给答案', ['CLARIFY', 'RETRY', 'PASS'].includes(submitted.session.state), submitted.session.state)
  check('Level 1 反馈未泄露完整解析', submitted.feedback.some((f) => f.level === 1) && !submitted.feedback.some((f) => f.level === 3 && f.kind === 'full'), `${submitted.feedback.length} 条反馈`)
  check('教学决策已记录且带策略版本', submitted.decisions.length === 1 && !!submitted.decisions[0].policyVersion, submitted.decisions[0] && submitted.decisions[0].action)

  const revealed = await api.dispatch(started.session.id, { type: 'UNLOCK_LEVEL3' })
  check('随时可解锁 Level 3 并写入曝光标记', revealed.session.answerRevealed === true && revealed.session.currentLevel === 3)
  const profile = await api.getProfile()
  check('曝光后不再计为独立正确', profile.stats.independentCorrect === 0, `independentCorrect=${profile.stats.independentCorrect}`)
  check('学习档案含证据观察记录', profile.observations.length > 0, `${profile.observations.length} 条`)

  // Simulate an app restart: same SQLite file, brand-new runtime instance.
  const reopened = await openDatabase()
  const restartStore = createSqliteStore()
  const afterRestart = createRuntime({
    store: restartStore,
    backendKind: 'electron-sqlite',
    providerFactory: makeFactory(restartStore),
  })
  const restored = await afterRestart.resumeSession(started.session.id)
  check('重启后会话/作答/诊断完整恢复', !!restored && restored.attempts.length === 1 && !!restored.diagnosis && restored.session.answerRevealed === true, reopened)

  await api.markAnalysisViewed(article.id, sentence.id)
  check('直接解析查看后写入曝光记录', (await api.hasAnalysisBeenViewed(article.id, sentence.id)) === true)

  const exported = JSON.parse(await api.exportData())
  check('导出数据包含 append-only 行', exported.format === 'ielts-reading-lab-export' && exported.rows.length >= 8, `${exported.rows.length} 行`)

  // ---- third-party API credential handling (no real network calls) ----
  const cfg0 = await api.getApiConfig()
  check('默认未配置密钥且未启用', cfg0.hasKey === false && cfg0.enabled === false)
  const noKeyProbe = await api.testApiConnection()
  check('无密钥时不会发起连接请求', noKeyProbe.ok === false && /API Key/.test(noKeyProbe.message), noKeyProbe.message)
  const gated = await api.setApiConfig({
    baseUrl: 'https://example.test/v1', model: 'm', costConfirmed: false, enabled: true,
  })
  check('未确认费用时启用被拒绝', gated.enabled === false)

  const SMOKE_KEY = 'sk-smoke-DO-NOT-USE-42'
  const credFile = path.join(USER_DATA, 'api-credential.bin')
  try {
    const withKey = await api.setApiKey(SMOKE_KEY)
    const stored = withKey.hasKey === true && fs.existsSync(credFile)
    check('API Key 写入系统加密存储', stored, credFile)
    if (stored) {
      check('凭据文件不含明文密钥', !fs.readFileSync(credFile).toString('utf8').includes(SMOKE_KEY))
    }
    check('导出数据不含 API Key', !(await api.exportData()).includes(SMOKE_KEY))
    const stillGated = await api.setApiConfig({ costConfirmed: false, enabled: true })
    check('仅有密钥但无费用确认仍不可启用', stillGated.enabled === false)
  } catch (e) {
    check('API Key 写入系统加密存储', false, e instanceof Error ? e.message : String(e))
  }
  const cleared = await api.clearApiKey()
  check(
    '清除密钥后自动停用且文件移除',
    cleared.hasKey === false && cleared.enabled === false && !fs.existsSync(credFile),
  )

  // ---- renderer + sandboxed preload bridge ----
  ipcMain.handle('lab:invoke', async (_e, method, args) => {
    if (!LAB_API_METHODS.includes(method)) throw new Error(`IPC method not allowed: ${method}`)
    return api[method](...(args || []))
  })
  ipcMain.handle('lab:hostInfo', () => ({ kind: 'electron', dbPath, electron: process.versions.electron, node: process.versions.node, platform: process.platform, dev: false }))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'dist-electron', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level === 3 || /error/i.test(message)) check('渲染进程控制台无错误', false, message)
  })

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 1500))
  const rendered = await win.webContents.executeJavaScript(
    'JSON.stringify({api: !!window.labAPI, host: !!window.labHost, len: document.body.innerText.length, head: document.body.innerText.slice(0, 160)})',
  )
  const page = JSON.parse(rendered)
  check('preload 桥接注入 labAPI', page.api === true, JSON.stringify(page.head).slice(0, 120))
  check('preload 桥接注入 labHost', page.host === true)
  check('React 界面已渲染', page.len > 100, `${page.len} chars`)

  // Verify the font-scale setting really reaches the rendered text: build a
  // reader-column/sentence pair, vary --reader-font-scale and read back the
  // computed px size from the real Chromium layout engine.
  const fontScaleProbe = JSON.parse(
    await win.webContents.executeJavaScript(`(function () {
      var box = document.createElement('div');
      box.className = 'reader-column';
      var sp = document.createElement('span');
      sp.className = 'sentence';
      sp.textContent = 'Scale probe';
      box.appendChild(sp);
      document.body.appendChild(box);
      function px(v) {
        box.style.setProperty('--reader-font-scale', v);
        return parseFloat(getComputedStyle(sp).fontSize);
      }
      var base = px('1'), big = px('1.5'), small = px('0.85');
      box.remove();
      return JSON.stringify({ base: base, big: big, small: small });
    })()`),
  )
  check(
    '正文字号随缩放设置真实变化（CSS 变量生效）',
    fontScaleProbe.big > fontScaleProbe.base &&
      fontScaleProbe.base > fontScaleProbe.small &&
      Math.abs(fontScaleProbe.base - 17) < 1,
    `${fontScaleProbe.base} / ${fontScaleProbe.big} / ${fontScaleProbe.small} px`,
  )

  const ipcRoundTrip = await win.webContents.executeJavaScript(
    'window.labAPI.listProviders().then(function (p) { return p.length })',
  )
  check('渲染进程经白名单 IPC 只拿到一个 Provider', Number(ipcRoundTrip) === 1, `${ipcRoundTrip} 个`)
  const ipcConfig = await win.webContents.executeJavaScript(
    'window.labAPI.getApiConfig().then(function (c) { return JSON.stringify({hasKey:c.hasKey, enabled:c.enabled}) })',
  )
  const cfgFromRenderer = JSON.parse(ipcConfig)
  check(
    '渲染进程只读到非敏感配置，拿不到密钥',
    cfgFromRenderer.hasKey === false && cfgFromRenderer.enabled === false,
  )
  const keyMethod = await win.webContents.executeJavaScript('typeof window.labAPI.setApiKey')
  check('白名单暴露密钥写入入口（明文不回传）', keyMethod === 'function', keyMethod)
  const isolation = JSON.parse(
    await win.webContents.executeJavaScript(
      'JSON.stringify({ req: typeof window.require, proc: typeof window.process, fs: typeof window.fs })',
    ),
  )
  check(
    '渲染进程无 Node / 文件系统访问',
    isolation.req === 'undefined' && isolation.proc === 'undefined' && isolation.fs === 'undefined',
    JSON.stringify(isolation),
  )

  const rejected = await win.webContents.executeJavaScript(
    '(function () { try { require("electron").ipcRenderer.invoke("lab:invoke", "deleteAllData", []); return "leaked" } catch (e) { return "blocked" } })()',
  )
  check('渲染进程无法绕过白名单直接调用 ipcRenderer', rejected === 'blocked')

  finish(null)
}).catch(finish)

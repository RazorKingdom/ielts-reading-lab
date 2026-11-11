# 测试体系说明 — IELTS Reading Lab

> 现行文档，2026-11-11。目标：任何人改动代码后，知道**跑什么、加什么测试**，让回归风险可见。

## 1. 四层测试总览

| 层 | 位置 | 环境 | 测什么 | 命令 |
|---|---|---|---|---|
| **单元测试** | `tests/unit/` | node | 纯函数与单个类的所有分支：hash、迁移题、状态机裁决、Validator、secureStore 异常路径、IPC 白名单 | `npm run test:unit` |
| **集成测试** | `tests/integration/` | node | 多模块协作的数据流：runtime dispatch 意图矩阵、费用闸门、store 持久化与导出、曝光记录 | `npm run test:integration` |
| **功能测试** | `tests/component/` | jsdom | 真实 DOM 事件 → 状态/API 调用：Reader 三键交互、Settings 费用闸门 UI | `npm run test:component` |
| **回归测试** | `tests/regression/` | node | 已修复 bug 的哨兵 + 黄金路径：span 截断、3,605 句解析完整、答案曝光归因、费用闸门 | `npm run test:regression` |

另有两类**历史保留**测试：

- `tests/*.test.ts`（根目录 9 个文件）：早期建立的核心算法测试（segment / validator / machine / runtime / apiProvider / dictionary / articleBank / explanations / benchmark）。它们仍全部运行，不要删除。
- `scripts/smoke-electron.cjs`：真实 Electron 环境下 52 项端到端自检（SQLite、IPC 白名单、preload 沙箱、React 渲染、字号 CSS 变量、密钥加密、文案哨兵）。运行 `npm run smoke`。

一次跑全部：

```bash
npm run test        # Vitest 全部（root + 四层）
npm run smoke       # Electron 端到端
npm run test:all    # 上面两条连跑
```

## 2. 关键约定

### 2.1 组件测试用 jsdom，其余用 node

组件测试文件第一行必须写：

```ts
// @vitest-environment jsdom
```

`tests/setup.ts` 提供统一的 DOM polyfill（`CSS.escape`、`caretRangeFromPoint`、`requestAnimationFrame`）与 `afterEach(cleanup)`，保证用例间 DOM 隔离。

### 2.2 mock 边界

- **组件测试必须 mock `src/backend.ts`**：它是模块顶层副作用（`export const api = getBackend()`），不 mock 会牵连 localStorage。
- **secureStore 测试只 mock `electron` 的 safeStorage**：用真实临时目录 + 真实 fs，通过 `vi.resetModules()` 拿到干净模块实例（该模块有 `cached` 模块级状态）。
- **runtime 集成测试用 `tests/helpers.ts` 的 `makeRuntime()`**：内存 store + 可 restart，无需真实数据库。

### 2.3 测试命名

- 单元测试：`unit: <模块> <行为>`，一个 `it` 只测一个分支。
- 集成测试：`integration: <流程> <场景>`。
- 功能测试：`component: <组件> <交互>`。
- 回归测试：`regression: <原始 bug 描述>`——**名字里要写清原来的症状**，例如 `span truncation ("...earliest f")`，这样未来看到失败就知道破坏了什么。

## 3. 三种鼠标交互的测试分工（重要）

这是当前最容易回归的区域，测试分层如下：

| 断言 | 在哪测 | 为什么 |
|---|---|---|
| 右键弹出语义悬浮窗、显示译文，**并标记答案已暴露** | `tests/component/Reader.interactions.test.tsx` 派发 `contextmenu`，断言 `markAnalysisViewed` 调用 1 次 | 右键语义与 L3 参考理解同源，必须计入曝光 |
| 右键同句二次查看走缓存，不重复请求 | 同上，断言 `getAnalysis` 只调用 1 次 | requestId 竞态守卫 + 缓存 |
| 中键 `button===1` 才弹三选菜单 | 同上，派发 `mousedown`（`button=0` 不弹、`button=1` 弹） | **真实 Chromium 中键走 `onMouseDown`，不是 `onAuxClick`** |
| 三个菜单项分别触发解析 / 训练 / 复测 | 同上，逐项 click 后断言 API 调用 | 行为级验证 |
| **真实中键按下能弹出三选菜单** | `npm run verify:middleclick`（`webContents.sendInputEvent`） | 组件层是 jsdom 合成事件，不能证明真机可用；见 §7 |
| 打包产物含新交互文案 | `scripts/smoke-electron.cjs` 字符串哨兵 | 仅防构建漏打包，不是行为测试 |

**不要把组件测试降级成字符串检查，也不要在 smoke 里重复搭复杂 UI 导航。**
**涉及非左键 / 拖选 / 滚轮的交互，jsdom 组件测试只能证明 React 逻辑层，必须配合 `verify:middleclick` 之类的真实输入验证。**

## 4. 每次改动的回归流程

1. **改前**：确认相关层已有测试。用 `grep -rn "<关键词>" tests/` 找。
2. **改时**：如果修复了一个 bug，在 `tests/regression/known-bugs.test.ts` 加一条哨兵，名字写原症状。
3. **改后**：

   ```bash
   npm run typecheck       # 类型
   npm run test:unit       # 纯逻辑分支
   npm run test:integration# 数据流
   npm run test:component  # UI 交互（改了 Reader/Settings 必跑）
   npm run test:regression # 历史 bug 哨兵
   npm run smoke           # Electron 端到端（改了构建/主进程必跑）
   ```

4. **提交前**：`git status` 确认无意外文件；密钥不得出现在任何测试快照中。

### 按改动类型选测试

| 你改了什么 | 必跑 |
|---|---|
| `src/core/*` 算法 | test:unit + test:integration + test:regression |
| `src/ui/Reader.tsx` | test:component（必）+ test:regression |
| `src/ui/Settings.tsx` | test:component |
| `electron/*` 或打包脚本 | test:unit（secureStore 部分）+ smoke + 手动启动验证 |
| `scripts/generate-article-bank.mjs` | test:regression + articleBank.test.ts（词数/ID/哈希护栏） |
| 文档 | 无；但同步更新数字与路径 |

## 5. 当前覆盖统计（2026-11-11）

- Vitest 总计：**203 项**（根目录历史测试 89 + unit 45 + integration 16 + component 26 + regression 27）
  - 注：根目录 89 项里有 20 项由 `benchmark.test.ts` 顶层循环动态生成，静态数 `it(` 会少算。用 `vitest --reporter=json` 统计才准确。
- Electron smoke：**54 项**（含错词本导航/双列/词义文案与 API 白名单哨兵）
- 真实输入验证：`npm run verify:middleclick`、`npm run verify:wrongwords`（见 §7），均已纳入 `npm run test:all`
- `npm run test:all` = vitest → smoke → 真机中键验证 → 真机错词本验证；三个入口都经过 `scripts/ensure-build.cjs` 的**产物新鲜度检查**（源码比 dist 新则自动重建），避免测到旧 bundle。
- 均未使用覆盖率工具；缺口由上文"四层总览"与代码评审确定。

## 7. 真实输入验证：不要只信 jsdom 的合成事件（重要教训）

`tests/component/Reader.interactions.test.tsx` 曾在 jsdom 里派发 `auxclick` 断言"中键菜单弹出"，全部通过——但**真实 Electron 里中键点击根本弹不出菜单**。原因是 jsdom 的 `dispatchEvent` 直接调用了 DOM 监听器，绕过了 Chromium 对中键的真实处理路径；组件测试因此产生了假阳性。

**结论：涉及鼠标按键（尤其非左键）、拖选、滚轮等浏览器原生行为的交互，jsdom 合成事件不足以证明真实可用。**

为此增加了真实输入验证：

```bash
npm run verify:middleclick
# 用 Electron 的 webContents.sendInputEvent 在真实渲染进程里派发 middle
# mousedown/mouseup，检查 .sentence-action-menu 是否出现、是否含三个菜单项、
# 事件序列里是否有 mousedown|1。结果写入
# scripts/verify-middleclick-result.json。
```

它发现了真实 bug：中键菜单原来绑在 `onAuxClick`，而真实中键在下层被 autoscroll 处理，`auxclick` 不稳定触发。现已改为 `onMouseDown` 监听 `e.button === 1` 并 `preventDefault()` 阻止自动滚动。

**验证工具自身也会假阳性（第二次教训）**：第一版脚本用 `querySelector('.sentence-menu')` 判定，而左键词卡与中键菜单共用这个 class；脚本又先派发了左键，中键完全失效时残留词卡仍会让 `menu:true`。现已改为：中键前用 Escape 清空 DOM 并断言 `.sentence-menu` 数量为 0；只认 `.sentence-action-menu`；检查菜单文本含三项与 `events` 含 `mousedown|1`；launcher 每次删除旧结果文件，条件不全即非零退出。

**因此新增强制要求：任何回归验证脚本上线前，必须做一次反向验证**——故意破坏被测逻辑，确认脚本 FAIL，再恢复确认 PASS。本次已对中键验证执行过（破坏后 `menu:false` → FAILED）。每次改 Reader 交互后应跑此脚本，再跑 smoke。

### 错词本端到端验证

```
npm run verify:wrongwords
# 真实左键点击句子 → 词卡出现「添加错词本」→ 点击按钮 → 经 preload 白名单
# IPC 落到真实 SQLite → 切到侧边栏「错词本」→ 检查双竖排两列 → 点击单词
# → 检查 .ww-meaning 真的显示释义。每次运行先清空独立 userData 目录，
# 避免上次的记录造成假阳性；同时断言点击前没有 .ww-meaning。
```

已做反向验证：把按钮 `onClick` 改成空函数后，`STORED []` → FAILED；恢复后 PASS。组件测试（`tests/component/WrongWords.test.tsx`）与真实 runtime 回归（`tests/regression/wrong-words.test.ts`）分别覆盖双列渲染/点击词义/移除/筛选，以及词形归并去重、重启持久化、删除、清空与导出。

## 6. 已知不测的内容（诚实边界）

- **真实模型诊断质量**：没有真实 API Key 的成功输出，无法做误判率/证据准确率评测（见 `DELIVERY.md` §8）。
- **真人 GUI 视觉验收**：自动化不截图比对像素；字号用 DOM 计算值验证，布局美观需人工看。
- **其他 UI 组件**：`Library` 只在 smoke 里随默认视图渲染、无任何断言；`Profile` / `Focus` / `App` / `ErrorBoundary` / `kit` 在自动化测试里**从未被渲染**。Settings 也只覆盖 4 条路径，`handleToggle` / `handleDelete` 等零覆盖。这是当前最大的覆盖缺口。
- **主进程真实 IPC handler**：smoke 自己注册 `ipcMain.handle`，不加载 `dist-electron/electron/main.js`，窗口安全策略与真实 handler 零覆盖。
- **performance / 长时间运行**：未做压力或内存泄漏测试。

# AMA 工作区

将 Arc 的部分工作流带到 Chrome 的扩展。Manifest V3、原生 JavaScript，无构建依赖、无账号；工作区数据保存在本地。

## 功能

- **Arc 风格侧栏**：工作区主题底色、紧凑标签行、文件夹与常用链接、底部工作区切换；支持浅色和深色。Chrome 固定标签显示为顶部图标网格。
- **网站图标**：标签、常用链接、归档、搜索和命令面板使用 Chrome 缓存中的 favicon；缺失或不支持的页面显示地球图标。
- **工作区**：新建、重命名、删除；以当前窗口的 Chrome 标签组管理页面。切换展开目标组、折叠其他 AMA 组，保留页面运行状态。
- **常用链接与文件夹**：保存当前页或输入网址；常用链接不参与自动归档。
- **搜索**：当前窗口标签、全部工作区常用链接和归档，支持标题、域名、文件夹和中文组合查询。
- **拖放分屏**：将 AMA 侧栏中的一个标签拖到另一个标签上，创建 Chrome 原生双页分屏。也可点击 `◫` 与当前标签分屏，点击 `◧` 取消分屏。两个标签须在同一窗口、同一标签组内且未固定；已分屏标签需先取消配对。
- **命令面板**：Mac 使用 `Cmd+Shift+K`，其他平台使用 `Ctrl+Shift+K`。搜索并切换标签、打开常用链接、切换工作区、恢复归档，输入网址或通过 Chrome 默认搜索引擎搜索。输入 `>` 筛选命令，例如 `> new tab`、`> save current`、`> settings`。
- **归档与恢复**：手动归档，自动归档默认关闭，开启后默认闲置 12 小时，每 5 分钟检查。先保存链接再关闭，跳过活跃、固定、音频、加载中和隐身标签。
- **工作区快照**：保存当前组的网址集合，恢复时只打开缺少的网页。
- **域名路由**：域名及其子域名匹配，新页面或导航时自动收入工作区。
- **备份**：JSON 导出和合并导入；同名工作区合并链接与快照，按网址去重，保留现有设置，不自动打开归档开关。
- **快捷键与轻量窗口**：`Alt+Shift+K` 打开侧栏；右键链接可保存到工作区或在独立弹窗打开。

工作区不隔离登录账号，不隐藏 Chrome 的所有原生控件。每个浏览器窗口有自己的标签组绑定。浏览器重启后，已保存链接和快照仍在；历史组不会仅凭过期 ID 自动接管，可重新收入标签或恢复快照。归档与快照只保存网址，不保存表单、滚动位置或页面内存。

网站内 Peek、持久 CSS Boosts、视频画中画、AI 服务和分屏布局快照尚未开发。当前快照仅保存网址，自动归档会跳过分屏中的标签。Chrome 原生垂直标签可独立使用。

## 安装

需要 Chrome 121 或更高版本；拖放分屏需要 Chrome 155+ 且对应 API 可用。用户的 Chrome 157 满足版本条件。

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目的 **extension** 目录。
4. 固定 AMA 扩展图标并点击，或按 `Alt+Shift+K` 打开侧栏。
5. 将鼠标移到“未收入工作区”的标签上，点击 `＋`，开始整理。自动归档需要到设置页手动开启。

若使用 ZIP，将 `dist/ama-0.4.0.zip` 解压后加载包含 `manifest.json` 的目录。扩展尚未发布到商店。更新已有安装时，在 `chrome://extensions` 点击 AMA 的重新加载按钮；此版本新增 `activeTab` 和 `scripting` 权限，如 Chrome 提示权限变更，请重新启用扩展。

命令面板优先显示为网页内的无外框浮层：圆角、柔和阴影、背景模糊，结果区域随内容收缩或展开。使用 ↑ / ↓ 选择、Enter 执行、Esc 或点击外部关闭；也可点击侧栏顶部的命令图标或“新建标签页”。在 `chrome://` 页面、扩展不允许注入的网站，或当前网页尚未获得临时访问权限时，使用独立弹窗作为回退，保留系统外框。普通网页上请优先用 `Cmd+Shift+K` / `Ctrl+Shift+K` 唤起，它同时授予当前页的临时访问权限。`Cmd+T` / `Ctrl+T` 仍打开 Chrome 新标签页。`Alt+Shift+K`（Mac 为 `Option+Shift+K`）继续打开侧栏搜索。快捷键冲突或没有自动分配时，在 `chrome://extensions/shortcuts` 设置 AMA 的“打开命令面板”。

## 开发与检查

需要 Node.js 22.8 或更高版本，打包需要 Python 3。无需 `npm install`。

```sh
npm test
npm run check
npm run test:browser
npm run test:native
npm run test:ui
npm run test:overlay
npm run package
```

`npm test` 验证真实数据逻辑与控制器，Chrome API 使用测试适配器。`npm run check` 检查 Manifest、资源引用和 JavaScript 语法。`npm run test:browser` 使用临时 Chrome 配置和 CDP 管道打开本地测试页面，检验真实 DOM 交互；Chrome API 使用相同测试适配器，因此不能替代真实扩展安装验证。可用 `CHROME_PATH` 指定 Chrome 可执行文件。

`npm run test:native` 在临时 Chrome 配置中加载真实未打包扩展，不使用 API 模拟。已在 Chrome 155.0.8059.84 验证安装、后台消息、原生分屏与取消分屏、命令面板窗口、快捷键注册、Enter 执行命令及窗口关闭。该测试要求支持 CDP `Extensions.loadUnpacked`，仅为临时测试配置开启扩展调试。真实 macOS 按键触发和物理鼠标拖放仍需在用户机器上验收。

浏览器 DOM 测试覆盖原有流程、拖放配对、工作区同步、命令面板键盘操作、中文输入法 Enter 保护及错误显示。截图位于 `/tmp/ama-panel-smoke.png` 和 `/tmp/ama-palette-native.png`。当前完整验证记录见 `docs/development-log.md`。

`npm run test:ui` 加载真实扩展并访问本地样例网站，检查 Chrome favicon 缓存中的实际像素、失败回退、固定标签点击、命令面板图标、工作区颜色切换、键盘操作和 280/320/360px 布局。浅色、深色和窄侧栏截图保存在 `dist/previews/`；其中的名称和网站图标是测试数据。首次访问样例页最多等待 30 秒，不依赖外部网站。

已修复：侧栏首次加载后聚焦搜索，后续快捷键仅聚焦对应窗口；后台错误即时显示，包括重复发生的相同错误；文件夹展开状态按工作区保留，在当前侧栏打开期间刷新列表或切换工作区都不会重置。

侧栏中的图钉用于保存常用链接；顶部图标网格对应 Chrome 原生固定标签。工作区快照和分屏说明收在“工作区工具”中。归档、设置和新增工作区入口在底部。键盘聚焦标签时也会显示操作按钮。

`npm run test:overlay` 验证页内浮层的尺寸收缩/恢复、键盘与外部点击关闭、焦点恢复、重复唤起、执行命令以及未授权页面拒绝。由于无界面 Chrome 的 CDP 工具栏动作不会授予 `activeTab`，测试仅在临时扩展副本中增加本地样例地址权限；正式扩展没有持久网站访问权限。真实 Mac 快捷键授权仍需手动验收。浮层预览在 `dist/previews/palette-overlay-light.png` 和 `palette-overlay-dark.png`。

## Git 状态

项目源码、测试和 `.gitignore` 已创建。此前 `.git` 只读导致初始化失败；2026-11-15 更新环境权限后，已成功执行 `git init -b main`，初始分支为 `main`；本轮 UI 调整位于用户选择的 `feat_style` 分支。

远程仓库为 [3toInf/ama](https://github.com/3toInf/ama)，`origin` 使用 `git@github.com:3toInf/ama.git`。`.gitignore` 排除 `.aws`、`.codex`、`.agents`、环境文件和构建产物。

## 文件结构

```text
extension/
  manifest.json      扩展权限与入口
  core.js            数据校验、搜索、归档条件、备份合并
  controller.js      串行状态更新与 Chrome 副作用
  background.js      生命周期、消息、定时任务与右键菜单
  split.js           原生分屏约束与操作
  split-drag.js      侧栏拖放交互
  palette-model.js   命令、搜索结果与网址输入判定
  palette-window.js  浮层优先、回退弹窗创建与会话校验
  palette-overlay.js 页内浮层、临时授权与生命周期
  palette.html/js/css 命令面板界面
  panel.html/js/css  中文侧栏界面
  theme.css          工作区主题、亮色和暗色变量
  icons.js           本地 SVG 控件图标与 Chrome favicon
tests/               数据与控制器测试、浏览器适配器
scripts/             检查、浏览器烟雾测试和 ZIP 打包
docs/                设计、计划与开发记录
```

## 权限与数据

扩展申请 `storage`、`tabs`、`tabGroups`、`sidePanel`、`alarms`、`contextMenus`、`search`、`favicon`、`activeTab`、`scripting`。它读取标签的标题和网址来提供管理功能，不读取网站 cookies、密码或正文，不申请全站脚本注入权限。只有执行网页搜索时，查询才通过 Chrome 发送至浏览器配置的搜索引擎。网站图标通过扩展自身的 `_favicon` 地址读取 Chrome 缓存，不使用第三方图标服务。无框浮层仅在唤起时注入，界面运行于独立的扩展来源 iframe，网页无法读取其中的搜索输入和结果；后台操作校验与当前标签绑定的临时会话。持久数据位于 `chrome.storage.local`，当前会话的窗口和组绑定位于 `chrome.storage.session`。卸载扩展会删除本地数据，请先导出需要保留的链接。

数据容量：最多 200 个工作区，每区 2000 条常用链接、每份快照 500 个网址，总计 2000 条归档、100 条域名规则。单份导入文件和全部持久数据的备份均最多 2 MB；每次写入前检查实际紧凑 JSON 的字节数，确保导出的备份符合导入文件上限。合并超过任一限制时整次拒绝，保留原数据，不静默截断。

背景分析：[Arc 核心特性与 Chrome 替代方案](https://chatgpt.com/space/page_820f3e5185b0819192636b6541f31869)。本仓库实现的是自研扩展，与文档中的第三方扩展安装方案不同。

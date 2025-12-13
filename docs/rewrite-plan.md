# Glance 文档概览

> 当前仓库已经完成一次彻底重写，本说明面向 `src/content` 与 `src/background` 中的现行实现，帮助快速理解拖拽即预览的工作方式。

## 功能快照
- **拖拽即预览**：`dragstart/dragover` 组合在 `src/content/dragDetector.ts` 中计算屏幕坐标距离，超过 `TRIGGER_DISTANCE_PX`（默认 60px）立即触发。
- **智能 URL 解析**：`src/content/utils/url.ts` 会依次尝试 `text/uri-list`、纯文本与最近的 `<a>` 标签，必要时自动补全 `https://`。
- **内联浮窗**：`PreviewPanel`（`src/content/previewPanel.ts`）将浮窗固定在右侧，支持 360~960px 宽度拖拽，鼠标进入时自动加蒙层，`Esc`/`×` 可关闭，`↗` 打开新标签。
- **跨域抓取与 CSP 清理**：内容脚本通过 `loadDocumentHtml` 调用后台 `FETCH_DOCUMENT`，由 Service Worker 负责抓取 HTML，并可选开启 `ADD_CSP_BYPASS` 移除目标站点的 CSP/X-Frame-Options 限制。
- **降级提醒**：若抓取失败或被用户中断，面板会展示错误文案并提示用新标签页继续。

## 模块拆解
### Content Script（`src/content/index.ts`）
1. 只在顶层文档运行，初始化 `PreviewPanel` 并注册键盘事件。
2. 调用 `initDragDetector` 监听拖拽，一旦满足阈值就调用 `panel.show` 并发起 `loadDocumentHtml`。
3. 通过 `AbortController` 对加载请求做生命周期管理；当新的拖拽发起或 `Esc` 被按下时立即中断旧请求。
4. 将加载结果写入 iframe 或显示错误，最终由 `panel.close` 负责清理 DOM 与 CSP 规则。

### Preview Panel（`src/content/previewPanel.ts`）
- 使用匿名自定义元素 + Shadow DOM 隔离样式，`mouseenter`/`mouseleave` 控制模糊遮罩；`pointerdown` 在自定义 resize handle 中触发展开。
- host 元素只暴露 `show`、`renderHtml`、`showError`、`close`、`openInNewTab`，其余状态全部保存在私有字段中，避免被页面脚本窥探。
- iframe 默认带 `sandbox` 与 `referrerPolicy = no-referrer`，一旦加载成功即切换 `data-state`，配合 CSS 渐变展示 loading bar。

### Document Loader（`src/content/documentLoader.ts`）
- **扩展环境**：通过 `chrome.runtime.sendMessage` 调用后台 `FETCH_DOCUMENT`，后者用 `fetch` 抓取并返回 HTML 正文及最终 URL。
- **独立环境**：在未注入扩展时（例如单元测试）直接 `fetch`，并设置 4s 超时以防拖慢页面。
- 所有 HTML 在写入 iframe 前都会注入 `<base>`，由 `computeBaseHref` 确保相对路径可正确解析。

### Background Service Worker（`src/background/index.ts`）
- 支持三类消息：`FETCH_DOCUMENT`（负责抓取 HTML 并返回文本）、`ADD_CSP_BYPASS`（基于 declarativeNetRequest 动态去掉 CSP/XFO）、`CLEAR_CSP_BYPASS`（移除当前 session 规则）。
- 为避免规则泄漏，所有新增 ruleId 都记录在 `activeRuleIds`，在 `CLEAR_CSP_BYPASS` 时统一清空。
- 抓取请求内置 10s 超时与 `redirect: 'follow'`，以接收最终页面并回传给内容脚本。

## 数据流与消息
1. **拖拽触发**：用户拖拽链接/文本 → `dragDetector` 计算距离 → `onTrigger` 收到 URL + 指针坐标。
2. **面板展示**：内容脚本调用 `panel.show` 立即把浮窗展示在右侧，同时启动 `loadDocumentHtml`。
3. **后台抓取**：内容脚本发送 `FETCH_DOCUMENT`，后台 `fetch` 成功后返回 `{ body, finalUrl }`，失败则返回错误信息。
4. **CSP 处理**：若 `panel.renderHtml` 需要真实 URL，先发送 `ADD_CSP_BYPASS` 在目标 origin 上移除 CSP/XFO，再将 iframe `src` 指向最终 URL；在 `panel.close` 中通过 `CLEAR_CSP_BYPASS` 清理。
5. **降级流程**：任何一步失败都会触发 `panel.showError`，用户可点击 `↗` 继续。

| 消息 | 发送方 → 接收方 | 负载 | 作用 |
| --- | --- | --- | --- |
| `FETCH_DOCUMENT` | content → background | `{ url, requestId }` | 后台抓取 HTML，并带回 `finalUrl`|
| `ADD_CSP_BYPASS` | content → background | `{ url }` | 为目标 origin 添加移除 CSP/XFO 的 DNR 规则 |
| `CLEAR_CSP_BYPASS` | content → background | 无 | 清除当前会话中缓存的所有规则 |

## 关键实现细节
- **只运行在顶层窗口**：`window.top === window` 的判断避免在嵌套 iframe 中重复注入浮窗。
- **Abort 控制**：内容脚本在每次新拖拽时都会 `abort` 旧 fetch，防止竞态导致错误内容残留。
- **宽度约束**：`PreviewPanel` 通过 `clamp` 限制最小/最大宽度，并在 `resize` 事件中重新计算高度，确保在小屏幕下仍可用。
- **安全默认值**：iframe 使用 `sandbox` + `no-referrer`，所有外部页面始终在受限上下文中渲染；只有在用户明确点击 `↗` 时才会在新标签中打开真实 URL。
- **无状态后台**：Service Worker 仅维护一个 `activeRuleIds` 数组，不在 storage 中写入任何内容，方便热重载与调试。

## 后续可扩展点
- 允许配置黑名单域名或拖拽距离（可写入 `chrome.storage.sync` 并在内容脚本初始化时读取）。
- 增加基础埋点或调试日志开关，方便排查被目标 CSP 拒绝的情况。
- 针对移动触摸板/触屏拖拽补充命中区域提示，避免误触。

如需进一步拆分，可在本文件基础上扩展为 `docs/architecture.md`, `docs/troubleshooting.md` 等，但旧版功能与收藏相关描述已全部移除。

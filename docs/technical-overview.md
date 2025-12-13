# Glance 技术简介

## 总览
- Manifest V3 浏览器扩展，入口由 `src/manifest.json` 定义：`background` Service Worker、`content` 脚本和 React 版 `options` 页面。
- 技术栈：TypeScript、RSBuild（基于 Rspack）打包、React 18 + SWR（选项页），内容解析依赖 Defuddle 与 Turndown。
- 构建脚本：`pnpm dev`/`pnpm build` 通过 `scripts/rsbuild-runner.mjs` 调用 `rsbuild.config.mjs`，输出到 `dist/js|css` 并复制静态资源/manifest。

## 运行时架构
- **Background (`src/background/index.ts`)**：接收 `FETCH_DOCUMENT` 消息代理跨域抓取 HTML，10s 超时；用 `chrome.declarativeNetRequest` 动态移除目标域的 CSP/X-Frame-Options 方便 iframe 预览；在关闭时清理规则。
- **Content (`src/content/index.ts`)**：页面 `document_end` 注入。监听拖拽距离（`dragDetector.ts`，默认 60px），抽取 URL 后展示预览面板并触发文档加载。
- **Preview Panel (`src/content/previewPanel.ts`)**：用自定义标签 + Shadow DOM 构建可拖拽/遮罩的浮窗；支持侧边/居中布局、宽度调整、ESC/点击外部关闭；在 iframe 载入完成后启动正文解析与总结。
- **Options 页面 (`src/options/index.tsx`)**：React UI 管理主题色、布局、同步开关、OpenAI 兼容模型配置与自定义 Prompt，实时存储并支持连通性测试。

## 关键流程
- **URL 提取**：`utils/url.ts` 处理 `text/uri-list`、`text/plain` 及拖拽目标的 `<a>` 元素，自动补全 `https://` 并校验 scheme。
- **文档加载**：`documentLoader.ts` 在扩展环境下走背景页 fetch，或回退直接 fetch；统一追加 `<base>` 以修复资源相对路径。AbortSignal 与超时合并避免悬挂请求。
- **CSP 处理**：在渲染前向 Background 发送 `ADD_CSP_BYPASS`，允许 iframe 载入更多站点；关闭时发送 `CLEAR_CSP_BYPASS`。
- **总结生成**：`markdownExtractor.ts` 用 DOMParser + Defuddle 提取正文，再用 Turndown 转 Markdown。解析过程可被 AbortSignal 取消，超时 8s；状态通过 `PreviewPanel` 的 `data-summary-state` 驱动 UI。

## 配置与存储
- `src/shared/settings.ts` 封装读取/写入逻辑，优先使用 `chrome.storage.sync`，失败时降级 `local`；提供 `watchSettings` 监听跨标签变更。
- 模型配置（Provider/Base URL/Model 名、自定义 Prompt）与 API Key 分离存储，支持 `openai`、`deepseek`、`custom` 预设，`testModelConnection` 调用 `/models` 端点验证。

## 目录速览
- `src/background`：Service Worker 消息与 DNR 规则管理。
- `src/content`：拖拽检测、文档抓取、预览面板、正文提取。
- `src/options`：选项页 React 入口与模板。
- `src/shared`：消息常量、设置与存储工具。

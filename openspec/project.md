# Project Context

## Purpose
Glance 是一个 Manifest V3 浏览器扩展：在网页上拖拽链接、图片或文本时，直接在当前页右侧弹出可移动的预览浮窗，并尝试生成简要总结，减少跳转和新标签切换。

## Tech Stack
- TypeScript + ESM；bundler 使用 RSBuild（基于 Rspack），入口为 background/content/options。
- React 18 + SWR 构建 Options 页面；内容脚本与背景服务均为原生 DOM/Chrome API。
- 内容解析依赖 Defuddle（正文提取）与 Turndown（HTML → Markdown），目前总结仍是本地解析，无模型推理调用。
- Chrome/Edge/Firefox MV3 API：`chrome.runtime` 消息、`declarativeNetRequest`、`storage`。

## Project Conventions

### Code Style
- 统一使用 TypeScript，模块为 ESM；尽量保持无副作用的纯函数，必要时添加简短注释解释复杂逻辑。
- 颜色/布局等 UI 配置走用户设置（`src/shared/settings.ts`），面板样式封装在 `previewPanel` 内部。

### Architecture Patterns
- Background Service Worker 负责跨域抓取 HTML 与动态 CSP 头移除；内容脚本处理拖拽检测、预览面板、总结解析。
- 设置与模型配置通过 `chrome.storage` 同步/本地存储，API Key 仅写入 `storage.local`。

### Testing Strategy
- 目前无自动化测试，依赖手动场景验证（拖拽预览、Options 设置保存/同步、CSP 规则清理、总结解析超时）。

### Git Workflow
- 无强制分支策略记录；遵循常规 feature 分支 + PR 方式，避免强制 push/rebase 覆盖他人工作。

## Domain Context
- 预览面板在 `document_end` 注入，默认宽 500px、占视口 90% 高度；支持侧边/居中布局与拖拽调整宽度。
- 默认 summary 需要模型配置标记为 ready 才会运行，否则在面板展示「前往模型设置」引导。

## Important Constraints
- 解析与渲染运行在内容脚本内，需避免长阻塞；超时与 AbortSignal 必须正确处理。
- CSP/X-Frame-Options 通过 DNR 临时移除，关闭预览后要清理规则以降低风险。

## External Dependencies
- 外部 API 仅用于「测试模型连通性」：调用 `${baseUrl}/models`，需要用户输入的 OpenAI 兼容 API Key。

## 1. 实现步骤
- [x] 1.1 引入 `defuddle.js` 并封装一个从 `Document`/HTML 字符串生成 Markdown 的工具，支持超时/取消与错误兜底。
- [x] 1.2 更新 `PreviewPanel` 的模板与样式，新增底部总结区域以及 Loading / Error 呈现。
- [x] 1.3 在 iframe 加载完成后触发解析流程，处理并发请求、状态重置和异常提示，确保只展示当前请求的 Markdown。

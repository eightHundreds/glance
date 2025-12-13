# preview-pages Specification

## Purpose
定义 Preview Panel 在预览弹窗底部展示解析后 Markdown 文本的行为、触发条件与解析准则，确保当前实现与未来改动保持一致。
## Requirements
### Requirement: Preview Summary Section
预览面板底部 MUST 展示一个总结区域，用于呈现解析后的 Markdown 字符串（作为纯文本展示，保持滚动与状态提示）。

#### Scenario: Display parsed markdown
- **GIVEN** 用户在页面上触发预览面板
- **AND** 对应 iframe 的页面内容解析成功
- **WHEN** Markdown 结果返回
- **THEN** 预览面板底部出现一个带标题的总结区域
- **AND** 区域内以等宽字体、保留换行的方式展示 Markdown 文本（不做 Markdown → HTML 渲染）
- **AND** 区域可滚动，不会影响上方 iframe 的交互

#### Scenario: Reset summary between requests
- **GIVEN** 预览面板已经展示过某个页面的总结
- **WHEN** 用户触发另一个页面的预览
- **THEN** 旧的总结内容立即被清空并切换为加载状态
- **AND** 新的请求完成后再展示新的 Markdown 或错误提示

#### Scenario: Block when model config is incomplete
- **GIVEN** 模型配置状态 `ready=false`（缺少 API Key/Base URL/模型名）
- **WHEN** 用户触发预览
- **THEN** 总结区域保持「未配置模型」/「前往模型设置」引导，不启动解析流程
- **AND** 配置补全后再次触发预览才会进入加载与解析状态

### Requirement: HTML Fetch and Markdown Extraction
系统 MUST 在 iframe 页面完成加载后，使用预先抓取的 HTML 调用 Defuddle/Turndown 提取 Markdown，并在异常时给出提示。

#### Scenario: Parse after iframe ready
- **GIVEN** 预览 iframe 正在加载目标页面
- **WHEN** iframe 触发 `load` 事件并且仍是当前激活的请求
- **THEN** 扩展对先前抓取并注入 `<base>` 的 HTML 文本运行 DOMParser + Defuddle，再用 Turndown 生成 Markdown
- **AND** 解析完成后将最新 Markdown 写入总结区域（仍需确认请求未被新预览替换）
- **AND** 如果 iframe 已被新的请求替换，则丢弃解析结果

#### Scenario: Handle parsing failures
- **GIVEN** 解析流程因为超时、Abort、或 Defuddle/Turndown 异常而失败
- **WHEN** 当前请求仍然有效
- **THEN** 总结区域展示一条错误提示，引导用户在新标签页查看完整页面
- **AND** 保持面板可继续交互，不影响 iframe 的使用

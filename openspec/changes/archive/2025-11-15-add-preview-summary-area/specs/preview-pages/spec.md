## ADDED Requirements
### Requirement: Preview Summary Section
预览面板底部 MUST 展示一个总结区域，用于呈现解析后的 Markdown。

#### Scenario: Display parsed markdown
- **GIVEN** 用户在页面上触发预览面板
- **AND** 对应 iframe 的页面内容解析成功
- **WHEN** Markdown 结果返回
- **THEN** 预览面板底部出现一个带标题的总结区域
- **AND** 区域内展示 Markdown 文本（支持基本段落与列表渲染）
- **AND** 区域可滚动，不会影响上方 iframe 的交互

#### Scenario: Reset summary between requests
- **GIVEN** 预览面板已经展示过某个页面的总结
- **WHEN** 用户触发另一个页面的预览
- **THEN** 旧的总结内容立即被清空
- **AND** 新的总结区域切换为加载状态，直到新的 Markdown 结果可用或失败

### Requirement: Defuddle Markdown Extraction
系统 MUST 在 iframe 页面完成加载后使用 `defuddle.js` 解析 DOM，得到 Markdown 文本，并在异常时给出提示。

#### Scenario: Parse after iframe ready
- **GIVEN** 预览 iframe 正在加载目标页面
- **WHEN** iframe 触发 `load` 事件并且仍是当前激活的请求
- **THEN** 扩展开始调用 `defuddle.js` 解析 iframe DOM
- **AND** 解析完成后将最新 Markdown 写入总结区域
- **AND** 如果 iframe 已被新的请求替换，则丢弃解析结果

#### Scenario: Handle parsing failures
- **GIVEN** 解析流程因为跨域、超时或 `defuddle` 异常而失败
- **WHEN** 当前请求仍然有效
- **THEN** 总结区域展示一条错误提示，引导用户在新标签页查看完整页面
- **AND** 保持面板可继续交互，不影响 iframe 的使用

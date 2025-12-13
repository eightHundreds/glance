## ADDED Requirements

### Requirement: Custom Summary Prompt
Options 页面 MUST 允许用户在「大模型设置」区域配置一段 summary system prompt，并由模型请求自动引用。

#### Scenario: Prompt editable with default
- **GIVEN** 用户打开 Options 页且已加载模型配置
- **THEN** 在同一区域看到多行的「总结 Prompt」输入框，预填系统默认文案
- **WHEN** 用户修改并离开输入框
- **THEN** 新 prompt 立即保存并在刷新页面后保持不变

#### Scenario: Enforce length and reset to default
- **GIVEN** 用户删除 prompt 或输入超过上限（例如 1000 字符）
- **THEN** UI MUST 提示错误或自动回退，保存层保存的值要么是默认 prompt，要么是裁剪后的有效内容
- **AND** 用户可以通过「恢复默认」操作快速填入系统提供的模版

#### Scenario: Summary requests use configured prompt
- **GIVEN** 模型配置区已经保存了一段 prompt（或为空时回退默认）
- **WHEN** 内容脚本发送第一条总结请求
- **THEN** system message 中包含最新的 prompt 文案
- **AND** 调试日志能区分「自定义 vs 默认」，以便排查

## ADDED Requirements

### Requirement: 模型供应商配置 UI
Options 页面 MUST 暴露一个「大模型设置」区域，允许在扩展初始化前配置 summary 要使用的 OpenAI 兼容模型供应商与基础参数。

#### Scenario: Provider selection persists
- **GIVEN** 用户打开 Options 页
- **WHEN** 在「大模型设置」中选择 OpenAI 或任意 OpenAI 兼容 API（如 DeepSeek、自托管兼容层等）的一项
- **THEN** 被选中的供应商、展示名称与默认模型会立即保存，并在刷新页面或重新打开扩展后保持一致
- **AND** 切换供应商时需要显示该供应商所需字段（例如自托管服务需要自定义 Base URL 与模型 ID）

#### Scenario: Provider specific fields and help text
- **GIVEN** 供应商切换为需要额外参数（如 DeepSeek 或自托管实例需要自定义 endpoint)
- **THEN** UI MUST 展示对应输入框与错误提示（必填/格式校验）
- **AND** 每个输入框下方提供最少一行说明，指导用户到官方后台获取信息

### Requirement: 凭据存储与连通性验证
模型凭据（API Key 等）MUST 遵循「仅本地存储」策略，并提供显式的连通性测试能力以确保首次 summary 提问不会中断。

#### Scenario: API key stored locally only
- **WHEN** 用户填写/更新 API Key 并点击保存
- **THEN** Key 只能写入 `chrome.storage.local`（或等效浏览器本地存储），不得进入 `chrome.storage.sync`
- **AND** 保存成功后 UI 只显示「已设置」状态，而不回显真实 Key；重新打开 Options 仍能看到供应商选择但需要用户再次点击「更新 Key」才能替换

#### Scenario: Connection test feedback
- **GIVEN** 已填写完供应商所需所有字段
- **WHEN** 用户点击「测试连通性」
- **THEN** 扩展 MUST 发起一次最小化的 API 请求（如 `GET /models` 或自定义 ping）
- **AND** 请求成功时在 UI 中显示成功提示并标记设置为可用；失败时提供可读错误（含 HTTP 状态/消息）且阻止将失败的 Key 标记为可用

### Requirement: Summary 初始化检查
页面总结流程 MUST 在用户首次提问前就绪已配置的模型信息，并在缺失配置时阻止提问并提供入口。

#### Scenario: Block summary when model missing
- **GIVEN** 用户触发预览面板 summary 且尚未配置任意模型供应商或 API Key
- **THEN** summary 区域显示「尚未配置模型」状态，包含前往 Options 页的 CTA；提示信息需要解释为什么不能发起请求
- **AND** 在配置完成前，summary 的提问输入框或触发按钮必须禁用

#### Scenario: Auto use configured provider on first request
- **GIVEN** 用户已经配置有效的供应商、Key 与必要参数
- **WHEN** 页面 summary 需要发送第一条模型请求
- **THEN** 内容脚本/后台 MUST 自动读取已保存的供应商与凭据，构建 API 请求并附带在第一条消息中
- **AND** 整个流程不得再弹出额外对话框确认供应商；如请求失败，应复用连通性错误提示机制

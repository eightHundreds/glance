# settings Specification

## Purpose
定义 Glance 用户设置在不同浏览器中的同步策略与 Options 页面呈现规则，保证跨设备体验一致。
## Requirements
### Requirement: 浏览器同步能力检测
扩展在启动时 MUST 主动检测宿主提供的同步能力，再决定读写策略。

#### Scenario: Chrome/Edge sync 可用
- **GIVEN** `chrome.storage` 存在且包含 `sync`，并且没有 `chrome.runtime.lastError`
- **THEN** 设置读写请求必须使用 `chrome.storage.sync`
- **AND** 同步失败时需要自动回退至 `chrome.storage.local`

#### Scenario: Firefox sync 可用
- **GIVEN** `browser.storage.sync` 可用
- **THEN** 需要通过 `browser.storage.sync` 读写配置
- **AND** 当 sync 不可用或被禁用时，回退至 `browser.storage.local` 或 `window.localStorage`

#### Scenario: 不支持同步
- **GIVEN** 环境既没有 `chrome.storage.sync` 也没有 `browser.storage.sync`
- **THEN** 所有读写必须直接落到本地（`chrome.storage.local`/`window.localStorage`）
- **AND** 提示层需要将「未同步，仅本地保存」状态提供给前端

### Requirement: 同步开关与状态
系统 MUST 新增一个布尔配置控制是否启用同步，默认开启（在支持环境下）。

#### Scenario: 用户关闭同步
- **WHEN** 用户在配置页关闭同步
- **THEN** 之后的设置写入必须强制使用本地存储
- **AND** 同步状态文案显示「仅本地保存」

#### Scenario: 用户开启同步
- **WHEN** 用户开启同步且宿主支持
- **THEN** 需要将最近一次保存结果（成功/失败）暴露给 UI
- **AND** 若写入失败，前端获得具体错误消息用于提示或重试

### Requirement: Options 页面同步配置
Options 页 MUST 包含独立的同步区域，描述当前状态与支持情况。

#### Scenario: 支持同步的浏览器
- **GIVEN** 检测到 sync 能力
- **THEN** UI 需展示同步已开启/关闭的切换开关
- **AND** 展示最近一次同步说明（成功时间戳或失败原因）

#### Scenario: 不支持同步
- **GIVEN** 宿主不支持同步
- **THEN** UI 显示警示文案提示仅本地保存
- **AND** 同步开关需禁用或隐藏，避免误导

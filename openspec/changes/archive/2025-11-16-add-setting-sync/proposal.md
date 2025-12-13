# Proposal: add-setting-sync

## 背景
当前设置保存逻辑仅依赖 `chrome.storage.sync` 是否存在来决定是否同步，但：
- Firefox 只有 `browser.storage.sync` 并且 API 行为略有差异；
- Edge/Chrome 需要在宿主允许同步后才会成功保存，否则会静默失败；
- Options 页面没有任何「同步」配置或状态提示，用户无法确认是否跨设备共享。

## 目标
1. 抽象设置存储层，优先启用浏览器提供的同步能力（Chrome/Edge `chrome.storage.sync`、Firefox `browser.storage.sync`），在不可用或用户关闭时回退到 `chrome.storage.local`/`localStorage`。
2. 自动检测宿主环境的同步支持与当前状态，提供可重试的读取/写入结果提示。
3. 在配置页新增「同步设置」区域：展示支持情况、允许用户切换是否启用同步、显示最近一次同步/失败状态。

## 非目标
- 扩展同步范围到插件以外的任何数据。
- 解决浏览器账户层面的同步失败问题（如 Google/Microsoft 登录状态）。

## 成功衡量
- 在支持 sync 的浏览器中切换设置后，另一台已登录同一账号的设备能收到变更；
- 不支持或被禁用 sync 的浏览器上，不会抛错，并清楚提示只保存到本地；
- Options 页能反映当前同步状态，供用户手动切换启用/禁用。

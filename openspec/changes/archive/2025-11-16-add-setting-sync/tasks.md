## 1. 实现
- [x] 1.1 创建同步能力检测与抽象：封装 `chrome.storage` / `browser.storage` 的 sync/local 选择、回退逻辑与错误上报。
- [x] 1.2 在设置读写流程中接入同步开关（支持禁用 sync 时强制使用本地存储），并暴露当前同步状态给前端。
- [x] 1.3 在 options 页面新增同步配置区域：显示支持情况、提供开关、展示最近一次同步状态，并与新 API 对接。

## 2. 验证
- [x] 2.1 在支持 sync 的浏览器（Chrome/Edge 或模拟环境）中手动验证跨设备同步与禁用时的本地存储回退。（暂以单机环境模拟 chrome.sync/local 行为完成验证）
- [x] 2.2 在不支持 sync 的环境（Firefox 无 sync 权限或普通网页）中验证 UI 提示与设置保存正常。（通过 storage mock 验证，无真实浏览器）

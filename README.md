# Glance

一个极简的浏览器扩展：把链接、图片或文本拖动一小段距离，就会在当前页面内注入一个可移动的浮动窗口进行快速预览（避免新建浏览器窗口，在 Arc 等魔改浏览器中也能稳定工作）。

## 功能

- **拖拽即预览**：拖动链接 / 文本 / 图片超过约 60 像素，就会在页面上弹出浮动面板展示内容。
- **智能 URL 解析**：支持 `text/uri-list`、纯文本链接及拖拽选区，必要时自动补全 `https://`。
- **内联浮窗**：预览面板固定在浏览器右侧，默认 500px 宽、占视口 90% 高度（垂直居中），支持左右拖拽调节宽度；鼠标悬停面板时背景自动加蒙层，`ESC` 或 `×` 即可关闭。
- **HTML 重绘**：背景 Service Worker 负责跨域抓取原页面 HTML（注入 `<base>` 后通过 iframe `srcdoc` 渲染），最大限度规避 `X-Frame-Options` 限制；如抓取失败，会提示并提供「新标签页」降级。

## 开发

```bash
pnpm install
pnpm dev   # 开发模式，写入 dist
pnpm build # 生产构建
```

构建完成后，在 `chrome://extensions`（或 `edge://extensions`）开启开发者模式，加载 `dist` 目录即可调试。Firefox 可通过 `about:debugging#/runtime/this-firefox` 以临时附加组件方式加载 `dist/manifest.json`。

## 调试提示

- **Background（Service Worker）**：在扩展详情页点开"Service Worker"调试，查看窗口管理日志或设置断点。
- **Content Script**：在任意页面 `F12` → Sources 面板中找到 `src/content/index.ts`，可以追踪 drop zone 的事件处理。
- 已启用 `source-map`，调试时直接定位 TypeScript 源文件。

## 使用说明

1. 在任意页面拖动链接、图片或选中的文本。
2. 当拖拽距离超过约 60 像素时松手即可触发预览。
3. 扩展会在当前页面靠近释放点的位置插入一个浮动面板展示目标页面。
4. 点击面板右上角的 `×` 或按下 `Esc` 键即可关闭，也可以点 `↗` 在新标签页打开当前预览。

## 许可证

本项目采用 [MPL 2.0](LICENSE) 协议，欢迎自由使用与贡献。

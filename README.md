# Theme-Package-Editor

基于 `theme-package-editor.html` 的手机主题包编辑工具，现已补充 Tauri 打包能力，可直接生成 macOS 桌面应用。

## 本地开发

```bash
npm install
npm run dev
```

## 打包 macOS 应用

生成 Intel + Apple Silicon 通用的 `.app` 与 `.dmg`：

```bash
npm run build:mac
```

输出位置：

- `../build/Theme Package Editor.app`
- `../build/*.dmg`

仅生成通用 `.app`：

```bash
npm run build:mac:app
```

## 说明

- 页面功能与 `theme-package-editor.html` 保持一致
- 桌面端导出会调用 macOS 原生“保存”对话框
- 前端静态资源会先构建到 `dist/`，再由 Tauri 打包
- 打包完成后，最终交付物会自动整理到项目外层的 `build/` 文件夹
- `build:mac` 使用 `universal-apple-darwin` 目标，输出同时兼容 Intel 与 Apple Silicon 的通用包

## 开发规则

- 后续任何新增需求、功能调整或交互修改，都必须同时检查并同步更新 `theme-package-editor.html` 独立页面侧与应用侧实现
- 应用侧同步范围包括但不限于：`package.json`、`scripts/`、`src-tauri/`、打包脚本、产物收集逻辑及相关文档
- 目标是保证浏览器独立页面版本与 macOS 应用版本在功能、行为和交付方式上保持一致，避免只改一侧导致能力偏差

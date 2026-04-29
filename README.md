# Theme-Package-Editor

基于 `theme-package-editor.html` 的手机主题包编辑工具，现已补充 Tauri 打包能力，可直接生成 macOS 桌面应用。

## 本地开发

```bash
npm install
npm run dev
```

## 打包 macOS 应用

生成 `.app` 与 `.dmg`：

```bash
npm run build:mac
```

输出位置：

- `src-tauri/target/release/bundle/macos/Theme Package Editor.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`

仅生成 `.app`：

```bash
npm run build:mac:app
```

## 说明

- 页面功能与 `theme-package-editor.html` 保持一致
- 桌面端导出会调用 macOS 原生“保存”对话框
- 前端静态资源会先构建到 `dist/`，再由 Tauri 打包

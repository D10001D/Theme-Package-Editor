# Theme-Package-Editor

基于 `frontend/` 前端源码目录的手机主题包编辑工具，现已补充 Tauri 打包能力，可直接生成 macOS 桌面应用。

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

- 前端源码位于 `frontend/`，拆分为 `index.html`、`styles.css`、`app.js`
- 桌面端导出会调用 macOS 原生“保存”对话框
- 应用侧代码位于 `src-tauri/`，由 Tauri 消费 `dist/` 进行打包

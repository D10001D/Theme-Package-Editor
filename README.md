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

## 换电脑后继续用 Codex 开发

### 1. 拉取代码

如果需要继续当前桌面应用开发分支，优先切到对应分支：

```bash
git clone git@github.com:D10001D/Theme-Package-Editor.git
cd Theme-Package-Editor
git checkout codex/tauri-macos-app
```

如果该分支后续已经合并到 `main`，则直接切到 `main` 即可。

### 2. 准备本地环境

新电脑需要提前安装：

- Node.js / npm
- Rust / Cargo
- Xcode 或 Xcode Command Line Tools

进入项目目录后执行：

```bash
npm install
```

### 3. 在 Codex 中打开项目

建议在 Codex 中直接打开项目目录：

```text
Theme-Package-Editor/Theme-Package-Editor
```

首次进入新电脑上的 Codex 会话时，建议先明确要求它阅读项目上下文，例如：

```text
先阅读 README.md、theme-package-editor.html、package.json、scripts/、src-tauri/，理解当前项目结构和开发规则，再继续开发。
```

如需继续功能开发，建议同时强调项目规则：

```text
当前项目要求：HTML独立页面侧和应用侧必须同步调整。请按这个规则继续开发。
```

### 4. 常用命令

```bash
npm run dev
npm run build:mac:app
npm run build:mac
```

说明：

- `npm run dev`：启动本地开发模式
- `npm run build:mac:app`：生成通用 `.app`
- `npm run build:mac`：生成通用 `.app` 和 `.dmg`
- 最终交付产物会整理到项目外层的 `../build/` 文件夹

### 5. 建议优先阅读的文件

为保证 Codex 在新电脑上快速接续上下文，建议优先让它读取以下文件：

- `README.md`
- `theme-package-editor.html`
- `package.json`
- `Theme-Package-Editor-产品功能说明.md`
- `scripts/`
- `src-tauri/`

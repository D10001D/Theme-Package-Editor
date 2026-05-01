# Theme-Package-Editor

基于 `frontend/` 前端源码目录的手机主题包编辑工具，现已补充 Tauri 打包能力，可直接生成 macOS 桌面应用。

## 当前能力

- 支持导入 `.itz`、`.mtz`、`.zip` 主题包
- 支持导入普通文件夹作为主题工程
- 支持浏览主题结构、搜索文件、展开或收起目录
- 支持编辑 `xml`、`plist`、`json`、`css`、`html`、`js`、`txt` 等文本文件
- 支持图片预览、二进制文件替换、文件或文件夹新增、重命名、单项删除、批量删除
- 支持文本格式化、`Ctrl/Cmd + /` 注释、未保存内容切换提醒
- 支持“保存回当前来源”和“导出为新主题包”两种结果处理方式
- 右侧会展示保存或导出成功状态，左侧会显示最近保存或导出记录
- 常见完成型操作会提供轻量 toast 反馈

## 环境与依赖

### 系统环境

- Node.js `18+`（建议搭配当前稳定版 npm）
- Rust 工具链（`rustup` / `cargo`）
- macOS 打包环境：Xcode Command Line Tools

可先执行：

```bash
xcode-select --install
rustup default stable
```

### npm 依赖

项目依赖统一通过下面命令安装：

```bash
npm install
```

当前会安装这些前端 / Tauri 侧依赖：

- `@tauri-apps/cli`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-fs`
- `codemirror`
- `jszip`
- `js-beautify`

### Rust / Tauri 依赖

桌面端构建还会通过 `Cargo` 自动解析 `src-tauri/` 下的依赖，包括：

- `tauri`
- `tauri-build`
- `tauri-plugin-dialog`
- `tauri-plugin-fs`

## 首次启动流程

### 1. 安装系统环境

```bash
xcode-select --install
rustup default stable
```

确认版本：

```bash
node -v
npm -v
rustc -V
cargo -V
```

### 2. 安装项目依赖

在项目根目录执行：

```bash
npm install
```

### 3. 启动本地开发

```bash
npm run dev
```

说明：

- 会先执行 `npm run build:web`
- 然后由 Tauri 启动桌面开发环境

### 4. 打包 macOS 应用

生成 `.app` 与 `.dmg`：

```bash
npm run build:mac
```

仅生成 `.app`：

```bash
npm run build:mac:app
```

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
- `scripts/build-web.mjs` 会将 `frontend/` 同步到 `dist/`，Tauri 打包消费的是 `dist/`
- 桌面端导入和导出会调用系统原生文件或文件夹选择器
- 桌面端支持直接保存回当前导入的主题包或文件夹
- 浏览器环境下是否支持直接保存回原位置，取决于浏览器是否支持 File System Access API
- 应用侧代码位于 `src-tauri/`

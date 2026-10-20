# Theme-Package-Editor

基于 `frontend/` 前端源码目录的手机主题包编辑工具，现已补充 Tauri 打包能力，可直接生成 macOS 桌面应用。

## 当前能力

- 支持导入 `.itz`、`.mtz`、`.zip`、`.theme` 主题包
- 支持导入普通文件夹作为主题工程
- 支持浏览主题结构、搜索文件、展开或收起目录
- 支持编辑 `xml`、`plist`、`json`、`css`、`html`、`js`、`txt` 等文本文件
- 支持图片预览、二进制文件替换、文件或文件夹新增、重命名、单项删除、批量删除
- macOS 桌面端“新增文件”支持在同一选择器中多选文件和文件夹，保留子目录与空文件夹；同名文件夹合并，同名文件确认后覆盖
- 新增文件会写入当前选中的文件夹；如果当前选中的是文件，则写入该文件所在的父文件夹
- 支持在主题包内的无后缀内部压缩包目录中新增文件，并保持完整父级路径
- 支持文本格式化、`Ctrl/Cmd + /` 注释、未保存内容切换提醒
- 支持“保存回当前来源”和“导出为新主题包”两种结果处理方式
- 右侧会展示保存或导出成功状态，左侧会显示最近保存或导出记录
- 常见完成型操作会提供轻量 toast 反馈

## 新增文件与文件夹

macOS 桌面端操作流程：

1. 导入主题包或主题工程文件夹，在文件树中选中目标目录。
2. 点击右上角“新增文件”，在同一个原生选择窗口中选择文件、文件夹，或多选两种类型。
3. 文件夹会连同自身名称、所有层级的子目录和文件一起加入目标目录，保留空文件夹；递归没有人为层数限制。例如选中 `icons` 后添加 `assets` 文件夹，其中的 `images/dark/logo.png` 会写入 `icons/assets/images/dark/logo.png`。
4. 同名文件夹会合并；同名文件会统一询问是否覆盖。取消覆盖或发现文件与目录的类型冲突时，本批次不写入工程。
5. 导入的目录会展开。添加完成后，点击“保存”写回当前来源，或点击“导出”生成新主题包。

递归读取文件夹时跳过 macOS 元数据 `.DS_Store`、`._*` 和 `__MACOSX`；过滤后为空的目录仍会保留。该过滤也适用于将普通文件夹导入为主题工程。

“新增文本”用于创建空白文本文件，“新增文件夹”用于创建空目录；导入电脑上已有的整个文件夹使用“新增文件”。文件和文件夹混合选择目前仅在 macOS 桌面端实现，浏览器端仍使用文件选择器。

### 本次修复与验证（2026-10-20）

- 接入 macOS 原生混合选择面板，仅为所选文件和文件夹授予文件系统路径访问范围，并补齐 `fs:allow-read-dir` 命令权限。
- 在读取前过滤 macOS 元数据，避免 `.DS_Store` 的路径权限错误中断整批导入。
- 修复删除目录后重新添加同名目录时，子文件写入旧的已删除节点而不可见的问题；路径查找与目录创建均忽略已删除节点。
- 显式记录递归读取的每一级目录，并在添加后展开目录。
- 回归验证覆盖嵌套目录与空目录、取消覆盖、路径冲突、目录合并、文件覆盖及元数据过滤；使用真实创建的 12 层目录验证导入、删除后同名目录复用及 ZIP 导出后的文件内容完整性。原生选择窗口仍需手动验证。

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
- macOS 原生选择器使用 `objc2`、`objc2-app-kit` 和 `objc2-foundation`

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

## 回归测试

在项目根目录执行：

```bash
node --test tests/*.test.cjs
```

测试使用临时目录创建多层文件夹，验证完成后自动清理；不会修改现有主题工程。

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
- `.theme` 文件按 ZIP 结构解析，适用于 OPPO 平台主题包
- 浏览器环境下是否支持直接保存回原位置，取决于浏览器是否支持 File System Access API
- 应用侧代码位于 `src-tauri/`

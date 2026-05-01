const THEME_STORAGE_KEY = "theme-package-editor-theme";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const TEXT_EXT = /\.(txt|xml|json|ini|cfg|conf|css|html|js|md|csv|properties|theme|manifest|plist)$/i;
const IMG_EXT = /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i;
const XML_EXT = /\.xml$/i;
const HTML_EXT = /\.html?$/i;
const JSON_EXT = /\.json$/i;
const JS_EXT = /\.js$/i;
const CSS_EXT = /\.css$/i;
const MARKDOWN_EXT = /\.md$/i;
const PROPERTIES_EXT = /\.(ini|cfg|conf|properties)$/i;
const PLIST_EXT = /\.plist$/i;
const XML_COMPLETION_TRIGGER = new Set(["<", "/", " ", "=", "\"", "'"]);
const XML_COMMON_ATTRS = ["id", "name", "type", "path", "value", "src", "width", "height", "color"];

let rootZip = null;
let rootNode = null;
let flatFiles = [];
let selected = null;
let multiSelectedPaths = new Set();
let visibleNodeOrder = [];
let lastClickedPath = null;
let originalBaseName = "theme";
let originalExt = ".itz";
let originalFullName = "theme.itz";
let activeTextEditor = null;
let activeEditorNodePath = null;
let activeEditorSavedText = "";
let activeEditorDirty = false;
let importSourceKind = null;
let importSourcePath = "";
let importSourceHandle = null;
let importSourceLabel = "";
let pendingSourceDeletePaths = new Set();
let latestSaveRecord = "";
let latestExportRecord = "";
let toastHideTimer = null;

class FileNode {
  constructor({name, path, parent=null, isDir=false, data=null, zipChild=null, sourceZipPath=null}) {
    this.name = name;
    this.path = path;
    this.parent = parent;
    this.isDir = isDir;
    this.data = data;
    this.zipChild = zipChild;
    this.sourceZipPath = sourceZipPath;
    this.children = [];
    this.modified = false;
    this.deleted = false;
    this.expanded = true;
  }
}

function log(msg){
  const viewer = document.getElementById("viewer");
  viewer.innerHTML = `<div class="drop">处理中...</div><div class="log">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function showToast(message, options={}){
  const {variant="success", duration=2200} = options;
  const viewport = document.getElementById("toastViewport");
  if(!viewport) return;

  if(toastHideTimer){
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }

  const iconMarkup = variant === "error"
    ? `<svg viewBox="0 0 20 20" role="presentation" focusable="false"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>`
    : `<svg viewBox="0 0 20 20" role="presentation" focusable="false"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M6.5 10.3l2.2 2.3 4.8-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  viewport.innerHTML = `
    <div class="toast ${variant}">
      <span class="toast-icon" aria-hidden="true">${iconMarkup}</span>
      <span class="toast-text">${escapeHtml(message)}</span>
    </div>
  `;
  const toast = viewport.firstElementChild;
  requestAnimationFrame(()=> toast?.classList.add("show"));

  toastHideTimer = setTimeout(()=>{
    toast?.classList.remove("show");
    setTimeout(()=>{
      if(viewport.firstElementChild === toast){
        viewport.innerHTML = "";
      }
    }, 180);
    toastHideTimer = null;
  }, duration);
}

function bytesToSize(bytes){
  if(bytes == null) return "-";
  const units=["B","KB","MB","GB"];
  let i=0,n=bytes;
  while(n>=1024&&i<units.length-1){n/=1024;i++;}
  return `${n.toFixed(i?1:0)} ${units[i]}`;
}

function pushUnique(list, value){
  if(value == null || value === "") return;
  if(!list.includes(value)) list.push(value);
}

function clearActiveTextEditor(){
  if(activeTextEditor?.destroy){
    activeTextEditor.destroy();
  }
  activeTextEditor = null;
  clearEditorTrackingState();
}

function setActiveTextEditor(editorApi){
  clearActiveTextEditor();
  activeTextEditor = editorApi;
}

function getActiveTextEditorValue(){
  if(activeTextEditor?.getValue){
    return activeTextEditor.getValue();
  }
  const fallbackEditor = document.getElementById("editor");
  return fallbackEditor ? fallbackEditor.value : "";
}

function setActiveTextEditorValue(nextValue){
  if(activeTextEditor?.setValue){
    activeTextEditor.setValue(nextValue);
  }else{
    const fallbackEditor = document.getElementById("editor");
    if(fallbackEditor){
      fallbackEditor.value = nextValue;
    }
  }
  syncActiveEditorDirtyState();
}

function focusActiveTextEditor(){
  if(activeTextEditor?.focus){
    activeTextEditor.focus();
    return;
  }
  const fallbackEditor = document.getElementById("editor");
  fallbackEditor?.focus();
}

function canSaveCurrentSource(){
  return !!rootNode && !!importSourceKind && (!!importSourcePath || !!importSourceHandle);
}

function getImportSourceLabel(){
  return importSourcePath || importSourceLabel || originalFullName;
}

function formatOperationTime(date=new Date()){
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function updateTreeFooterStatus(){
  const statusEl = document.getElementById("treeFooterStatus");
  if(!statusEl) return;
  const hasPackage = !!rootNode;
  const parts = [];
  if(latestSaveRecord) parts.push(latestSaveRecord);
  if(latestExportRecord) parts.push(latestExportRecord);
  statusEl.style.display = hasPackage && parts.length > 0 ? "block" : "none";
  statusEl.textContent = parts.join("  ");
}

function clearOperationRecords(){
  latestSaveRecord = "";
  latestExportRecord = "";
  updateTreeFooterStatus();
}

function recordOperation(type){
  const timestamp = formatOperationTime();
  if(type === "save"){
    latestSaveRecord = `${timestamp} 已保存`;
  }else if(type === "export"){
    latestExportRecord = `${timestamp} 已导出`;
  }
  updateTreeFooterStatus();
}

function renderOperationSuccess(actionText, targetPath){
  const viewer = document.getElementById("viewer");
  viewer.innerHTML = `
    <div class="operation-success">
      <div class="operation-success-icon" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="presentation" focusable="false">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.14"></circle>
          <path d="M10 16.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </div>
      <div class="operation-success-text">${escapeHtml(actionText)}</div>
      <div class="operation-success-path">${escapeHtml(targetPath)}</div>
    </div>
  `;
}

function updatePackageSaveButtonState(){
  const savePackageBtn = document.getElementById("savePackageBtn");
  if(!savePackageBtn) return;
  const hasPackage = !!rootNode;
  const canSave = canSaveCurrentSource();
  savePackageBtn.style.display = hasPackage ? "inline-block" : "none";
  savePackageBtn.disabled = hasPackage && !canSave;
  savePackageBtn.textContent = "保存";
  savePackageBtn.title = canSave
    ? "保存回当前导入的主题包或文件夹"
    : (hasPackage ? "当前导入方式暂不支持直接保存回原位置，请使用“导出”。" : "");
}

function updateSaveButtonState(){
  const saveBtn = document.getElementById("saveTextBtn");
  saveBtn.textContent = "保存文本";
  saveBtn.classList.toggle("primary", activeEditorDirty);
  updatePackageSaveButtonState();
}

function clearEditorTrackingState(){
  activeEditorNodePath = null;
  activeEditorSavedText = "";
  activeEditorDirty = false;
  updateSaveButtonState();
}

function beginTextEditingSession(node, text){
  activeEditorNodePath = node?.path || null;
  activeEditorSavedText = text;
  activeEditorDirty = false;
  updateSaveButtonState();
}

function syncActiveEditorDirtyState(){
  const isEditingCurrentNode = !!selected && !selected.isDir && activeEditorNodePath === selected.path;
  const nextDirty = isEditingCurrentNode && getActiveTextEditorValue() !== activeEditorSavedText;
  if(activeEditorDirty === nextDirty) return;
  activeEditorDirty = nextDirty;
  updateSaveButtonState();
}

function hasUnsavedTextChanges(){
  return !!activeEditorNodePath && activeEditorDirty;
}

function treeHasPendingChanges(node){
  if(!node || node.deleted) return false;
  if(node.modified) return true;
  for(const child of node.children || []){
    if(child.deleted || treeHasPendingChanges(child)) return true;
  }
  return false;
}

function hasPendingPackageChanges(){
  return hasUnsavedTextChanges() || treeHasPendingChanges(rootNode);
}

function setImportSource(kind=null, sourcePath="", sourceHandle=null, sourceLabel=""){
  importSourceKind = kind || null;
  importSourcePath = kind ? String(sourcePath || "") : "";
  importSourceHandle = kind ? (sourceHandle || null) : null;
  importSourceLabel = kind ? String(sourceLabel || sourcePath || "") : "";
  pendingSourceDeletePaths.clear();
  clearOperationRecords();
  updatePackageSaveButtonState();
}

function rememberSourcePathDeletion(path){
  const normalizedPath = normalizePath(path || "");
  if(!normalizedPath) return;
  pendingSourceDeletePaths.add(normalizedPath);
  updatePackageSaveButtonState();
}

function clearExportedFlags(node){
  if(!node) return null;
  if(node.deleted) return null;
  node.modified = false;
  if(node.children?.length){
    node.children = node.children
      .map(child => clearExportedFlags(child))
      .filter(Boolean);
  }
  return node;
}

function syncSelectionMetaAfterExport(){
  if(!selected) return;
  const isPackageRoot = isPackageRootNode(selected);
  document.getElementById("currentMeta").textContent = selected.isDir
    ? (isPackageRoot
      ? `主题包根目录 · ${getVisibleChildCount(selected)} 个项目`
      : `${getVisibleChildCount(selected)} 个项目${selected.isArchiveContainer ? " · 内部压缩包" : ""}`)
    : `${bytesToSize(selected.data?.length)}`;
}

function markCurrentPackageAsExported(){
  pendingSourceDeletePaths.clear();
  clearExportedFlags(rootNode);
  renderTree();
  syncSelectionMetaAfterExport();
  updatePackageSaveButtonState();
}

function ensureJsZipAvailable(){
  if(typeof JSZip === "undefined"){
    throw new Error("JSZip 未加载，请先执行 npm install，或检查桌面应用是否完整打包。");
  }
  return JSZip;
}

function getTauriFileApi(){
  if(typeof window === "undefined") return null;
  const tauri = window.__TAURI__;
  if(!tauri?.dialog?.save || !tauri?.fs?.writeFile) return null;
  return {
    open: tauri.dialog.open,
    save: tauri.dialog.save,
    readDir: tauri.fs.readDir,
    readFile: tauri.fs.readFile,
    mkdir: tauri.fs.mkdir,
    remove: tauri.fs.remove,
    writeFile: tauri.fs.writeFile
  };
}

function getPathLeafName(pathValue){
  const pathText = String(pathValue || "").replace(/[\\/]+$/, "");
  if(!pathText) return "";
  const parts = pathText.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function joinFsPath(basePath, entryName){
  return `${String(basePath || "").replace(/[\\/]+$/, "")}/${entryName}`;
}

function supportsFileSystemAccess(){
  return typeof window !== "undefined"
    && typeof window.showOpenFilePicker === "function"
    && typeof window.showDirectoryPicker === "function";
}

function isAbortError(err){
  return err?.name === "AbortError";
}

async function ensureFileSystemHandlePermission(handle, mode="readwrite"){
  if(!handle) return false;
  if(typeof handle.queryPermission === "function"){
    const permission = await handle.queryPermission({mode});
    if(permission === "granted") return true;
  }
  if(typeof handle.requestPermission === "function"){
    const permission = await handle.requestPermission({mode});
    return permission === "granted";
  }
  return true;
}

function getFolderInputRootName(files){
  const firstPath = files?.[0]?.webkitRelativePath || files?.[0]?.name || "theme-folder";
  const [rootName] = firstPath.split("/");
  return rootName || "theme-folder";
}

function normalizeFolderEntryPath(relativePath, rootName){
  const normalized = normalizePath(relativePath || "");
  if(!normalized) return "";
  const rootPrefix = `${rootName}/`;
  if(normalized === rootName) return "";
  if(normalized.startsWith(rootPrefix)) return normalized.slice(rootPrefix.length);
  return normalized;
}

function applyTheme(theme){
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  const toggle = document.getElementById("themeToggle");
  toggle.textContent = isDark ? "☀" : "☾";
  toggle.title = isDark ? "切换到浅色模式" : "切换到深色模式";
  toggle.setAttribute("aria-label", toggle.title);
}

function initTheme(){
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "light";
  applyTheme(savedTheme);
}

function toggleTheme(){
  const nextTheme = document.body.classList.contains("theme-dark") ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function runModal(options={}){
  const {
    title = "提示",
    description = "",
    placeholder = "",
    value = "",
    selectAll = false,
    showInput = false,
    okText = "确认",
    cancelText = "取消",
    showCancel = true,
    okClassName = "primary",
    extraActionText = "",
    extraActionClassName = "",
    showExtraAction = false,
    extraActionResult = "extra",
    cancelActionResult = "cancel",
    dismissActionResult = "cancel"
  } = options;

  const mask = document.getElementById("modalMask");
  const input = document.getElementById("modalPath");
  const titleEl = document.getElementById("modalTitle");
  const descEl = document.getElementById("modalDesc");
  const okBtn = document.getElementById("modalOk");
  const cancelBtn = document.getElementById("modalCancel");
  const extraBtn = document.getElementById("modalExtra");
  const modal = mask.querySelector(".modal");

  return new Promise(resolve => {
    const cleanup = (result)=>{
      mask.style.display = "none";
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      extraBtn.onclick = null;
      mask.onclick = null;
      modal.onclick = null;
      input.onkeydown = null;
      input.style.display = "";
      input.placeholder = "";
      input.value = "";
      okBtn.className = "primary";
      okBtn.textContent = "确认";
      cancelBtn.textContent = "取消";
      cancelBtn.style.display = "";
      extraBtn.textContent = "额外操作";
      extraBtn.className = "";
      extraBtn.style.display = "none";
      resolve(result);
    };

    titleEl.textContent = title;
    descEl.textContent = description;
    input.placeholder = placeholder;
    input.value = value;
    input.style.display = showInput ? "" : "none";
    okBtn.textContent = okText;
    okBtn.className = okClassName;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = showCancel ? "" : "none";
    extraBtn.textContent = extraActionText;
    extraBtn.className = extraActionClassName;
    extraBtn.style.display = showExtraAction ? "" : "none";

    modal.onclick = ev => ev.stopPropagation();
    mask.onclick = ()=> cleanup({confirmed:false, value:"", action:dismissActionResult});
    cancelBtn.onclick = ()=> cleanup({confirmed:false, value:input.value.trim(), action:cancelActionResult});
    extraBtn.onclick = ()=> cleanup({confirmed:false, value:input.value.trim(), action:extraActionResult});
    input.onkeydown = ev => {
      if(ev.key === "Escape"){
        ev.preventDefault();
        cleanup({confirmed:false, value:input.value.trim(), action:dismissActionResult});
        return;
      }
      if(showInput && ev.key === "Enter"){
        ev.preventDefault();
        okBtn.click();
      }
    };
    okBtn.onclick = ()=> cleanup({confirmed:true, value:input.value.trim(), action:"ok"});

    mask.style.display = "flex";
    if(showInput){
      input.focus();
      if(selectAll) input.select();
    }else{
      okBtn.focus();
    }
  });
}

async function appAlert(message, options={}){
  await runModal({
    title: options.title || "提示",
    description: message,
    showInput: false,
    okText: options.okText || "知道了",
    showCancel: false
  });
}

async function appConfirm(message, options={}){
  const result = await runModal({
    title: options.title || "请确认",
    description: message,
    showInput: false,
    okText: options.okText || "确认",
    cancelText: options.cancelText || "取消",
    showCancel: true,
    okClassName: options.okClassName || "primary"
  });
  return result.confirmed;
}

async function appConfirmUnsavedTextChanges(){
  const result = await runModal({
    title: "未保存修改",
    description: "当前文本有未保存的修改，是否先保存？",
    showInput: false,
    okText: "保存",
    cancelText: "取消",
    showCancel: true,
    okClassName: "primary",
    extraActionText: "不保存",
    extraActionClassName: "",
    showExtraAction: true,
    extraActionResult: "discard"
  });
  return result.action;
}

async function appConfirmOpenNewPackage(){
  const result = await runModal({
    title: "导入新内容",
    description: "导入新的主题内容前，建议先“保存或导出”当前主题包，如果已经“保存或导出”请忽略提示。",
    showInput: false,
    okText: "继续导入",
    cancelText: "返回",
    showCancel: true,
    okClassName: "primary",
    cancelActionResult: "stay",
    dismissActionResult: "stay"
  });
  if(result.action === "ok") return "open";
  return "stay";
}

async function isZipData(uint8){
  if(!uint8 || uint8.length < 4) return false;
  return uint8[0]===ZIP_MAGIC[0] && uint8[1]===ZIP_MAGIC[1] && uint8[2]===ZIP_MAGIC[2] && uint8[3]===ZIP_MAGIC[3];
}

function normalizePath(p){ return p.replace(/^\/+/, "").replace(/\/+/g, "/"); }

function joinNodePath(parentPath, name){
  return parentPath ? `${parentPath}/${name}` : name;
}

function isPackageRootNode(node){
  return !!node && node === rootNode;
}

function getNodeLabel(node){
  return isPackageRootNode(node) ? originalFullName : (node?.name || "root");
}

function getNodeIcon(node){
  return isPackageRootNode(node)
    ? "🗂️"
    : node.isDir
      ? (node.isArchiveContainer ? "🗜️" : "📁")
      : fileIcon(node.name);
}

function getNodeTypeLabel(node){
  if(isPackageRootNode(node)) return "主题包根目录";
  if(node.isDir) return node.isArchiveContainer ? "无后缀文件" : "文件夹";
  if(IMG_EXT.test(node.name)) return "图片";
  if(TEXT_EXT.test(node.name)){
    const ext = node.name.includes(".") ? node.name.split(".").pop()?.trim() : "";
    return ext ? ext.toUpperCase() : "文本";
  }
  return "其它文件";
}

function isXmlFile(node){
  return !!node && !node.isDir && XML_EXT.test(node.name);
}

function getEditorConfigForNode(node){
  const fileName = node?.name || "";
  if(XML_EXT.test(fileName) || PLIST_EXT.test(fileName)){
    return {
      label: XML_EXT.test(fileName) ? "XML" : "PLIST/XML",
      mode: "application/xml",
      completionKind: "xml",
      formatKind: "xml",
      autoCompletionTrigger: XML_COMPLETION_TRIGGER,
      autoCloseTags: true,
      matchTags: {bothTags:true}
    };
  }
  if(HTML_EXT.test(fileName)){
    return {
      label: "HTML",
      mode: "text/html",
      completionKind: "html",
      formatKind: "html",
      autoCompletionTrigger: XML_COMPLETION_TRIGGER,
      autoCloseTags: true,
      matchTags: {bothTags:true}
    };
  }
  if(JSON_EXT.test(fileName)){
    return {
      label: "JSON",
      mode: {name:"javascript", json:true},
      completionKind: "text",
      formatKind: "json"
    };
  }
  if(JS_EXT.test(fileName)){
    return {
      label: "JavaScript",
      mode: "text/javascript",
      completionKind: "javascript",
      formatKind: "javascript"
    };
  }
  if(CSS_EXT.test(fileName)){
    return {
      label: "CSS",
      mode: "text/css",
      completionKind: "css",
      formatKind: "css"
    };
  }
  if(MARKDOWN_EXT.test(fileName)){
    return {
      label: "Markdown",
      mode: "text/x-markdown",
      completionKind: "text"
    };
  }
  if(PROPERTIES_EXT.test(fileName)){
    return {
      label: "配置文件",
      mode: "text/x-properties",
      completionKind: "text"
    };
  }
  return {
    label: "文本",
    mode: null,
    completionKind: "text"
  };
}

function supportsFormatting(editorConfig){
  return !!editorConfig?.formatKind;
}

function escapeMarkupText(text){
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkupAttribute(text){
  return escapeMarkupText(text).replace(/"/g, "&quot;");
}

function getSerializedMarkup(doc){
  if(typeof XMLSerializer === "undefined") return "";
  const serializer = new XMLSerializer();
  return Array.from(doc.childNodes || [])
    .map(node => serializer.serializeToString(node))
    .join("");
}

function getMarkupTagName(tagText){
  const match = tagText.match(/^<\/?\s*([^\s/>]+)/);
  return match ? match[1].toLowerCase() : "";
}

function isMarkupClosingTag(token){
  return /^<\//.test(token);
}

function isMarkupSelfClosingTag(token){
  return /^<[^!?/][^>]*\/>$/.test(token);
}

function isMarkupOpeningTag(token){
  return /^<[^!?/][^>]*>$/.test(token);
}

function normalizeMarkupTextToken(token){
  return token.replace(/\s+/g, " ").trim();
}

function prettyPrintMarkupTokens(serializedText){
  const tokenRegex = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?[^>]+>|[^<]+/gi;
  const tokens = serializedText.match(tokenRegex) || [];
  const lines = [];
  let indent = 0;

  for(let index = 0; index < tokens.length; index++){
    const rawToken = tokens[index];
    if(!rawToken) continue;
    const trimmedToken = rawToken.trim();
    if(!trimmedToken) continue;
    const prefix = "  ".repeat(Math.max(indent, 0));

    if(isMarkupClosingTag(trimmedToken)){
      indent = Math.max(indent - 1, 0);
      lines.push(`${"  ".repeat(indent)}${trimmedToken}`);
      continue;
    }

    if(/^<\?/.test(trimmedToken) || /^<!DOCTYPE/i.test(trimmedToken) || /^<!--/.test(trimmedToken) || /^<!\[CDATA\[/.test(trimmedToken)){
      lines.push(`${prefix}${trimmedToken}`);
      continue;
    }

    if(isMarkupSelfClosingTag(trimmedToken)){
      lines.push(`${prefix}${trimmedToken}`);
      continue;
    }

    if(isMarkupOpeningTag(trimmedToken)){
      const nextToken = tokens[index + 1] || "";
      const nextTrimmed = nextToken.trim();
      const nextNextToken = tokens[index + 2] || "";
      const nextNextTrimmed = nextNextToken.trim();

      if(
        nextTrimmed &&
        !nextTrimmed.startsWith("<") &&
        isMarkupClosingTag(nextNextTrimmed) &&
        getMarkupTagName(trimmedToken) === getMarkupTagName(nextNextTrimmed)
      ){
        lines.push(`${prefix}${trimmedToken}${normalizeMarkupTextToken(nextTrimmed)}${nextNextTrimmed}`);
        index += 2;
        continue;
      }

      lines.push(`${prefix}${trimmedToken}`);
      indent += 1;
      continue;
    }

    lines.push(`${prefix}${normalizeMarkupTextToken(trimmedToken)}`);
  }

  return lines.join("\n").trim();
}

function formatXmlText(sourceText){
  const parser = new DOMParser().parseFromString(sourceText, "application/xml");
  const parserError = parser.querySelector("parsererror");
  if(parserError){
    throw new Error("XML 结构有误，暂时无法格式化。");
  }

  const serializedMarkup = getSerializedMarkup(parser);
  const xmlDeclarationMatch = sourceText.match(/^\s*(<\?xml[\s\S]*?\?>)/i);
  const prettyPrinted = prettyPrintMarkupTokens(serializedMarkup);

  if(xmlDeclarationMatch){
    return prettyPrinted.startsWith(xmlDeclarationMatch[1])
      ? prettyPrinted
      : `${xmlDeclarationMatch[1]}\n${prettyPrinted}`.trim();
  }

  return prettyPrinted;
}

function serializeMarkupAttributes(node){
  const attrs = Array.from(node.attributes || []);
  if(attrs.length === 0) return "";
  return attrs.map(attr => ` ${attr.name}="${escapeMarkupAttribute(attr.value)}"`).join("");
}

function formatMarkupNode(node, level, options){
  const indent = "  ".repeat(level);
  const isHtml = options.formatKind === "html";
  const htmlVoidTags = options.htmlVoidTags;

  switch(node.nodeType){
    case Node.ELEMENT_NODE: {
      const tagName = node.tagName;
      const attrs = serializeMarkupAttributes(node);
      const children = Array.from(node.childNodes || []).filter(child => {
        return child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim() !== "";
      });
      const isVoidHtml = isHtml && htmlVoidTags.has(tagName.toLowerCase());

      if(children.length === 0){
        if(isVoidHtml) return `${indent}<${tagName}${attrs}>`;
        return options.formatKind === "xml"
          ? `${indent}<${tagName}${attrs} />`
          : `${indent}<${tagName}${attrs}></${tagName}>`;
      }

      if(children.length === 1){
        const onlyChild = children[0];
        if(onlyChild.nodeType === Node.TEXT_NODE){
          const text = onlyChild.nodeValue.replace(/\s+/g, " ").trim();
          return `${indent}<${tagName}${attrs}>${escapeMarkupText(text)}</${tagName}>`;
        }
        if(onlyChild.nodeType === Node.CDATA_SECTION_NODE){
          return `${indent}<${tagName}${attrs}><![CDATA[${onlyChild.nodeValue}]]></${tagName}>`;
        }
      }

      const renderedChildren = children
        .map(child => formatMarkupNode(child, level + 1, options))
        .filter(Boolean)
        .join("\n");
      return `${indent}<${tagName}${attrs}>\n${renderedChildren}\n${indent}</${tagName}>`;
    }
    case Node.TEXT_NODE: {
      const text = node.nodeValue.replace(/\s+/g, " ").trim();
      return text ? `${indent}${escapeMarkupText(text)}` : "";
    }
    case Node.CDATA_SECTION_NODE:
      return `${indent}<![CDATA[${node.nodeValue}]]>`;
    case Node.COMMENT_NODE:
      return `${indent}<!--${node.nodeValue}-->`;
    case Node.PROCESSING_INSTRUCTION_NODE:
      return `${indent}<?${node.target}${node.data ? ` ${node.data}` : ""}?>`;
    case Node.DOCUMENT_TYPE_NODE: {
      const publicId = node.publicId ? ` PUBLIC "${node.publicId}"` : "";
      const systemId = node.systemId ? `${publicId ? "" : " SYSTEM"} "${node.systemId}"` : "";
      return `<!DOCTYPE ${node.name}${publicId}${systemId}>`;
    }
    default:
      return "";
  }
}

function formatMarkupText(sourceText, formatKind){
  const parserType = formatKind === "html" ? "text/html" : "application/xml";
  const parser = new DOMParser().parseFromString(sourceText, parserType);
  if(formatKind === "xml"){
    const parserError = parser.querySelector("parsererror");
    if(parserError){
      throw new Error("XML 结构有误，暂时无法格式化。");
    }
  }

  const htmlVoidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const nodes = Array.from(parser.childNodes || []).filter(node => {
    return node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim() !== "";
  });
  const rendered = nodes
    .map(node => formatMarkupNode(node, 0, {formatKind, htmlVoidTags}))
    .filter(Boolean)
    .join("\n");
  const xmlDeclMatch = formatKind === "xml" ? sourceText.match(/^\s*(<\?xml[\s\S]*?\?>)/i) : null;
  return xmlDeclMatch && !rendered.startsWith(xmlDeclMatch[1])
    ? `${xmlDeclMatch[1]}\n${rendered}`.trim()
    : rendered.trim();
}

function formatEditorText(text, editorConfig){
  switch(editorConfig?.formatKind){
    case "xml":
      return formatXmlText(text);
    case "html":
      return formatMarkupText(text, editorConfig.formatKind);
    case "javascript":
      if(typeof js_beautify !== "function"){
        throw new Error("JavaScript 格式化模块未加载。");
      }
      return js_beautify(text, {
        indent_size: 2,
        indent_char: " ",
        preserve_newlines: true,
        max_preserve_newlines: 2,
        end_with_newline: text.endsWith("\n")
      });
    case "css":
      if(typeof css_beautify !== "function"){
        throw new Error("CSS 格式化模块未加载。");
      }
      return css_beautify(text, {
        indent_size: 2,
        indent_char: " ",
        preserve_newlines: true,
        end_with_newline: text.endsWith("\n")
      });
    case "json":
      return `${JSON.stringify(JSON.parse(text), null, 2)}\n`.replace(/\n$/, text.endsWith("\n") ? "\n" : "");
    default:
      throw new Error("当前文件类型暂不支持格式化。");
  }
}

function ensureXmlSchemaTag(schemaInfo, tagName){
  if(!schemaInfo[tagName]){
    schemaInfo[tagName] = {attrs:{}, children:[]};
  }
  return schemaInfo[tagName];
}

function registerXmlAttribute(target, attrName, attrValue){
  if(!attrName) return;
  if(!Object.prototype.hasOwnProperty.call(target, attrName)){
    target[attrName] = [];
  }
  if(Array.isArray(target[attrName]) && attrValue){
    pushUnique(target[attrName], attrValue);
    if(target[attrName].length > 12){
      target[attrName] = target[attrName].slice(0, 12);
    }
  }
}

function walkXmlElement(element, schemaInfo, globalAttrs, parentTagName=null){
  const tagName = element?.tagName?.trim();
  if(!tagName) return;

  const tagInfo = ensureXmlSchemaTag(schemaInfo, tagName);
  if(parentTagName){
    const parentInfo = ensureXmlSchemaTag(schemaInfo, parentTagName);
    pushUnique(parentInfo.children, tagName);
  }else{
    pushUnique(schemaInfo["!top"], tagName);
  }

  for(const attr of Array.from(element.attributes || [])){
    registerXmlAttribute(tagInfo.attrs, attr.name, attr.value);
    registerXmlAttribute(globalAttrs, attr.name, attr.value);
  }

  for(const child of Array.from(element.children || [])){
    walkXmlElement(child, schemaInfo, globalAttrs, tagName);
  }
}

function collectXmlSchemaFromText(xmlText, schemaInfo, globalAttrs){
  const tagNames = [];
  const tagPattern = /<([A-Za-z_][\w:.-]*)(?=[\s/>])([^<>]*)/g;
  const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let matched = false;
  let match;

  while((match = tagPattern.exec(xmlText))){
    matched = true;
    const tagName = match[1];
    const attrsText = match[2] || "";
    const tagInfo = ensureXmlSchemaTag(schemaInfo, tagName);
    pushUnique(schemaInfo["!top"], tagName);
    pushUnique(tagNames, tagName);

    let attrMatch;
    while((attrMatch = attrPattern.exec(attrsText))){
      registerXmlAttribute(tagInfo.attrs, attrMatch[1], attrMatch[3]);
      registerXmlAttribute(globalAttrs, attrMatch[1], attrMatch[3]);
    }
  }

  for(const tagName of tagNames){
    const tagInfo = ensureXmlSchemaTag(schemaInfo, tagName);
    for(const childTagName of tagNames){
      pushUnique(tagInfo.children, childTagName);
    }
  }

  return matched;
}

function buildXmlSchemaInfo(xmlText){
  const schemaInfo = {"!top":[]};
  const globalAttrs = {};
  let builtFromDom = false;

  try{
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    const parserError = xmlDoc.querySelector("parsererror");
    if(!parserError){
      const roots = Array.from(xmlDoc.childNodes).filter(node => node.nodeType === Node.ELEMENT_NODE);
      for(const rootElement of roots){
        walkXmlElement(rootElement, schemaInfo, globalAttrs);
        builtFromDom = true;
      }
    }
  }catch(err){
    console.warn("构建 XML schema 失败，将退回到文本扫描。", err);
  }

  if(!builtFromDom){
    collectXmlSchemaFromText(xmlText, schemaInfo, globalAttrs);
  }

  for(const attrName of XML_COMMON_ATTRS){
    if(!Object.prototype.hasOwnProperty.call(globalAttrs, attrName)){
      globalAttrs[attrName] = null;
    }
  }

  const discoveredTags = Object.keys(schemaInfo).filter(name => !name.startsWith("!"));
  if(schemaInfo["!top"].length === 0){
    schemaInfo["!top"] = discoveredTags.slice(0, 24);
  }
  if(discoveredTags.length > 0){
    schemaInfo["!attrs"] = globalAttrs;
  }

  return schemaInfo;
}

function normalizeHintText(hintItem){
  if(typeof hintItem === "string") return hintItem;
  return hintItem?.text || hintItem?.displayText || "";
}

function mergeHintResults(primaryHints, secondaryHints){
  const primaryList = primaryHints?.list || [];
  const secondaryList = secondaryHints?.list || [];
  const mergedList = [];
  const seen = new Set();

  for(const sourceList of [primaryList, secondaryList]){
    for(const hintItem of sourceList){
      const key = normalizeHintText(hintItem);
      if(!key || seen.has(key)) continue;
      seen.add(key);
      mergedList.push(hintItem);
    }
  }

  if(mergedList.length === 0) return null;
  const usePrimaryRange = primaryList.length > 0;
  return {
    list: mergedList,
    from: usePrimaryRange ? primaryHints.from : (secondaryHints?.from || primaryHints?.from),
    to: usePrimaryRange ? primaryHints.to : (secondaryHints?.to || primaryHints?.to)
  };
}

function getXmlCompletionHints(editor){
  if(typeof CodeMirror === "undefined") return null;
  const schemaInfo = buildXmlSchemaInfo(editor.getValue());
  const xmlHints = CodeMirror.hint.xml(editor, {
    schemaInfo,
    matchInMiddle: true
  });
  const anyWordHints = CodeMirror.hint.anyword(editor, {
    range: 200,
    word: /[\w:-]+/
  });
  return mergeHintResults(xmlHints, anyWordHints) || xmlHints || anyWordHints;
}

function getAnyWordCompletionHints(editor){
  if(typeof CodeMirror === "undefined") return null;
  return CodeMirror.hint.anyword(editor, {
    range: 250,
    word: /[\w:-]+/
  });
}

function getEditorCompletionHints(editor, editorConfig){
  if(typeof CodeMirror === "undefined") return null;
  const textHints = getAnyWordCompletionHints(editor);
  let modeHints = null;

  switch(editorConfig?.completionKind){
    case "xml":
      modeHints = getXmlCompletionHints(editor);
      break;
    case "html":
      modeHints = CodeMirror.hint.html?.(editor, {
        matchInMiddle: true
      }) || null;
      break;
    case "css":
      modeHints = CodeMirror.hint.css?.(editor) || null;
      break;
    case "javascript":
      modeHints = CodeMirror.hint.javascript?.(editor, {
        useGlobalScope: false
      }) || null;
      break;
    default:
      modeHints = null;
      break;
  }

  return mergeHintResults(modeHints, textHints) || modeHints || textHints;
}

function shouldTriggerEditorCompletion(change, editorConfig){
  if(!change || change.origin === "setValue") return false;
  const insertedText = change.text?.join("");
  if(!insertedText || insertedText.length !== 1) return false;
  return editorConfig?.autoCompletionTrigger?.has(insertedText) || false;
}

function showEditorCompletion(editor, editorConfig){
  if(typeof CodeMirror === "undefined" || typeof editor?.showHint !== "function") return;
  editor.showHint({
    hint: cm => getEditorCompletionHints(cm, editorConfig),
    completeSingle: false
  });
}

function toggleEditorComment(editor){
  if(typeof editor?.toggleComment !== "function") return;
  editor.toggleComment({
    indent: true
  });
}

function saveCurrentTextChanges(){
  if(!selected || selected.isDir) return false;
  const text = getActiveTextEditorValue();
  selected.data = new TextEncoder().encode(text);
  selected.modified = true;
  activeEditorSavedText = text;
  activeEditorDirty = false;
  updateSaveButtonState();
  renderTree();
  document.getElementById("currentMeta").textContent = `${bytesToSize(selected.data?.length)} · 已修改`;
  updatePackageSaveButtonState();
  return true;
}

function discardCurrentTextChanges(){
  if(!selected || selected.isDir) return false;
  setActiveTextEditorValue(activeEditorSavedText);
  activeEditorDirty = false;
  updateSaveButtonState();
  focusActiveTextEditor();
  return true;
}

async function confirmLeaveWithUnsavedChanges(){
  if(!hasUnsavedTextChanges()) return true;
  const action = await appConfirmUnsavedTextChanges();
  if(action === "cancel") return false;
  if(action === "ok"){
    saveCurrentTextChanges();
    focusActiveTextEditor();
    return false;
  }
  if(action === "discard"){
    discardCurrentTextChanges();
  }
  return false;
}

function renderPlainTextEditor(viewer, text){
  const editor = document.createElement("textarea");
  editor.id = "editor";
  editor.spellcheck = false;
  editor.wrap = "off";
  editor.value = text;
  editor.addEventListener("input", syncActiveEditorDirtyState);
  viewer.appendChild(editor);
  setActiveTextEditor({
    getValue: ()=> editor.value,
    setValue: value => { editor.value = value; },
    focus: ()=> editor.focus()
  });
}

function renderCodeEditor(viewer, text, editorConfig){
  if(typeof CodeMirror === "undefined"){
    renderPlainTextEditor(viewer, text);
    return;
  }

  const shell = document.createElement("div");
  shell.className = "code-editor-shell";

  const host = document.createElement("div");
  host.className = "xml-editor";
  shell.appendChild(host);
  viewer.appendChild(shell);

  const editor = CodeMirror(host, {
    value: text,
    mode: editorConfig.mode,
    lineNumbers: true,
    lineWrapping: false,
    indentUnit: 2,
    tabSize: 2,
    autofocus: true,
    autoCloseTags: editorConfig.autoCloseTags || false,
    autoCloseBrackets: true,
    matchTags: editorConfig.matchTags || false,
    matchBrackets: true,
    extraKeys: {
      "Ctrl-Space": cm => showEditorCompletion(cm, editorConfig),
      "Cmd-Space": cm => showEditorCompletion(cm, editorConfig),
      "Ctrl-S": ()=> document.getElementById("saveTextBtn").click(),
      "Cmd-S": ()=> document.getElementById("saveTextBtn").click(),
      "Ctrl-/": cm => toggleEditorComment(cm),
      "Cmd-/": cm => toggleEditorComment(cm),
      Tab: (cm)=>{
        if(cm.state.completionActive){
          cm.state.completionActive.pick();
          return;
        }
        if(cm.somethingSelected()){
          cm.indentSelection("add");
          return;
        }
        cm.replaceSelection("  ", "end", "+input");
      },
      "Shift-Tab": (cm)=>{
        if(cm.somethingSelected()){
          cm.indentSelection("subtract");
        }
      }
    }
  });

  editor.on("inputRead", (cm, change)=>{
    if(shouldTriggerEditorCompletion(change, editorConfig)){
      showEditorCompletion(cm, editorConfig);
    }
  });
  editor.on("changes", ()=> syncActiveEditorDirtyState());

  setActiveTextEditor({
    getValue: ()=> editor.getValue(),
    setValue: value => editor.setValue(value),
    destroy: ()=>{
      if(typeof editor.closeHint === "function"){
        editor.closeHint();
      }
    },
    focus: ()=> editor.focus()
  });
}

function getTargetBaseDir(){
  if(!selected) return "";
  if(selected.isDir) return selected.path;
  return selected.parent?.path || "";
}

function getVisibleChildCount(node){
  if(!node?.children) return 0;
  return node.children.filter(child => !child.deleted).length;
}

function hideSelectionActions(){
  document.getElementById("deleteSelectedBtn").style.display = "none";
  document.getElementById("formatTextBtn").style.display = "none";
  document.getElementById("saveTextBtn").style.display = "none";
  document.getElementById("replaceLabel").style.display = "none";
  document.getElementById("addTextBtn").style.display = "none";
  document.getElementById("addFolderBtn").style.display = "none";
  document.getElementById("addFileLabel").style.display = "none";
  document.getElementById("renameBtn").style.display = "none";
  document.getElementById("deleteBtn").style.display = "none";
}

function updateSidebarContext(){
  const hasPackage = !!rootNode;
  const treeWorkspace = document.getElementById("treeWorkspace");
  const treeEmptyState = document.getElementById("treeEmptyState");
  const savePackageBtn = document.getElementById("savePackageBtn");
  const exportBtn = document.getElementById("exportBtn");
  const clearBtn = document.getElementById("clearBtn");
  const mainHeader = document.getElementById("mainHeader");
  const importBtn = document.getElementById("importBtn");

  savePackageBtn.style.display = hasPackage ? "inline-block" : "none";
  exportBtn.style.display = hasPackage ? "inline-block" : "none";
  clearBtn.style.display = hasPackage ? "inline-block" : "none";
  treeWorkspace.style.display = hasPackage ? "flex" : "none";
  treeEmptyState.style.display = hasPackage ? "none" : "flex";
  mainHeader.style.display = hasPackage ? "flex" : "none";
  importBtn.classList.toggle("primary", !hasPackage);
  updatePackageSaveButtonState();
  updateTreeFooterStatus();
}

function ensureDir(root, parts){
  let cur = root;
  let currentPath = "";
  for(const part of parts){
    if(!part) continue;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    let child = cur.children.find(c => c.name === part && c.isDir);
    if(!child){
      child = new FileNode({name:part, path:currentPath, parent:cur, isDir:true});
      cur.children.push(child);
    }
    cur = child;
  }
  return cur;
}

async function buildTreeFromZip(zip, containerPath="", parentNode=null, sourceZipPath=null, depth=0){
  const root = parentNode || new FileNode({name:"root", path:"", isDir:true});
  const entries = Object.keys(zip.files).sort();

  for(const entryPath of entries){
    const entry = zip.files[entryPath];
    const clean = normalizePath(entryPath);
    if(!clean) continue;

    const parts = clean.split("/");
    if(entry.dir){
      ensureDir(root, parts.filter(Boolean));
      continue;
    }

    const fileName = parts.pop();
    const dirNode = ensureDir(root, parts);
    const fullPath = containerPath ? `${containerPath}/${clean}` : clean;
    const data = await entry.async("uint8array");

    const fileNode = new FileNode({
      name:fileName,
      path:fullPath,
      parent:dirNode,
      isDir:false,
      data,
      sourceZipPath
    });

    if(await isZipData(data)){
      try{
        const childZip = await JSZip.loadAsync(data);
        fileNode.zipChild = new FileNode({
          name:fileName,
          path:fullPath,
          parent:dirNode,
          isDir:true,
          sourceZipPath:fullPath
        });
        fileNode.zipChild.isArchiveContainer = true;
        fileNode.zipChild.archiveFileNode = fileNode;
        await buildTreeFromZip(childZip, fullPath, fileNode.zipChild, fullPath, depth+1);
      }catch(e){
        // keep as normal binary if zip parsing fails
      }
    }

    dirNode.children.push(fileNode.zipChild || fileNode);
  }

  return root;
}

function collectFiles(node, list=[]){
  if(node.deleted) return list;
  if(node.isDir){
    for(const c of node.children) collectFiles(c, list);
  }else{
    list.push(node);
  }
  return list;
}

function sortTree(node){
  if(!node.children) return;
  node.children.sort((a,b)=>{
    if(a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

function renderTree(){
  const tree = document.getElementById("tree");
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  tree.innerHTML = "";
  visibleNodeOrder = [];
  if(!rootNode){
    tree.innerHTML = `<div class="small" style="padding:10px">尚未导入主题内容</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  renderNode(rootNode, 0, frag, q);
  tree.appendChild(frag);
}

function nodeMatches(node, q){
  if(!q) return true;
  if(getNodeLabel(node).toLowerCase().includes(q)) return true;
  if(node.path.toLowerCase().includes(q)) return true;
  if(node.isDir) return node.children.some(c => nodeMatches(c,q));
  return false;
}

function renderNode(node, depth, parentEl, q){
  if(node.deleted || !nodeMatches(node,q)) return;

  visibleNodeOrder.push(node.path);

  const el = document.createElement("div");
  el.className = "node" + (selected === node ? " active":"") + (multiSelectedPaths.has(node.path) ? " multi-selected" : "");
  el.style.paddingLeft = `${8 + depth*16}px`;

  const twisty = document.createElement("span");
  twisty.className = "twisty" + (!node.isDir ? " empty" : "");
  twisty.textContent = node.isDir ? (node.expanded ? "▼" : "▶") : "•";
  twisty.title = node.isDir ? (node.expanded ? "收起" : "展开") : "";

  if(node.isDir){
    twisty.onclick = (ev)=>{
      ev.stopPropagation();
      node.expanded = !node.expanded;
      renderTree();
    };
  }

  const icon = document.createElement("span");
  icon.textContent = getNodeIcon(node);

  const name = document.createElement("span");
  name.textContent = getNodeLabel(node);

  el.appendChild(twisty);
  el.appendChild(icon);
  el.appendChild(name);

  if(node.modified){
    const b = document.createElement("span");
    b.className = "badge modified";
    b.textContent = "新";
    el.appendChild(b);
  }

  el.ondblclick = (ev)=>{
    ev.stopPropagation();
    if(node.isDir){
      node.expanded = !node.expanded;
      renderTree();
    }
  };

  el.onclick = async (ev)=>{
    ev.stopPropagation();

    if(shouldConfirmBeforeSelectionChange(node, ev)){
      const shouldContinue = await confirmLeaveWithUnsavedChanges();
      if(!shouldContinue) return;
    }

    if(isPackageRootNode(node)){
      multiSelectedPaths.clear();
      multiSelectedPaths.add(node.path);
      lastClickedPath = node.path;
      selected = node;
      refreshRightPanelAfterSelection(node);
      renderTree();
      return;
    }

    const isToggleSelect = ev.ctrlKey || ev.metaKey; // Windows/Linux: Ctrl；Mac: Command
    const rootPath = rootNode?.path || "";

    if(multiSelectedPaths.has(rootPath)){
      multiSelectedPaths.delete(rootPath);
    }

    if(ev.shiftKey && lastClickedPath && lastClickedPath !== rootPath){
      const startIndex = visibleNodeOrder.indexOf(lastClickedPath);
      const endIndex = visibleNodeOrder.indexOf(node.path);
      if(startIndex !== -1 && endIndex !== -1){
        const from = Math.min(startIndex, endIndex);
        const to = Math.max(startIndex, endIndex);
        for(let i = from; i <= to; i++){
          multiSelectedPaths.add(visibleNodeOrder[i]);
        }
      }else{
        multiSelectedPaths.add(node.path);
      }
    }else if(isToggleSelect){
      if(multiSelectedPaths.has(node.path)){
        multiSelectedPaths.delete(node.path);
      }else{
        multiSelectedPaths.add(node.path);
      }
    }else{
      multiSelectedPaths.clear();
      multiSelectedPaths.add(node.path);
    }

    lastClickedPath = node.path;
    selected = node;
    refreshRightPanelAfterSelection(node);
    renderTree();
  };

  parentEl.appendChild(el);

  if(node.isDir && node.expanded){
    for(const child of node.children) renderNode(child, depth+1, parentEl, q);
  }
}

function fileIcon(name){
  if(IMG_EXT.test(name)) return "🖼️";
  if(TEXT_EXT.test(name)) return "📄";
  return "📦";
}


function getSelectedNodes(){
  if(!rootNode) return [];
  return Array.from(multiSelectedPaths)
    .map(path => findNodeByPath(rootNode, path))
    .filter(node => node && !node.deleted && !(isPackageRootNode(node) && multiSelectedPaths.size > 1));
}

async function showMultiSelectionTable(){
  updateSidebarContext();
  const nodes = getSelectedNodes();
  document.getElementById("currentPath").textContent = `已选择 ${nodes.length} 项素材`;
  document.getElementById("currentMeta").textContent = "多选模式，可点击“删除所选”批量删除";
  hideSelectionActions();
  document.getElementById("deleteSelectedBtn").style.display = "inline-block";

  const viewer = document.getElementById("viewer");
  viewer.innerHTML = `
    <table class="multi-table">
      <thead>
        <tr>
          <th>素材名称</th>
          <th>类型</th>
          <th>文件容量</th>
          <th>图片尺寸</th>
        </tr>
      </thead>
      <tbody id="multiTableBody"></tbody>
    </table>
  `;

  const tbody = document.getElementById("multiTableBody");

  for(const node of nodes){
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "multi-name";
    nameTd.title = node.path;
    const nameContent = document.createElement("div");
    nameContent.className = "multi-name-content";
    const nameIcon = document.createElement("span");
    nameIcon.className = "multi-name-icon";
    nameIcon.textContent = getNodeIcon(node);
    const nameText = document.createElement("span");
    nameText.className = "multi-name-text";
    nameText.textContent = node.path || node.name;
    nameContent.appendChild(nameIcon);
    nameContent.appendChild(nameText);
    nameTd.appendChild(nameContent);

    const typeTd = document.createElement("td");
    typeTd.textContent = getNodeTypeLabel(node);

    const sizeTd = document.createElement("td");
    sizeTd.textContent = node.isDir ? "--" : bytesToSize(node.data?.length);

    const dimensionTd = document.createElement("td");
    dimensionTd.textContent = "--";

    tr.appendChild(nameTd);
    tr.appendChild(typeTd);
    tr.appendChild(sizeTd);
    tr.appendChild(dimensionTd);
    tbody.appendChild(tr);

    if(!node.isDir && IMG_EXT.test(node.name)){
      const blob = new Blob([node.data]);
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = ()=>{
        dimensionTd.textContent = `${img.naturalWidth} × ${img.naturalHeight}px`;
        URL.revokeObjectURL(url);
      };
      img.onerror = ()=>{
        dimensionTd.textContent = "无法读取";
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  }
}

function refreshRightPanelAfterSelection(node){
  updateSidebarContext();
  if(multiSelectedPaths.size > 1){
    document.getElementById("deleteSelectedBtn").style.display = "inline-block";
    showMultiSelectionTable();
  }else{
    document.getElementById("deleteSelectedBtn").style.display = "none";
    selected = node;
    openNode(node);
  }
}

function shouldConfirmBeforeSelectionChange(targetNode, event){
  if(!hasUnsavedTextChanges()) return false;
  if(!targetNode) return false;
  if(targetNode.path !== activeEditorNodePath) return true;
  return !!(event?.shiftKey || event?.ctrlKey || event?.metaKey);
}

async function openNode(node){
  updateSidebarContext();
  const isPackageRoot = isPackageRootNode(node);
  document.getElementById("currentPath").textContent = isPackageRoot ? originalFullName : (node.path || "/");
  document.getElementById("currentMeta").textContent = node.isDir
    ? (isPackageRoot
      ? `主题包根目录 · ${getVisibleChildCount(node)} 个项目`
      : `${getVisibleChildCount(node)} 个项目${node.isArchiveContainer ? " · 内部压缩包" : ""}`)
    : `${bytesToSize(node.data?.length)}${node.modified ? " · 已修改" : ""}`;

  hideSelectionActions();
  document.getElementById("replaceLabel").style.display = node.isDir ? "none" : "";
  document.getElementById("addTextBtn").style.display = node.isDir ? "inline-block" : "none";
  document.getElementById("addFolderBtn").style.display = node.isDir ? "inline-block" : "none";
  document.getElementById("addFileLabel").style.display = node.isDir ? "inline-flex" : "none";
  document.getElementById("renameBtn").style.display = node === rootNode ? "none" : "";
  document.getElementById("deleteBtn").style.display = node === rootNode ? "none" : "";

  const viewer = document.getElementById("viewer");
  clearActiveTextEditor();
  viewer.innerHTML = "";

  if(node.isDir){
    viewer.innerHTML = `
      <div class="drop">
        <div class="drop-icon">${escapeHtml(getNodeIcon(node))}</div>
        <b>${escapeHtml(getNodeLabel(node))}</b><br>
        ${isPackageRoot
          ? "这是主题包根目录"
          : (node.isArchiveContainer ? "这是一个无后缀文件，导出时会自动回写为原来的无后缀文件。" : "文件夹")}
        <br><br>
        <span class="small">包含 ${getVisibleChildCount(node)} 个项目</span>
      </div>`;
    return;
  }

  if(IMG_EXT.test(node.name)){
    const blob = new Blob([node.data]);
    const url = URL.createObjectURL(blob);
    viewer.innerHTML = `
      <div class="image-wrap">
        <img id="previewImage" src="${url}" />
        <div class="small" id="imageInfo">文件容量：${bytesToSize(node.data?.length)} · 图片尺寸：读取中...</div>
        <div class="small">可点击右上角“替换文件”替换图片资源。</div>
      </div>`;

    const img = document.getElementById("previewImage");
    img.onload = ()=>{
      const info = document.getElementById("imageInfo");
      if(info){
        info.textContent = `文件容量：${bytesToSize(node.data?.length)} · 图片尺寸：${img.naturalWidth} × ${img.naturalHeight}px`;
      }
    };
    img.onerror = ()=>{
      const info = document.getElementById("imageInfo");
      if(info){
        info.textContent = `文件容量：${bytesToSize(node.data?.length)} · 图片尺寸：无法读取`;
      }
    };
    return;
  }

  const looksText = TEXT_EXT.test(node.name) || await likelyText(node.data);
  if(looksText){
    const text = new TextDecoder("utf-8").decode(node.data);
    const editorConfig = getEditorConfigForNode(node);
    renderCodeEditor(viewer, text, editorConfig);
    beginTextEditingSession(node, text);
    document.getElementById("formatTextBtn").style.display = supportsFormatting(editorConfig) ? "" : "none";
    document.getElementById("saveTextBtn").style.display = "";
    updateSaveButtonState();
  }else{
    viewer.innerHTML = `<div class="drop">二进制文件：${escapeHtml(node.name)}<br><br><span class="small">可使用“替换文件”更新内容。</span></div>`;
  }
}

async function likelyText(uint8){
  const len = Math.min(uint8.length, 2048);
  if(len === 0) return true;
  let bad = 0;
  for(let i=0;i<len;i++){
    const c = uint8[i];
    if(c === 0) return false;
    if(c < 7 || (c > 14 && c < 32)) bad++;
  }
  return bad / len < 0.03;
}

function setOriginalFileName(fileName){
  originalFullName = fileName || "theme.itz";
  const lastDot = originalFullName.lastIndexOf(".");
  if(lastDot > 0){
    originalBaseName = originalFullName.slice(0, lastDot);
    originalExt = originalFullName.slice(lastDot);
  }else{
    originalBaseName = originalFullName || "theme";
    originalExt = "";
  }
}

function setOriginalFolderName(folderName){
  originalFullName = folderName || "theme-folder";
  originalBaseName = originalFullName;
  originalExt = ".zip";
}

function applyLoadedRootNode(loadedRoot, fileName="theme.itz", sourcePath="", sourceHandle=null){
  setOriginalFileName(fileName);
  setImportSource(sourcePath || sourceHandle ? "package" : null, sourcePath, sourceHandle, fileName);
  multiSelectedPaths.clear();
  visibleNodeOrder = [];
  rootNode = loadedRoot;
  sortTree(rootNode);
  setExpandedRecursive(rootNode, false);
  rootNode.expanded = true;
  selected = rootNode;
  multiSelectedPaths.add(rootNode.path);
  lastClickedPath = rootNode.path;
  hideSelectionActions();
  updateSidebarContext();
  renderTree();
  void openNode(rootNode);
}

function applyLoadedFolderRootNode(loadedRoot, folderName="theme-folder", sourcePath="", sourceHandle=null){
  setOriginalFolderName(folderName);
  setImportSource(sourcePath || sourceHandle ? "folder" : null, sourcePath, sourceHandle, folderName);
  multiSelectedPaths.clear();
  visibleNodeOrder = [];
  rootNode = loadedRoot;
  sortTree(rootNode);
  setExpandedRecursive(rootNode, false);
  rootNode.expanded = true;
  selected = rootNode;
  multiSelectedPaths.add(rootNode.path);
  lastClickedPath = rootNode.path;
  hideSelectionActions();
  updateSidebarContext();
  renderTree();
  void openNode(rootNode);
}

function fixtureEntryToUint8Array(entry){
  if(entry?.bytes instanceof Uint8Array) return entry.bytes;
  if(ArrayBuffer.isView(entry?.bytes)) return new Uint8Array(entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength));
  if(entry?.bytes instanceof ArrayBuffer) return new Uint8Array(entry.bytes);
  return new TextEncoder().encode(entry?.content || "");
}

function buildRootNodeFromFixture(entries=[]){
  const root = new FileNode({name:"root", path:"", isDir:true});
  for(const entry of entries){
    const normalizedPath = normalizePath(entry?.path || "");
    if(!normalizedPath) continue;
    if(entry?.type === "dir" || entry?.isDir){
      ensureDir(root, normalizedPath.split("/").filter(Boolean));
      continue;
    }
    const parts = normalizedPath.split("/");
    const name = parts.pop();
    const parent = ensureDir(root, parts);
    const node = new FileNode({
      name,
      path: normalizedPath,
      parent,
      isDir: false,
      data: fixtureEntryToUint8Array(entry)
    });
    parent.children.push(node);
  }
  return root;
}

async function loadPackageFromArrayBuffer(buffer, fileName="theme.itz", sourcePath="", sourceHandle=null){
  setOriginalFileName(fileName);
  log("读取主题包中，请稍候...");
  const ZipLib = ensureJsZipAvailable();
  rootZip = await ZipLib.loadAsync(buffer);
  const loadedRoot = await buildTreeFromZip(rootZip);
  applyLoadedRootNode(loadedRoot, fileName, sourcePath, sourceHandle);
}

async function loadFixtureEntries(entries, fileName="theme.itz"){
  rootZip = null;
  const loadedRoot = buildRootNodeFromFixture(entries);
  applyLoadedRootNode(loadedRoot, fileName);
}

async function loadPackageFromFolderFiles(fileList){
  const files = Array.from(fileList || []);
  if(files.length === 0) return;
  rootZip = null;
  const folderName = getFolderInputRootName(files);
  const entries = [];
  for(const file of files){
    const relativePath = normalizeFolderEntryPath(file.webkitRelativePath || file.name, folderName);
    if(!relativePath) continue;
    entries.push({
      path: relativePath,
      bytes: new Uint8Array(await file.arrayBuffer())
    });
  }
  const loadedRoot = buildRootNodeFromFixture(entries);
  applyLoadedFolderRootNode(loadedRoot, folderName);
}

async function readFolderEntriesFromPath(folderPath){
  const tauriApi = getTauriFileApi();
  if(!tauriApi?.readDir || !tauriApi?.readFile){
    throw new Error("当前环境暂不支持读取文件夹。");
  }

  const entries = [];

  async function walkDirectory(currentPath, relativeBase=""){
    const children = await tauriApi.readDir(currentPath);
    if(children.length === 0 && relativeBase){
      entries.push({path: relativeBase, type: "dir"});
      return;
    }

    for(const child of children){
      const childPath = joinFsPath(currentPath, child.name);
      const childRelativePath = relativeBase ? `${relativeBase}/${child.name}` : child.name;
      if(child.isDirectory){
        await walkDirectory(childPath, childRelativePath);
        continue;
      }
      if(child.isFile){
        entries.push({
          path: childRelativePath,
          bytes: await tauriApi.readFile(childPath)
        });
      }
    }
  }

  await walkDirectory(folderPath);
  return entries;
}

async function loadPackageFromFolderPath(folderPath){
  rootZip = null;
  const normalizedFolderPath = String(folderPath || "");
  const folderName = getPathLeafName(normalizedFolderPath) || "theme-folder";
  const entries = await readFolderEntriesFromPath(normalizedFolderPath);
  const loadedRoot = buildRootNodeFromFixture(entries);
  applyLoadedFolderRootNode(loadedRoot, folderName, normalizedFolderPath);
}

async function readFolderEntriesFromHandle(directoryHandle){
  const entries = [];

  async function walkDirectory(handle, relativeBase=""){
    let hasChildren = false;
    for await (const [entryName, childHandle] of handle.entries()){
      hasChildren = true;
      const childRelativePath = relativeBase ? `${relativeBase}/${entryName}` : entryName;
      if(childHandle.kind === "directory"){
        await walkDirectory(childHandle, childRelativePath);
        continue;
      }
      if(childHandle.kind === "file"){
        const file = await childHandle.getFile();
        entries.push({
          path: childRelativePath,
          bytes: new Uint8Array(await file.arrayBuffer())
        });
      }
    }

    if(!hasChildren && relativeBase){
      entries.push({path: relativeBase, type: "dir"});
    }
  }

  await walkDirectory(directoryHandle);
  return entries;
}

async function loadPackageFromDirectoryHandle(directoryHandle){
  rootZip = null;
  const folderName = directoryHandle?.name || "theme-folder";
  const entries = await readFolderEntriesFromHandle(directoryHandle);
  const loadedRoot = buildRootNodeFromFixture(entries);
  applyLoadedFolderRootNode(loadedRoot, folderName, "", directoryHandle);
}

function isTestFixtureMode(){
  if(typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("fixture") === "demo" || window.location.hostname === "theme-editor.test";
}

if(typeof window !== "undefined" && isTestFixtureMode()){
  window.__themeEditorTest = {
    loadFixtureEntries,
    loadPackageFromArrayBuffer
  };
}

async function maybeLoadDemoFixture(){
  if(typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if(params.get("fixture") !== "demo") return;
  await loadFixtureEntries([
    {path:"description.xml", content:"<root>original</root>"},
    {path:"icons/readme.txt", content:"readme"},
    {path:"icons/config.json", content:'{"version":1}'},
    {path:"docs/notes.txt", content:"notes"}
  ], "sample.zip");
}

function openImportMenu(){
  document.getElementById("importMenu").hidden = false;
}

function closeImportMenu(){
  document.getElementById("importMenu").hidden = true;
}

async function maybeProceedToImport(){
  if(!rootNode || !hasPendingPackageChanges()) return true;
  const action = await appConfirmOpenNewPackage();
  return action === "open";
}

async function importPackageFromDesktop(){
  const tauriApi = getTauriFileApi();
  if(!tauriApi?.open || !tauriApi?.readFile) return false;

  const selectedPath = await tauriApi.open({
    title: "导入主题包",
    filters: [{name: "Theme Package", extensions: ["itz", "mtz", "zip"]}],
    multiple: false,
    fileAccessMode: "scoped"
  });
  if(!selectedPath || Array.isArray(selectedPath)) return true;
  await loadPackageFromArrayBuffer(await tauriApi.readFile(selectedPath), getPathLeafName(selectedPath) || "theme.itz", selectedPath);
  return true;
}

async function importPackageFromBrowser(){
  if(!supportsFileSystemAccess() || typeof window.showOpenFilePicker !== "function") return false;

  try{
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Theme Package",
        accept: {
          "application/zip": [".itz", ".mtz", ".zip"]
        }
      }]
    });
    if(!fileHandle) return true;
    const file = await fileHandle.getFile();
    await loadPackageFromArrayBuffer(await file.arrayBuffer(), file.name || "theme.itz", "", fileHandle);
    return true;
  }catch(err){
    if(isAbortError(err)) return true;
    throw err;
  }
}

async function importFolderFromDesktop(){
  const tauriApi = getTauriFileApi();
  if(!tauriApi?.open || !tauriApi?.readDir || !tauriApi?.readFile) return false;

  const selectedPath = await tauriApi.open({
    title: "导入文件夹",
    directory: true,
    multiple: false,
    recursive: true,
    fileAccessMode: "scoped"
  });
  if(!selectedPath || Array.isArray(selectedPath)) return true;
  await loadPackageFromFolderPath(selectedPath);
  return true;
}

async function importFolderFromBrowser(){
  if(!supportsFileSystemAccess() || typeof window.showDirectoryPicker !== "function") return false;

  try{
    const directoryHandle = await window.showDirectoryPicker({
      mode: "read"
    });
    if(!directoryHandle) return true;
    await loadPackageFromDirectoryHandle(directoryHandle);
    return true;
  }catch(err){
    if(isAbortError(err)) return true;
    throw err;
  }
}

document.getElementById("importBtn").addEventListener("click", (e)=>{
  e.stopPropagation();
  const menu = document.getElementById("importMenu");
  menu.hidden = !menu.hidden;
});

document.getElementById("importPackageBtn").addEventListener("click", async ()=>{
  closeImportMenu();
  if(!(await maybeProceedToImport())) return;
  try{
    if(await importPackageFromDesktop()) return;
    if(await importPackageFromBrowser()) return;
    const input = document.getElementById("openFile");
    input.value = "";
    input.click();
  }catch(err){
    await appAlert("打开失败：这可能不是 ZIP 结构的主题包，或文件已损坏。", {title:"打开失败"});
    console.error(err);
  }
});

document.getElementById("importFolderBtn").addEventListener("click", async ()=>{
  closeImportMenu();
  if(!(await maybeProceedToImport())) return;
  try{
    if(await importFolderFromDesktop()) return;
    if(await importFolderFromBrowser()) return;
    const input = document.getElementById("openFolder");
    input.value = "";
    input.click();
  }catch(err){
    await appAlert(err?.message || "打开文件夹失败，请重试。", {title:"打开失败"});
    console.error(err);
  }
});

document.addEventListener("click", (e)=>{
  const menuWrap = document.querySelector(".toolbar-menu-wrap");
  if(!menuWrap?.contains(e.target)){
    closeImportMenu();
  }
});

document.getElementById("openFile").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    await loadPackageFromArrayBuffer(await file.arrayBuffer(), file.name || "theme.itz");
  }catch(err){
    await appAlert("打开失败：这可能不是 ZIP 结构的主题包，或文件已损坏。", {title:"打开失败"});
    console.error(err);
  }
});

document.getElementById("openFolder").addEventListener("change", async (e)=>{
  const files = e.target.files;
  if(!files?.length) return;
  try{
    await loadPackageFromFolderFiles(files);
  }catch(err){
    await appAlert(err?.message || "打开文件夹失败，请重试。", {title:"打开失败"});
    console.error(err);
  }finally{
    e.target.value = "";
  }
});



function findNodeByPath(node, path){
  if(!node) return null;
  if(node.path === path) return node;
  if(node.children){
    for(const child of node.children){
      const found = findNodeByPath(child, path);
      if(found) return found;
    }
  }
  return null;
}

function hasSelectedAncestor(path, selectedPaths){
  const parts = path.split("/");
  while(parts.length > 1){
    parts.pop();
    const parentPath = parts.join("/");
    if(selectedPaths.has(parentPath)) return true;
  }
  return false;
}

async function deleteSelectedMaterials(){
  if(!rootNode || multiSelectedPaths.size === 0){
    await appAlert("请先按住 Shift 在左侧选择要删除的素材。", {title:"无法删除"});
    return;
  }
  if(!(await appConfirm("是否删除选中的素材？", {title:"删除确认", okClassName:"danger"}))) return;

  const selectedList = Array.from(multiSelectedPaths)
    .filter(path => path && !hasSelectedAncestor(path, multiSelectedPaths))
    .sort((a,b)=> b.length - a.length);

  for(const path of selectedList){
    const node = findNodeByPath(rootNode, path);
    if(node && node !== rootNode){
      node.deleted = true;
    }
  }

  if(selected && selected.deleted){
    selected = null;
    document.getElementById("currentPath").textContent = "已删除所选素材";
    document.getElementById("currentMeta").textContent = "请选择其他文件继续编辑";
    hideSelectionActions();
    document.getElementById("viewer").innerHTML = `<div class="drop">已删除选中的素材。</div>`;
  }

  multiSelectedPaths.clear();
  lastClickedPath = null;
  hideSelectionActions();
  updateSidebarContext();
  renderTree();
  showToast(`删除成功，已删除 ${selectedList.length} 个项目`);
}

document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelectedMaterials);

function clearCurrentPackage(){
  rootZip = null;
  rootNode = null;
  flatFiles = [];
  selected = null;
  multiSelectedPaths.clear();
  visibleNodeOrder = [];
  lastClickedPath = null;
  originalBaseName = "theme";
  originalExt = ".itz";
  originalFullName = "theme.itz";
  setImportSource();
  clearActiveTextEditor();

  document.getElementById("openFile").value = "";
  document.getElementById("openFolder").value = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("currentPath").textContent = "未打开文件";
  document.getElementById("currentMeta").textContent = "请选择一个主题包或文件夹开始";
  hideSelectionActions();
  updateSidebarContext();
  document.getElementById("viewer").innerHTML = `
      <div class="empty">
        <div>
          <b>使用说明</b><br>
          1. 点击左侧“导入”选择主题包或文件夹<br>
          2. 点击文本文件可编辑，图片可预览/替换<br>
          3. 需要覆盖当前来源时点击“保存”，另存新包时点击“导出”
        </div>
      </div>
    `;
  renderTree();
}

document.getElementById("clearBtn").addEventListener("click", async ()=>{
  if(!rootNode) return;
  if(!(await confirmLeaveWithUnsavedChanges())) return;
  if(await appConfirm("是否关闭当前主题包？", {title:"关闭主题包"})){
    clearCurrentPackage();
  }
});

document.getElementById("searchInput").addEventListener("input", renderTree);

function setExpandedRecursive(node, expanded){
  if(!node || !node.isDir) return;
  node.expanded = expanded;
  for(const child of node.children){
    setExpandedRecursive(child, expanded);
  }
}

document.getElementById("expandAllBtn").addEventListener("click", ()=>{
  if(!rootNode) return;
  setExpandedRecursive(rootNode, true);
  renderTree();
});

document.getElementById("collapseAllBtn").addEventListener("click", ()=>{
  if(!rootNode) return;
  setExpandedRecursive(rootNode, false);
  rootNode.expanded = true;
  renderTree();
});


document.getElementById("saveTextBtn").addEventListener("click", ()=>{
  saveCurrentTextChanges();
});

document.getElementById("formatTextBtn").addEventListener("click", async ()=>{
  if(!selected || selected.isDir) return;
  const editorConfig = getEditorConfigForNode(selected);
  if(!supportsFormatting(editorConfig)){
    await appAlert("当前文件类型暂不支持格式化。", {title:"无法格式化"});
    return;
  }
  try{
    const formattedText = formatEditorText(getActiveTextEditorValue(), editorConfig);
    setActiveTextEditorValue(formattedText);
    focusActiveTextEditor();
  }catch(err){
    await appAlert(err?.message || "格式化失败，请检查文件内容是否完整。", {title:"格式化失败"});
  }
});

document.getElementById("replaceInput").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(!file || !selected || selected.isDir) return;
  selected.data = new Uint8Array(await file.arrayBuffer());
  selected.modified = true;
  selected.zipChild = null;
  const replacedName = selected.name;
  updatePackageSaveButtonState();
  renderTree();
  openNode(selected);
  e.target.value = "";
  showToast(`替换成功：${replacedName}`);
});

document.getElementById("deleteBtn").addEventListener("click", async ()=>{
  if(!selected || selected === rootNode) return;
  if(!(await appConfirm(`确定删除：${selected.path}？`, {title:"删除确认", okClassName:"danger"}))) return;
  const deletedPath = selected.path;
  selected.deleted = true;
  multiSelectedPaths.delete(selected.path);
  const parent = selected.parent;
  selected = parent;
  updatePackageSaveButtonState();
  updateSidebarContext();
  renderTree();
  openNode(parent);
  showToast(`删除成功：${deletedPath}`);
});

document.getElementById("addTextBtn").addEventListener("click", ()=>{
  if(!rootNode){
    void appAlert("请先导入主题内容", {title:"无法新增"});
    return;
  }
  const baseDir = getTargetBaseDir();
  const initialPath = baseDir ? `${baseDir}/` : "";
  showModal("新增文本文件", async (path)=>{
    const normalizedPath = normalizePath(path);
    const existing = getExistingNodeAtPath(normalizedPath);
    if(existing){
      if(existing.isDir) throw new Error(`路径冲突：${normalizedPath} 已是文件夹，无法新增文本文件`);
      if(!(await appConfirm(`文件已存在，是否覆盖？\n\n${normalizedPath}`, {title:"覆盖确认"}))) return;
    }
    const node = createFileAtPath(normalizedPath, new TextEncoder().encode(""), {overwrite:true});
    multiSelectedPaths.clear();
    multiSelectedPaths.add(node.path);
    selected = node;
    sortTree(rootNode);
    renderTree();
    openNode(node);
    showToast(`已新增文本文件：${node.name}`);
  }, {
    description:"路径示例：description.xml、icons/config.json、preview/readme.txt",
    placeholder:"输入文件路径",
    value:initialPath
  });
});

document.getElementById("addFolderBtn").addEventListener("click", ()=>{
  if(!rootNode){
    void appAlert("请先导入主题内容", {title:"无法新增"});
    return;
  }
  const baseDir = getTargetBaseDir();
  const initialPath = baseDir ? `${baseDir}/` : "";
  showModal("新增文件夹", async (path)=>{
    const normalizedPath = normalizePath(path);
    const existing = getExistingNodeAtPath(normalizedPath);
    if(existing){
      if(!existing.isDir) throw new Error(`路径冲突：${normalizedPath} 已是文件，无法新增同名文件夹`);
      if(!(await appConfirm(`文件夹已存在，是否继续使用该文件夹？\n\n${normalizedPath}`, {title:"继续确认"}))) return;
    }
    const node = createDirAtPath(normalizedPath, {allowExisting:true});
    multiSelectedPaths.clear();
    multiSelectedPaths.add(node.path);
    selected = node;
    sortTree(rootNode);
    renderTree();
    openNode(node);
    showToast(`已新增文件夹：${node.name}`);
  }, {
    description:"路径示例：icons、preview/images、wallpaper/home",
    placeholder:"输入文件夹路径",
    value:initialPath
  });
});

document.getElementById("addFileInput").addEventListener("change", async (e)=>{
  if(!rootNode){
    await appAlert("请先导入主题内容", {title:"无法新增"});
    return;
  }
  const files = [...e.target.files];
  const baseDir = getTargetBaseDir();
  const filePlans = files.map(file => ({
    file,
    path: normalizePath(baseDir ? `${baseDir}/${file.name}` : file.name)
  }));
  const overwritePaths = [];

  for(const plan of filePlans){
    const existing = getExistingNodeAtPath(plan.path);
    if(!existing) continue;
    if(existing.isDir){
      await appAlert(`路径冲突：${plan.path} 已是文件夹，无法新增同名文件。`, {title:"新增失败"});
      e.target.value = "";
      return;
    }
    overwritePaths.push(plan.path);
  }

  if(overwritePaths.length > 0){
    const preview = overwritePaths.slice(0, 6).join("\n");
    const extraCount = overwritePaths.length - Math.min(overwritePaths.length, 6);
    const extraText = extraCount > 0 ? `\n... 以及另外 ${extraCount} 项` : "";
    const ok = await appConfirm(`以下文件已存在，是否覆盖？\n\n${preview}${extraText}`, {title:"覆盖确认"});
    if(!ok){
      e.target.value = "";
      return;
    }
  }

  for(const plan of filePlans){
    createFileAtPath(plan.path, new Uint8Array(await plan.file.arrayBuffer()), {overwrite:true});
  }
  sortTree(rootNode);
  updateSidebarContext();
  renderTree();
  e.target.value = "";
  showToast(`已新增 ${filePlans.length} 个文件`);
});

function getExistingNodeAtPath(path){
  path = normalizePath(path);
  const node = findNodeByPath(rootNode, path);
  if(node && !node.deleted) return node;
  return null;
}

function createFileAtPath(path, data, options={}){
  const {overwrite=false} = options;
  path = normalizePath(path);
  if(!path || path.endsWith("/")) throw new Error("无效路径");
  const parts = path.split("/");
  const name = parts.pop();
  const dir = ensureDir(rootNode, parts);
  const sibling = dir.children.find(c => c.name === name && !c.deleted);
  if(sibling && sibling.isDir){
    throw new Error(`路径冲突：${path} 已是文件夹，无法写入文件`);
  }
  let existing = sibling && !sibling.isDir ? sibling : null;
  if(existing){
    if(!overwrite) throw new Error(`文件已存在：${path}`);
    existing.data = data;
    existing.modified = true;
    updatePackageSaveButtonState();
    return existing;
  }
  const node = new FileNode({name, path, parent:dir, isDir:false, data});
  node.modified = true;
  dir.children.push(node);
  updatePackageSaveButtonState();
  return node;
}

function createDirAtPath(path, options={}){
  const {allowExisting=false} = options;
  path = normalizePath(path);
  if(!path || path.endsWith("/")) throw new Error("无效路径");
  const parts = path.split("/").filter(Boolean);
  let cur = rootNode;
  let created = false;

  for(const part of parts){
    const existing = cur.children.find(c => c.name === part && !c.deleted);
    if(existing){
      if(!existing.isDir) throw new Error(`路径冲突：${existing.path} 是文件，无法创建文件夹`);
      cur = existing;
      continue;
    }
    const dirPath = joinNodePath(cur.path, part);
    const node = new FileNode({name:part, path:dirPath, parent:cur, isDir:true});
    node.modified = true;
    cur.children.push(node);
    cur = node;
    created = true;
  }

  if(!created && !allowExisting) throw new Error("该文件夹已存在");
  if(created) updatePackageSaveButtonState();
  return cur;
}

function replacePathPrefix(value, oldPrefix, newPrefix){
  if(!value) return value;
  if(value === oldPrefix) return newPrefix;
  if(value.startsWith(`${oldPrefix}/`)) return `${newPrefix}${value.slice(oldPrefix.length)}`;
  return value;
}

function syncNodePathRecursive(node, oldPrefix, newPrefix){
  node.path = replacePathPrefix(node.path, oldPrefix, newPrefix);
  if(node.sourceZipPath){
    node.sourceZipPath = replacePathPrefix(node.sourceZipPath, oldPrefix, newPrefix);
  }
  if(node.archiveFileNode){
    node.archiveFileNode.name = node.name;
    node.archiveFileNode.path = node.path;
    if(node.archiveFileNode.sourceZipPath){
      node.archiveFileNode.sourceZipPath = replacePathPrefix(node.archiveFileNode.sourceZipPath, oldPrefix, newPrefix);
    }
  }
  for(const child of node.children){
    syncNodePathRecursive(child, oldPrefix, newPrefix);
  }
}

function renameNode(node, newName){
  const trimmed = newName.trim();
  if(!trimmed) throw new Error("名称不能为空");
  if(trimmed.includes("/")) throw new Error("名称中不能包含 /");
  if(!node || node === rootNode) throw new Error("当前项目不支持重命名");
  const siblingConflict = node.parent.children.find(c => c !== node && !c.deleted && c.name === trimmed);
  if(siblingConflict) throw new Error("同级目录下已存在同名项目");
  if(trimmed === node.name) return node;

  const oldPath = node.path;
  const newPath = joinNodePath(node.parent?.path || "", trimmed);
  rememberSourcePathDeletion(oldPath);
  node.name = trimmed;
  node.modified = true;
  if(node.parent) node.parent.modified = true;
  syncNodePathRecursive(node, oldPath, newPath);

  multiSelectedPaths.delete(oldPath);
  multiSelectedPaths.add(node.path);
  if(lastClickedPath === oldPath) lastClickedPath = node.path;
  updatePackageSaveButtonState();

  return node;
}

document.getElementById("renameBtn").addEventListener("click", ()=>{
  if(!selected || selected === rootNode || multiSelectedPaths.size > 1) return;
  const target = selected;
  const targetLabel = target.isDir ? "文件夹" : "文件";
  showModal(`重命名${targetLabel}`, async (value)=>{
    renameNode(target, value);
    sortTree(rootNode);
    renderTree();
    openNode(target);
    showToast(`已重命名为 ${target.name}`);
  }, {
    description:`当前路径：${target.path}`,
    placeholder:`输入新的${targetLabel}名称`,
    value:target.name,
    selectAll:true
  });
});

function showModal(title, onOk, options={}){
  const {
    description = "路径示例：description.xml、icons/config.json、preview/readme.txt",
    placeholder = "输入文件路径",
    value = "",
    selectAll = false
  } = options;
  void (async ()=>{
    const result = await runModal({
      title,
      description,
      placeholder,
      value,
      selectAll,
      showInput: true
    });
    if(!result.confirmed) return;
    if(!result.value) return;
    try{
      await onOk(result.value);
    }catch(err){
      await appAlert(err?.message || "操作失败，请重试。", {title:"操作失败"});
    }
  })();
}

async function zipDirFromNode(dirNode){
  const ZipLib = ensureJsZipAvailable();
  const zip = new ZipLib();
  async function add(node, base=""){
    if(node.deleted) return;
    if(node.isDir){
      if(node.isArchiveContainer){
        const archiveData = await zipDirFromNode(node);
        zip.file(base + node.name, archiveData);
      }else{
        const nextBase = node === dirNode ? "" : `${base}${node.name}/`;
        if(node !== dirNode) zip.folder(base + node.name);
        for(const child of node.children) await add(child, nextBase);
      }
    }else{
      zip.file(base + node.name, node.data);
    }
  }
  for(const child of dirNode.children) await add(child, "");
  return await zip.generateAsync({
    type:"uint8array",
    compression:"DEFLATE",
    compressionOptions:{level:6}
  });
}

function collectDeletedTreePaths(node, list=[]){
  if(!node?.children) return list;
  for(const child of node.children){
    if(child.deleted){
      list.push({path: child.path, isDir: child.isDir});
      continue;
    }
    collectDeletedTreePaths(child, list);
  }
  return list;
}

async function collectFolderWriteOperations(node, dirs=[], files=[]){
  if(!node || node.deleted) return {dirs, files};

  if(node !== rootNode){
    if(node.isDir){
      if(node.isArchiveContainer){
        files.push({
          path: node.path,
          data: await zipDirFromNode(node)
        });
        return {dirs, files};
      }
      dirs.push(node.path);
    }else{
      files.push({
        path: node.path,
        data: node.data
      });
    }
  }

  for(const child of node.children || []){
    await collectFolderWriteOperations(child, dirs, files);
  }
  return {dirs, files};
}

async function saveCurrentFolderSourceToPath(folderPath){
  const tauriApi = getTauriFileApi();
  if(!tauriApi?.mkdir || !tauriApi?.remove || !tauriApi?.writeFile){
    throw new Error("当前环境暂不支持直接保存回文件夹。");
  }

  const deletedTreePaths = collectDeletedTreePaths(rootNode).map(item => item.path);
  const removalPaths = Array.from(new Set([...pendingSourceDeletePaths, ...deletedTreePaths]))
    .sort((a, b)=> b.length - a.length);

  for(const relativePath of removalPaths){
    const targetPath = joinFsPath(folderPath, relativePath);
    try{
      await tauriApi.remove(targetPath, {recursive: true});
    }catch(err){
      const message = String(err?.message || err || "");
      if(!/not found|does not exist|no such file/i.test(message)){
        throw err;
      }
    }
  }

  const {dirs, files} = await collectFolderWriteOperations(rootNode);
  dirs.sort((a, b)=> a.split("/").length - b.split("/").length);

  for(const relativeDirPath of dirs){
    await tauriApi.mkdir(joinFsPath(folderPath, relativeDirPath), {recursive: true});
  }

  for(const fileEntry of files){
    await tauriApi.writeFile(joinFsPath(folderPath, fileEntry.path), fileEntry.data);
  }
}

async function getDirectoryHandleForRelativePath(rootHandle, relativeDirPath, create=false){
  let currentHandle = rootHandle;
  const segments = normalizePath(relativeDirPath).split("/").filter(Boolean);
  for(const segment of segments){
    currentHandle = await currentHandle.getDirectoryHandle(segment, {create});
  }
  return currentHandle;
}

async function removeEntryFromDirectoryHandle(rootHandle, relativePath){
  const segments = normalizePath(relativePath).split("/").filter(Boolean);
  if(segments.length === 0) return;

  const entryName = segments.pop();
  let parentHandle = rootHandle;
  for(const segment of segments){
    try{
      parentHandle = await parentHandle.getDirectoryHandle(segment);
    }catch(err){
      if(err?.name === "NotFoundError") return;
      throw err;
    }
  }

  try{
    await parentHandle.removeEntry(entryName, {recursive: true});
  }catch(err){
    if(err?.name === "NotFoundError") return;
    throw err;
  }
}

async function writeFileToDirectoryHandle(rootHandle, relativePath, data){
  const normalizedPath = normalizePath(relativePath);
  const parts = normalizedPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  const parentHandle = parts.length > 0
    ? await getDirectoryHandleForRelativePath(rootHandle, parts.join("/"), true)
    : rootHandle;
  const fileHandle = await parentHandle.getFileHandle(fileName, {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function saveCurrentFolderSourceToHandle(directoryHandle){
  if(!(await ensureFileSystemHandlePermission(directoryHandle, "readwrite"))){
    throw new Error("未获得文件夹写入权限，无法保存。");
  }

  const deletedTreePaths = collectDeletedTreePaths(rootNode).map(item => item.path);
  const removalPaths = Array.from(new Set([...pendingSourceDeletePaths, ...deletedTreePaths]))
    .sort((a, b)=> b.length - a.length);

  for(const relativePath of removalPaths){
    await removeEntryFromDirectoryHandle(directoryHandle, relativePath);
  }

  const {dirs, files} = await collectFolderWriteOperations(rootNode);
  dirs.sort((a, b)=> a.split("/").length - b.split("/").length);

  for(const relativeDirPath of dirs){
    await getDirectoryHandleForRelativePath(directoryHandle, relativeDirPath, true);
  }

  for(const fileEntry of files){
    await writeFileToDirectoryHandle(directoryHandle, fileEntry.path, fileEntry.data);
  }
}

async function saveCurrentPackageToHandle(fileHandle){
  if(!(await ensureFileSystemHandlePermission(fileHandle, "readwrite"))){
    throw new Error("未获得文件写入权限，无法保存。");
  }
  const data = await zipDirFromNode(rootNode);
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function saveCurrentSource(){
  if(!rootNode){
    await appAlert("请先导入主题内容", {title:"无法保存"});
    return false;
  }
  if(!canSaveCurrentSource()){
    await appAlert("当前导入来源不支持直接保存回原位置，请继续使用“导出”。", {title:"无法保存"});
    return false;
  }

  if(hasUnsavedTextChanges()){
    saveCurrentTextChanges();
  }

  document.getElementById("viewer").innerHTML = `<div class="drop">正在保存，请稍候...</div>`;

  try{
    if(importSourceKind === "package"){
      if(importSourceHandle){
        await saveCurrentPackageToHandle(importSourceHandle);
      }else{
        const tauriApi = getTauriFileApi();
        if(!tauriApi?.writeFile) throw new Error("当前环境暂不支持直接保存。");
        const data = await zipDirFromNode(rootNode);
        await tauriApi.writeFile(importSourcePath, data);
      }
    }else if(importSourceKind === "folder"){
      if(importSourceHandle){
        await saveCurrentFolderSourceToHandle(importSourceHandle);
      }else{
        await saveCurrentFolderSourceToPath(importSourcePath);
      }
    }else{
      throw new Error("当前导入来源暂不支持直接保存。");
    }

    markCurrentPackageAsExported();
    recordOperation("save");
    renderOperationSuccess("保存完成", getImportSourceLabel());
    return true;
  }catch(err){
    console.error(err);
    await appAlert(err?.message || "保存失败，请查看控制台错误。", {title:"保存失败"});
    return false;
  }
}

async function exportCurrentPackage(){
  if(!rootNode){
    await appAlert("请先导入主题内容", {title:"无法导出"});
    return false;
  }
  document.getElementById("viewer").innerHTML = `<div class="drop">正在重新打包，请稍候...</div>`;
  try{
    const data = await zipDirFromNode(rootNode);
    const exportName = `${originalBaseName}_modified${originalExt}`;
    const tauriApi = getTauriFileApi();

    if(tauriApi){
      const filePath = await tauriApi.save({
        title: "导出主题包",
        defaultPath: exportName
      });

      if(!filePath){
        document.getElementById("viewer").innerHTML = `<div class="drop">已取消导出。</div>`;
        return false;
      }

      await tauriApi.writeFile(filePath, data);
      markCurrentPackageAsExported();
      recordOperation("export");
      renderOperationSuccess("导出完成", filePath);
      return true;
    }

    if(window.themeDesktop?.isDesktopApp && typeof window.themeDesktop.saveFile === "function"){
      const result = await window.themeDesktop.saveFile({
        defaultPath: exportName,
        bytes: data
      });

      if(result?.canceled){
        document.getElementById("viewer").innerHTML = `<div class="drop">已取消导出。</div>`;
        return false;
      }

      const savedLabel = result?.filePath || exportName;
      markCurrentPackageAsExported();
      recordOperation("export");
      renderOperationSuccess("导出完成", savedLabel);
      return true;
    }

    const blob = new Blob([data], {type:"application/octet-stream"});
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = exportName;
    a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
    markCurrentPackageAsExported();
    recordOperation("export");
    renderOperationSuccess("导出完成", a.download);
    return true;
  }catch(err){
    console.error(err);
    await appAlert(err?.message || "导出失败，请查看控制台错误。", {title:"导出失败"});
    return false;
  }
}

document.getElementById("exportBtn").addEventListener("click", async ()=>{
  await exportCurrentPackage();
});

document.getElementById("savePackageBtn").addEventListener("click", async ()=>{
  await saveCurrentSource();
});

document.getElementById("themeToggle").addEventListener("click", toggleTheme);
initTheme();
updateSidebarContext();
renderTree();
void maybeLoadDemoFixture();

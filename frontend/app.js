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

function ensureJsZipAvailable(){
  if(typeof JSZip === "undefined"){
    throw new Error("JSZip 未加载，请先执行 npm install，或检查桌面应用是否完整打包。");
  }
  return JSZip;
}

function getTauriSaveApi(){
  if(typeof window === "undefined") return null;
  const tauri = window.__TAURI__;
  if(!tauri?.dialog?.save || !tauri?.fs?.writeFile) return null;
  return {
    save: tauri.dialog.save,
    writeFile: tauri.fs.writeFile
  };
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
    okClassName = "primary"
  } = options;

  const mask = document.getElementById("modalMask");
  const input = document.getElementById("modalPath");
  const titleEl = document.getElementById("modalTitle");
  const descEl = document.getElementById("modalDesc");
  const okBtn = document.getElementById("modalOk");
  const cancelBtn = document.getElementById("modalCancel");
  const modal = mask.querySelector(".modal");

  return new Promise(resolve => {
    const cleanup = (result)=>{
      mask.style.display = "none";
      okBtn.onclick = null;
      cancelBtn.onclick = null;
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

    modal.onclick = ev => ev.stopPropagation();
    mask.onclick = ()=> cleanup({confirmed:false, value:""});
    cancelBtn.onclick = ()=> cleanup({confirmed:false, value:input.value.trim()});
    input.onkeydown = ev => {
      if(ev.key === "Escape"){
        ev.preventDefault();
        cleanup({confirmed:false, value:input.value.trim()});
        return;
      }
      if(showInput && ev.key === "Enter"){
        ev.preventDefault();
        okBtn.click();
      }
    };
    okBtn.onclick = ()=> cleanup({confirmed:true, value:input.value.trim()});

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
      autoCompletionTrigger: XML_COMPLETION_TRIGGER,
      autoCloseTags: true,
      matchTags: {bothTags:true}
    };
  }
  if(JSON_EXT.test(fileName)){
    return {
      label: "JSON",
      mode: {name:"javascript", json:true},
      completionKind: "text"
    };
  }
  if(JS_EXT.test(fileName)){
    return {
      label: "JavaScript",
      mode: "text/javascript",
      completionKind: "javascript"
    };
  }
  if(CSS_EXT.test(fileName)){
    return {
      label: "CSS",
      mode: "text/css",
      completionKind: "css"
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

function renderPlainTextEditor(viewer, text){
  const editor = document.createElement("textarea");
  editor.id = "editor";
  editor.spellcheck = false;
  editor.wrap = "off";
  editor.value = text;
  viewer.appendChild(editor);
  setActiveTextEditor({
    getValue: ()=> editor.value
  });
}

function renderCodeEditor(viewer, text, editorConfig){
  if(typeof CodeMirror === "undefined"){
    renderPlainTextEditor(viewer, text);
    return;
  }

  const shell = document.createElement("div");
  shell.className = "code-editor-shell";

  const tip = document.createElement("div");
  tip.className = "code-editor-tip";
  tip.textContent = `${editorConfig.label} 代码编辑 · 自动高亮 · Ctrl/Cmd + Space 联想`;
  shell.appendChild(tip);

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

  setActiveTextEditor({
    getValue: ()=> editor.getValue(),
    destroy: ()=>{
      if(typeof editor.closeHint === "function"){
        editor.closeHint();
      }
    }
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
  const exportBtn = document.getElementById("exportBtn");
  const clearBtn = document.getElementById("clearBtn");
  const mainHeader = document.getElementById("mainHeader");
  const openFileLabel = document.getElementById("openFileLabel");

  exportBtn.style.display = hasPackage ? "inline-block" : "none";
  clearBtn.style.display = hasPackage ? "inline-block" : "none";
  treeWorkspace.style.display = hasPackage ? "flex" : "none";
  treeEmptyState.style.display = hasPackage ? "none" : "flex";
  mainHeader.style.display = hasPackage ? "flex" : "none";
  openFileLabel.classList.toggle("primary", !hasPackage);
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
    tree.innerHTML = `<div class="small" style="padding:10px">尚未打开主题包文件</div>`;
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

  el.onclick = (ev)=>{
    ev.stopPropagation();

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
    renderCodeEditor(viewer, text, getEditorConfigForNode(node));
    document.getElementById("saveTextBtn").style.display = "";
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

function applyLoadedRootNode(loadedRoot, fileName="theme.itz"){
  setOriginalFileName(fileName);
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

async function loadPackageFromArrayBuffer(buffer, fileName="theme.itz"){
  setOriginalFileName(fileName);
  log("读取主题包中，请稍候...");
  const ZipLib = ensureJsZipAvailable();
  rootZip = await ZipLib.loadAsync(buffer);
  const loadedRoot = await buildTreeFromZip(rootZip);
  applyLoadedRootNode(loadedRoot, fileName);
}

async function loadFixtureEntries(entries, fileName="theme.itz"){
  rootZip = null;
  const loadedRoot = buildRootNodeFromFixture(entries);
  applyLoadedRootNode(loadedRoot, fileName);
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
  clearActiveTextEditor();

  document.getElementById("openFile").value = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("currentPath").textContent = "未打开文件";
  document.getElementById("currentMeta").textContent = "请选择一个主题包文件开始";
  hideSelectionActions();
  updateSidebarContext();
  document.getElementById("viewer").innerHTML = `
      <div class="empty">
        <div>
          <b>使用说明</b><br>
          1. 点击左侧“打开主题包”选择主题包<br>
          2. 点击文本文件可编辑，图片可预览/替换<br>
          3. 修改完成后点击“导出主题包”
        </div>
      </div>
    `;
  renderTree();
}

document.getElementById("clearBtn").addEventListener("click", async ()=>{
  if(!rootNode) return;
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
  if(!selected || selected.isDir) return;
  const text = getActiveTextEditorValue();
  selected.data = new TextEncoder().encode(text);
  selected.modified = true;
  renderTree();
  document.getElementById("currentMeta").textContent = `${bytesToSize(selected.data?.length)} · 已修改`;
});

document.getElementById("replaceInput").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(!file || !selected || selected.isDir) return;
  selected.data = new Uint8Array(await file.arrayBuffer());
  selected.modified = true;
  selected.zipChild = null;
  renderTree();
  openNode(selected);
  e.target.value = "";
});

document.getElementById("deleteBtn").addEventListener("click", async ()=>{
  if(!selected || selected === rootNode) return;
  if(!(await appConfirm(`确定删除：${selected.path}？`, {title:"删除确认", okClassName:"danger"}))) return;
  selected.deleted = true;
  multiSelectedPaths.delete(selected.path);
  const parent = selected.parent;
  selected = parent;
  renderTree();
  openNode(parent);
});

document.getElementById("addTextBtn").addEventListener("click", ()=>{
  if(!rootNode){
    void appAlert("请先打开主题包文件", {title:"无法新增"});
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
  }, {
    description:"路径示例：description.xml、icons/config.json、preview/readme.txt",
    placeholder:"输入文件路径",
    value:initialPath
  });
});

document.getElementById("addFolderBtn").addEventListener("click", ()=>{
  if(!rootNode){
    void appAlert("请先打开主题包文件", {title:"无法新增"});
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
  }, {
    description:"路径示例：icons、preview/images、wallpaper/home",
    placeholder:"输入文件夹路径",
    value:initialPath
  });
});

document.getElementById("addFileInput").addEventListener("change", async (e)=>{
  if(!rootNode){
    await appAlert("请先打开主题包文件", {title:"无法新增"});
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
    return existing;
  }
  const node = new FileNode({name, path, parent:dir, isDir:false, data});
  node.modified = true;
  dir.children.push(node);
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
  node.name = trimmed;
  node.modified = true;
  if(node.parent) node.parent.modified = true;
  syncNodePathRecursive(node, oldPath, newPath);

  multiSelectedPaths.delete(oldPath);
  multiSelectedPaths.add(node.path);
  if(lastClickedPath === oldPath) lastClickedPath = node.path;

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

document.getElementById("exportBtn").addEventListener("click", async ()=>{
  if(!rootNode){
    await appAlert("请先打开主题包文件", {title:"无法导出"});
    return;
  }
  document.getElementById("viewer").innerHTML = `<div class="drop">正在重新打包，请稍候...</div>`;
  try{
    const data = await zipDirFromNode(rootNode);
    const exportName = `${originalBaseName}_modified${originalExt}`;
    const tauriApi = getTauriSaveApi();

    if(tauriApi){
      const filePath = await tauriApi.save({
        title: "导出主题包",
        defaultPath: exportName
      });

      if(!filePath){
        document.getElementById("viewer").innerHTML = `<div class="drop">已取消导出。</div>`;
        return;
      }

      await tauriApi.writeFile(filePath, data);
      document.getElementById("viewer").innerHTML = `<div class="drop">导出完成：${escapeHtml(filePath)}</div>`;
      return;
    }

    if(window.themeDesktop?.isDesktopApp && typeof window.themeDesktop.saveFile === "function"){
      const result = await window.themeDesktop.saveFile({
        defaultPath: exportName,
        bytes: data
      });

      if(result?.canceled){
        document.getElementById("viewer").innerHTML = `<div class="drop">已取消导出。</div>`;
        return;
      }

      const savedLabel = result?.filePath || exportName;
      document.getElementById("viewer").innerHTML = `<div class="drop">导出完成：${escapeHtml(savedLabel)}</div>`;
      return;
    }

    const blob = new Blob([data], {type:"application/octet-stream"});
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = exportName;
    a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
    document.getElementById("viewer").innerHTML = `<div class="drop">导出完成：${escapeHtml(a.download)}</div>`;
  }catch(err){
    console.error(err);
    await appAlert(err?.message || "导出失败，请查看控制台错误。", {title:"导出失败"});
  }
});

document.getElementById("themeToggle").addEventListener("click", toggleTheme);
initTheme();
updateSidebarContext();
renderTree();
void maybeLoadDemoFixture();

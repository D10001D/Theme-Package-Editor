const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const JSZip = require('jszip');
const source = fs.readFileSync('frontend/app.js', 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
function setup() {
  const ctx = vm.createContext({
    Uint8Array, JSZip, rootZip:null, rootNode:null,
    originalBaseName:'old', originalFullName:'old.theme', originalExt:'.theme',
    multiSelectedPaths:new Set(), visibleNodeOrder:[], selected:null, lastClickedPath:null,
    ZIP_MAGIC:[0x50,0x4b,0x03,0x04],
    ensureJsZipAvailable:()=>JSZip,
    hideSelectionActions(){}, updateSidebarContext(){}, renderTree(){}, openNode(){},
    setImportSource(kind, path, handle, label) { ctx.importSource = {kind,path,handle,label}; },
    isAbortError:error=>error?.name === 'AbortError', window:{}
  });
  vm.runInContext([
    section('class FileNode {','function log('),
    section('async function isZipData(', 'function isPackageRootNode('),
    section('function ensureDir(', 'function collectFiles('),
    section('function sortTree(', 'function renderTree('),
    section('function setExpandedRecursive(', 'document.getElementById("expandAllBtn")'),
    section('function setOriginalFileName(', 'function applyLoadedFolderRootNode('),
    section('async function loadPackageFromArrayBuffer(', 'async function loadFixtureEntries('),
    section('async function zipDirFromNode(', 'function collectDeletedTreePaths('),
    section('function getPathLeafName(', 'function joinFsPath('),
    section('async function importFileFromDesktop(', 'async function importFolderFromDesktop(')
  ].join('\n'),ctx);
  return ctx;
}
async function fixture() {
  const zip = new JSZip();
  zip.file('assets/config.xml','<config />');
  zip.folder('assets/empty');
  return zip.generateAsync({type:'uint8array'});
}

test('content-based import accepts theme extensions, arbitrary extensions and no extension; roundtrip preserves contents', async()=>{
  const data = await fixture();
  for(const name of ['sample.itz','sample.mtz','sample.theme','sample.zip','icons','archive.custom']) {
    const ctx = setup();
    await ctx.loadPackageFromArrayBuffer(data,name,`/input/${name}`);
    assert.equal(ctx.originalFullName,name);
    assert.equal(ctx.importSource.path,`/input/${name}`);
    assert.equal(ctx.rootNode.children[0].name,'assets');
    const result = await JSZip.loadAsync(await ctx.zipDirFromNode(ctx.rootNode));
    assert.equal(await result.file('assets/config.xml').async('string'),'<config />');
    assert.ok(result.files['assets/empty/'].dir);
    if(name === 'icons') {
      assert.equal(ctx.originalExt,'');
      assert.equal(`${ctx.originalBaseName}_modified${ctx.originalExt}`,'icons_modified');
    }
  }
});

test('invalid imports preserve the loaded project, original name, selection and source', async()=>{
  const ctx = setup();
  await ctx.loadPackageFromArrayBuffer(await fixture(),'original.theme','/input/original.theme');
  const previous = {root:ctx.rootNode,zip:ctx.rootZip,selection:ctx.selected,source:ctx.importSource};
  ctx.rootNode.children[0].modified = true;
  for(const bytes of [Buffer.from('plain text'),Buffer.from([0x50,0x4b,0x03,0x04])]) {
    await assert.rejects(ctx.loadPackageFromArrayBuffer(bytes,'broken','/input/broken'));
    assert.equal(ctx.rootNode,previous.root);
    assert.equal(ctx.rootZip,previous.zip);
    assert.equal(ctx.selected,previous.selection);
    assert.equal(ctx.importSource,previous.source);
    assert.equal(ctx.originalFullName,'original.theme');
    assert.equal(ctx.rootNode.children[0].modified,true);
  }
});

test('desktop and browser pickers allow extensionless files and retain source for saving', async()=>{
  const data = await fixture();
  const ctx = setup();
  ctx.getTauriFileApi = ()=>({
    open:async options=>{
      assert.equal(options.filters,undefined);
      assert.equal(options.multiple,false);
      return '/input/icons';
    },
    readFile:async()=>data
  });
  assert.equal(await ctx.importFileFromDesktop(),true);
  assert.equal(ctx.importSource.path,'/input/icons');
  const handle = {getFile:async()=>({name:'icons',arrayBuffer:async()=>data})};
  ctx.window.showOpenFilePicker = async options=>{
    assert.equal(options.types,undefined);
    return [handle];
  };
  assert.equal(await ctx.importFileFromBrowser(),true);
  assert.equal(ctx.importSource.handle,handle);
  const previous = ctx.rootNode;
  ctx.getTauriFileApi = ()=>({open:async()=>null,readFile:async()=>{throw new Error('Unexpected read');}});
  await ctx.importFileFromDesktop();
  ctx.window.showOpenFilePicker = async()=>{throw {name:'AbortError'};};
  await ctx.importFileFromBrowser();
  assert.equal(ctx.rootNode,previous);
});

test('empty ZIP without an extension is a valid import', async()=>{
  const ctx = setup();
  await ctx.loadPackageFromArrayBuffer(await new JSZip().generateAsync({type:'uint8array'}),'empty');
  assert.equal(ctx.rootNode.children.length,0);
  assert.equal(ctx.originalExt,'');
});

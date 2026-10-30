const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const JSZip = require('jszip');
const source = require('node:fs').readFileSync('frontend/app.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end));}
function context(){
  const ctx = vm.createContext({
    Uint8Array, Map, Set, ZIP_MAGIC:[0x50,0x4b,0x03,0x04],
    window:{}, addItemsBusy:false, pendingFolderImport:null,
    document:{getElementById:()=>({disabled:false})},
    getAddFileTargetBaseDir:()=>ctx.selected.path,
    isAbortError:err=>err?.name === 'AbortError',
    appAlert:async message=>{throw new Error(message);},
    getTauriFileApi:()=>({
      readDir:async p=>(await fs.readdir(p,{withFileTypes:true})).map(e=>({name:e.name,isDirectory:e.isDirectory(),isFile:e.isFile()})),
      readFile:async p=>new Uint8Array(await fs.readFile(p))
    }),
    ensureJsZipAvailable:()=>JSZip,
    updatePackageSaveButtonState(){},updateSidebarContext(){},renderTree(){},openNode(){},showToast(){},
    appConfirm:async()=>true
  });
  vm.runInContext([
    section('class FileNode {','function log('),
    section('async function isZipData(', 'function isPackageRootNode('),
    section('function joinFsPath(', 'function supportsFileSystemAccess('),
    section('function getPathLeafName(', 'function joinFsPath('),
    section('function getFolderInputRootName(', 'function applyTheme('),
    section('function ensureDir(', 'function collectFiles('),
    section('function sortTree(', 'function renderTree('),
    section('function isSystemMetadataEntry(', 'async function loadPackageFromFolderPath('),
    section('async function readFolderEntriesFromHandle(', 'async function loadPackageFromDirectoryHandle('),
    section('function findNodeByPath(', 'function hasSelectedAncestor('),
    section('async function addPickedEntries(', 'document.getElementById("addFileInput").addEventListener("change"'),
    section('async function addFolderEntriesToCurrent(', 'document.getElementById("addFolderImportBtn").addEventListener'),
    section('function getExistingNodeAtPath(', 'function replacePathPrefix('),
    section('async function zipDirFromNode(', 'function collectDeletedTreePaths('),
    section('async function collectFolderWriteOperations(', 'async function saveCurrentFolderSourceToPath('),
    'var rootNode = new FileNode({name:"root",path:"",isDir:true}); var selected = rootNode;'
  ].join('\n'),ctx);
  return ctx;
}
test('real 12-level folder survives import, deleted-name reuse, and ZIP export',async()=>{
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'theme-import-'));
  try{
    const expected = [];
    let relative = '';
    for(let i=1;i<=12;i++){
      relative = path.join(relative,`目录${i}`);
      await fs.mkdir(path.join(tmp,relative),{recursive:true});
      const name = `${relative}/file${i}.txt`;
      await fs.writeFile(path.join(tmp,name),`content-${i}`);
      expected.push([name,`content-${i}`]);
    }
    await fs.mkdir(path.join(tmp,relative,'empty'));
    await fs.writeFile(path.join(tmp,'.DS_Store'),'metadata');
    const ctx = context();
    // Reproduce the old deleted-node collision at a parent and nested folder.
    vm.runInContext('createDirAtPath("target/imported/目录1").parent.deleted = true;',ctx);
    const entries = await ctx.readFolderEntriesFromPath(tmp);
    await ctx.addPickedEntries([{path:'target/imported',type:'dir'}, ...entries.map(e=>({...e,path:`target/imported/${e.path}`}))],ctx.rootNode);
    for(const [name,content] of expected){
      const node = ctx.findNodeByPath(ctx.rootNode,`target/imported/${name}`);
      assert.ok(node,`missing tree node: ${name}`);
      assert.equal(Buffer.from(node.data).toString(),content);
      for(let parent=node.parent;parent;parent=parent.parent) assert.equal(parent.deleted,false);
    }
    const archive = await JSZip.loadAsync(await ctx.zipDirFromNode(ctx.rootNode));
    for(const [name,content] of expected) assert.equal(await archive.file(`target/imported/${name}`).async('string'),content);
    assert.ok(archive.files[`target/imported/${relative}/empty/`]?.dir);
    assert.equal(archive.file('target/imported/.DS_Store'),null);
    assert.equal(Object.values(archive.files).filter(e=>!e.dir).length,12);
  }finally{
    await fs.rm(tmp,{recursive:true,force:true});
  }
});

test('dedicated folder import adds the folder itself inside an archive without replacing the project',async()=>{
  const ctx = context();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'theme-add-folder-'));
  try{
    const folderPath = path.join(tmp,'assets');
    await fs.mkdir(path.join(folderPath,'nested','empty'),{recursive:true});
    await fs.writeFile(path.join(folderPath,'nested','file.txt'),'new');
    await fs.writeFile(path.join(folderPath,'.DS_Store'),'ignored');
    const inner = new JSZip();
    inner.file('config.xml','<config />');
    await fs.writeFile(path.join(folderPath,'no-extension'),await inner.generateAsync({type:'uint8array'}));
    await ctx.addPickedEntries([{path:'icons',bytes:await new JSZip().generateAsync({type:'uint8array'})}],ctx.rootNode);
    ctx.selected = ctx.findNodeByPath(ctx.rootNode,'icons');
    const originalRoot = ctx.rootNode;
    const api = ctx.getTauriFileApi();
    const button = {disabled:false};
    ctx.document.getElementById = ()=>button;
    ctx.getTauriFileApi = ()=>({...api,open:async options=>{
      assert.equal(options.directory,true);
      assert.equal(options.recursive,true);
      assert.equal(options.multiple,false);
      return folderPath;
    }});
    await ctx.importFolderIntoCurrent();
    assert.equal(ctx.rootNode,originalRoot);
    assert.ok(ctx.findNodeByPath(ctx.rootNode,'icons/assets/nested/empty'));
    assert.equal(Buffer.from(ctx.findNodeByPath(ctx.rootNode,'icons/assets/nested/file.txt').data).toString(),'new');
    assert.ok(ctx.findNodeByPath(ctx.rootNode,'icons/assets/no-extension/config.xml'));
    assert.equal(ctx.findNodeByPath(ctx.rootNode,'icons/assets/.DS_Store'),null);
    assert.equal(ctx.addItemsBusy,false);
    assert.equal(button.disabled,false);
    const packed = await JSZip.loadAsync(await ctx.zipDirFromNode(ctx.rootNode));
    const icons = await JSZip.loadAsync(await packed.file('icons').async('uint8array'));
    assert.ok(icons.files['assets/nested/empty/'].dir);
    assert.equal(await icons.file('assets/nested/file.txt').async('string'),'new');
    // Importing an entirely empty folder still creates its own node.
    await fs.mkdir(path.join(tmp,'empty'));
    ctx.getTauriFileApi = ()=>({...api,open:async()=>path.join(tmp,'empty')});
    await ctx.importFolderIntoCurrent();
    assert.equal(ctx.findNodeByPath(ctx.rootNode,'icons/empty').children.length,0);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('folder import cancellation, read errors and project changes do not partially add entries',async()=>{
  const ctx = context();
  const originalRoot = ctx.rootNode;
  ctx.getTauriFileApi = ()=>({open:async()=>null});
  await ctx.importFolderIntoCurrent();
  assert.equal(originalRoot.children.length,0);
  const errors = [];
  ctx.appAlert = async message=>errors.push(message);
  ctx.getTauriFileApi = ()=>({
    open:async()=>'/source/assets',
    readDir:async()=>[{name:'a.txt',isFile:true},{name:'b.txt',isFile:true}],
    readFile:async name=>{if(name.endsWith('b.txt')) throw new Error('read failed'); return Buffer.from('a');}
  });
  await ctx.importFolderIntoCurrent();
  assert.equal(originalRoot.children.length,0);
  assert.match(errors[0],/read failed/);
  assert.equal(ctx.addItemsBusy,false);
  const replacement = {name:'new-root',path:'',isDir:true,children:[]};
  ctx.getTauriFileApi = ()=>({open:async()=>{ctx.rootNode = replacement;return '/source/assets';}});
  await ctx.importFolderIntoCurrent();
  assert.equal(replacement.children.length,0);
  assert.equal(originalRoot.children.length,0);
});

test('folder import merges directories, confirms overwrite and rejects archive name conflicts',async()=>{
  const ctx = context();
  ctx.createDirAtPath('target/assets');
  ctx.createFileAtPath('target/assets/keep.txt',Buffer.from('keep'));
  ctx.createFileAtPath('target/assets/change.txt',Buffer.from('old'));
  const entries = [{path:'empty',type:'dir'},{path:'change.txt',bytes:Buffer.from('new')}];
  ctx.appConfirm = async()=>false;
  await ctx.addFolderEntriesToCurrent('assets',entries,'target',ctx.rootNode);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'target/assets/empty'),null);
  ctx.appConfirm = async()=>true;
  await ctx.addFolderEntriesToCurrent('assets',entries,'target',ctx.rootNode);
  assert.equal(Buffer.from(ctx.findNodeByPath(ctx.rootNode,'target/assets/change.txt').data).toString(),'new');
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/assets/keep.txt'));
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/assets/empty'));
  await ctx.addPickedEntries([{path:'target/archive',bytes:await new JSZip().generateAsync({type:'uint8array'})}],ctx.rootNode);
  await assert.rejects(ctx.addFolderEntriesToCurrent('archive',entries,'target',ctx.rootNode),/路径冲突/);
});

test('browser directory handle and upload fallback import into the captured target',async()=>{
  const ctx = context();
  ctx.getTauriFileApi = ()=>null;
  ctx.createDirAtPath('target');
  ctx.selected = ctx.findNodeByPath(ctx.rootNode,'target');
  ctx.window.showDirectoryPicker = async()=>({
    name:'assets',
    async *entries(){
      yield ['empty',{kind:'directory',async *entries(){}}];
      yield ['file.txt',{kind:'file',getFile:async()=>({arrayBuffer:async()=>Buffer.from('file')})}];
    }
  });
  await ctx.importFolderIntoCurrent();
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/assets/empty'));
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/assets/file.txt'));
  delete ctx.window.showDirectoryPicker;
  let pickerOpened = false;
  ctx.document.getElementById = ()=>({click(){pickerOpened = true;}});
  await ctx.importFolderIntoCurrent();
  assert.equal(pickerOpened,true);
  ctx.selected = ctx.rootNode;
  await ctx.handleAddFolderInput({target:{value:'picked',files:[
    {webkitRelativePath:'upload/deep/a.txt',arrayBuffer:async()=>Buffer.from('a')},
    {webkitRelativePath:'upload/.DS_Store',arrayBuffer:async()=>{throw new Error('metadata should not be read');}}
  ]}});
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/upload/deep/a.txt'));
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'upload'),null);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'target/upload/.DS_Store'),null);
  assert.equal(ctx.pendingFolderImport,null);
});

test('added extensionless archives preserve nested archives, empty directories and edits through both save formats',async()=>{
  const ctx = context();
  const nested = new JSZip();
  nested.file('deep/value.txt','nested');
  nested.folder('deep/empty');
  const archive = new JSZip();
  archive.file('nested',await nested.generateAsync({type:'uint8array'}));
  archive.file('assets/config.xml','original');
  archive.folder('assets/empty');
  await ctx.addPickedEntries([{path:'target/icons',bytes:await archive.generateAsync({type:'uint8array'})}],ctx.rootNode);
  const container = ctx.findNodeByPath(ctx.rootNode,'target/icons');
  assert.equal(container.isArchiveContainer,true);
  assert.equal(container.archiveFileNode.name,'icons');
  assert.equal(container.parent.path,'target');
  const inner = ctx.findNodeByPath(ctx.rootNode,'target/icons/nested');
  assert.equal(inner.isArchiveContainer,true);
  const config = ctx.findNodeByPath(ctx.rootNode,'target/icons/assets/config.xml');
  config.data = Buffer.from('edited');
  config.modified = true;
  // Adding an archive within an existing archive must retain the full parent path.
  await ctx.addPickedEntries([{path:'target/icons/assets/extra',bytes:await nested.generateAsync({type:'uint8array'})}],ctx.rootNode);
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'target/icons/assets/extra/deep/value.txt'));
  const output = await JSZip.loadAsync(await ctx.zipDirFromNode(ctx.rootNode));
  assert.ok(output.file('target/icons'));
  assert.equal(output.files['target/icons/'],undefined);
  assert.equal(output.file('target/icons.zip'),null);
  const restored = await JSZip.loadAsync(await output.file('target/icons').async('uint8array'));
  assert.equal(await restored.file('assets/config.xml').async('string'),'edited');
  assert.ok(restored.files['assets/empty/'].dir);
  for(const name of ['nested','assets/extra']){
    const restoredNested = await JSZip.loadAsync(await restored.file(name).async('uint8array'));
    assert.equal(await restoredNested.file('deep/value.txt').async('string'),'nested');
    assert.ok(restoredNested.files['deep/empty/'].dir);
  }
  const operations = await ctx.collectFolderWriteOperations(ctx.rootNode);
  assert.deepEqual(Array.from(operations.dirs),['target']);
  assert.deepEqual(Array.from(operations.files,file=>file.path),['target/icons']);
  const saved = await JSZip.loadAsync(operations.files[0].data);
  assert.equal(await saved.file('assets/config.xml').async('string'),'edited');
});

test('archive overwrite is confirmed, replaces the whole container and handles deleted-name reuse',async()=>{
  const ctx = context();
  async function add(content){
    const zip = new JSZip();
    zip.file(`${content}.txt`,content);
    await ctx.addPickedEntries([{path:'icons',bytes:await zip.generateAsync({type:'uint8array'})}],ctx.rootNode);
  }
  await add('old');
  const previous = ctx.findNodeByPath(ctx.rootNode,'icons');
  ctx.appConfirm = async()=>false;
  await add('cancelled');
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'icons'),previous);
  ctx.appConfirm = async()=>true;
  await add('new');
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'icons/old.txt'),null);
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'icons/new.txt'));
  ctx.findNodeByPath(ctx.rootNode,'icons').deleted = true;
  await add('reused');
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'icons/reused.txt'));
  await ctx.addPickedEntries([{path:'icons',bytes:Buffer.from('plain')}],ctx.rootNode);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'icons').isDir,false);
  await add('archive-again');
  assert.ok(ctx.findNodeByPath(ctx.rootNode,'icons/archive-again.txt'));
  ctx.createDirAtPath('real-folder');
  await assert.rejects(ctx.addPickedEntries([{path:'real-folder',bytes:Buffer.from('file')}],ctx.rootNode),/路径冲突/);
});

test('empty archives are expandable and unsupported archives keep their original bytes',async()=>{
  const ctx = context();
  const damaged = Buffer.from([0x50,0x4b,0x03,0x04,1,2,3]);
  await ctx.addPickedEntries([
    {path:'empty',bytes:await new JSZip().generateAsync({type:'uint8array'})},
    {path:'damaged',bytes:damaged},
    {path:'plain',bytes:Buffer.from('text')}
  ],ctx.rootNode);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'empty').isArchiveContainer,true);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'empty').children.length,0);
  assert.equal(ctx.findNodeByPath(ctx.rootNode,'damaged').isDir,false);
  const output = await JSZip.loadAsync(await ctx.zipDirFromNode(ctx.rootNode));
  assert.deepEqual(await output.file('damaged').async('nodebuffer'),damaged);
  assert.equal(await output.file('plain').async('string'),'text');
  assert.equal(Object.keys((await JSZip.loadAsync(await output.file('empty').async('uint8array'))).files).length,0);
});

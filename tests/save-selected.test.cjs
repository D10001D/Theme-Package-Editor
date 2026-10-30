const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const JSZip = require('jszip');
const source = require('node:fs').readFileSync('frontend/app.js', 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
function setup() {
  const button = {disabled:false}, alerts = [], writes = [];
  const ctx = vm.createContext({
    Uint8Array, TextEncoder, console, window:{},
    rootNode:{name:'root',path:'',isDir:true,children:[]},
    originalBaseName:'主题', originalFullName:'主题.itz', importSourceKind:'package',
    activeEditorNodePath:null, hasUnsavedTextChanges:()=>false,
    ensureJsZipAvailable:()=>JSZip,
    savingSelectedNode:false, multiSelectedPaths:new Set(),
    document:{getElementById:()=>button},
    showToast(){}, appAlert:async message=>alerts.push(message),
    getTauriFileApi:()=>({save:async()=>null, writeFile:async(...args)=>writes.push(args)}),
    isAbortError:error=>error?.name === 'AbortError'
  });
  vm.runInContext([
    section('function joinFsPath(', 'function supportsFileSystemAccess('),
    section('async function zipDirFromNode(', 'function collectDeletedTreePaths('),
    section('async function collectSelectedSaveEntries(', 'document.getElementById("saveSelectedBtn").addEventListener')
  ].join('\n'), ctx);
  return {ctx, button, alerts, writes};
}
function dir(name, children=[]) { return {name,path:`parent/${name}`,isDir:true,children}; }
function file(name, content) { return {name,path:`parent/${name}`,isDir:false,data:Buffer.from(content),modified:true}; }

test('selected folder retains its own name, 12 levels, empty folders and binary bytes on disk and in ZIP', async()=>{
  const {ctx} = setup();
  const selected = dir('素材');
  let current = selected, relative = '素材';
  for(let i=1;i<=12;i++) {
    const next = dir(`层${i}`);
    current.children.push(next);
    current = next;
    relative += `/层${i}`;
  }
  current.children.push(dir('空目录'), file('图片.bin', [0,255,13,10]));
  selected.children.push({...dir('已删除', [file('隐藏.txt','deleted')]),deleted:true});
  const entries = await ctx.collectSelectedSaveEntries(selected);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'theme-save-selected-'));
  try {
    const api = {exists:async p=>fs.access(p).then(()=>true,()=>false),mkdir:fs.mkdir,writeFile:fs.writeFile};
    await ctx.writeSelectedFolderToPath(tmp, entries, api);
    assert.deepEqual(await fs.readdir(tmp), ['素材']);
    assert.deepEqual(await fs.readFile(path.join(tmp,relative,'图片.bin')), Buffer.from([0,255,13,10]));
    assert.deepEqual(await fs.readdir(path.join(tmp,relative,'空目录')), []);
    await assert.rejects(fs.access(path.join(tmp,'素材','已删除')));
    const zip = await JSZip.loadAsync(await ctx.zipSelectedSaveEntries(entries));
    assert.ok(zip.files[`${relative}/空目录/`].dir);
    assert.deepEqual(await zip.file(`${relative}/图片.bin`).async('nodebuffer'), Buffer.from([0,255,13,10]));
    await assert.rejects(ctx.writeSelectedFolderToPath(tmp, entries, api), /已存在/);
    assert.deepEqual(await fs.readFile(path.join(tmp,relative,'图片.bin')), Buffer.from([0,255,13,10]));
  } finally { await fs.rm(tmp,{recursive:true,force:true}); }
});

test('internal archives preserve their format and selected subfolders have no ancestor prefix', async()=>{
  const {ctx} = setup();
  const assets = dir('assets',[file('edited.xml','latest'),dir('empty')]);
  const archive = {...dir('icons',[assets]),isArchiveContainer:true};
  const entries = await ctx.collectSelectedSaveEntries(archive);
  assert.equal(entries.dirs.length,0);
  assert.equal(entries.files[0].path,'icons');
  const zip = await JSZip.loadAsync(entries.files[0].data);
  assert.equal(await zip.file('assets/edited.xml').async('string'),'latest');
  assert.ok(zip.files['assets/empty/'].dir);
  const subtree = await ctx.collectSelectedSaveEntries(assets);
  assert.equal(subtree.files[0].path,'assets/edited.xml');
});

test('saving a file includes unsaved editor contents without clearing pending changes', async()=>{
  const {ctx, button, writes} = setup();
  const selected = file('config.xml','old');
  ctx.activeEditorNodePath = selected.path;
  ctx.hasUnsavedTextChanges = ()=>true;
  ctx.getActiveTextEditorValue = ()=>'<new />';
  ctx.getSingleSelectedTreeNode = ()=>selected;
  ctx.getTauriFileApi = ()=>({save:async()=>'/output/config.xml',writeFile:async(...args)=>writes.push(args)});
  assert.equal(await ctx.saveSelectedNode(),true);
  assert.equal(Buffer.from(writes[0][1]).toString(),'<new />');
  assert.equal(selected.data.toString(),'old');
  assert.equal(selected.modified,true);
  assert.equal(button.disabled,false);
});

test('cancelled dialog performs no write and resets busy state', async()=>{
  const {ctx, button, writes, alerts} = setup();
  ctx.getSingleSelectedTreeNode = ()=>file('a.txt','a');
  assert.equal(await ctx.saveSelectedNode(),false);
  assert.equal(writes.length,0);
  assert.equal(alerts.length,0);
  assert.equal(button.disabled,false);
  assert.equal(ctx.savingSelectedNode,false);
});

test('desktop folder picker requests recursive access and writes only the selected subtree', async()=>{
  const {ctx, writes} = setup();
  ctx.getSingleSelectedTreeNode = ()=>dir('assets',[dir('nested',[file('a.txt','a')])]);
  ctx.getTauriFileApi = ()=>({
    open:async options=>{
      assert.equal(options.directory,true);
      assert.equal(options.recursive,true);
      return '/destination';
    },
    exists:async()=>false,
    mkdir:async p=>writes.push(['dir',p]),
    writeFile:async p=>writes.push(['file',p])
  });
  assert.equal(await ctx.saveSelectedNode(),true);
  assert.deepEqual(writes,[
    ['dir','/destination/assets'],
    ['dir','/destination/assets/nested'],
    ['file','/destination/assets/nested/a.txt']
  ]);
});

test('unsafe names are rejected before writing and package root has a meaningful folder name', async()=>{
  const {ctx} = setup();
  for(const name of ['..','../outside','a/b','a\\b']) {
    await assert.rejects(ctx.collectSelectedSaveEntries(dir(name)), /不合法/);
  }
  assert.equal((await ctx.collectSelectedSaveEntries(ctx.rootNode)).dirs[0],'主题');
});

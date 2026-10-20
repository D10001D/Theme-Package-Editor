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
    Uint8Array, Map, Set,
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
    section('function normalizePath(', 'function isPackageRootNode('),
    section('function joinFsPath(', 'function supportsFileSystemAccess('),
    section('function ensureDir(', 'async function buildTreeFromZip('),
    section('function sortTree(', 'function renderTree('),
    section('function isSystemMetadataEntry(', 'async function loadPackageFromFolderPath('),
    section('function findNodeByPath(', 'function hasSelectedAncestor('),
    section('async function addPickedEntries(', 'document.getElementById("addFileInput").addEventListener("change"'),
    section('function getExistingNodeAtPath(', 'function replacePathPrefix('),
    section('async function zipDirFromNode(', 'function collectDeletedTreePaths('),
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

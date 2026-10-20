const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/app.js', 'utf8');
const code = source.slice(source.indexOf('function isSystemMetadataEntry('), source.indexOf('async function loadPackageFromFolderPath('));
test('skips macOS metadata before reading, preserves files and metadata-only folders', async () => {
  const file = name => ({name, isFile:true});
  const dir = name => ({name, isDirectory:true});
  const tree = {
    '/picked':[file('.DS_Store'),dir('__MACOSX'),dir('assets'),dir('empty')],
    '/picked/assets':[file('._image.png'),file('image.png'),file('.theme-config')],
    '/picked/empty':[file('.DS_Store')]
  };
  const reads = [];
  const context = vm.createContext({
    getTauriFileApi: () => ({
      readDir: async path => { assert.ok(tree[path], path); return tree[path]; },
      readFile: async path => { assert.ok(!path.includes('.DS_Store') && !path.includes('/._')); reads.push(path); return [1]; }
    }),
    joinFsPath: (a,b) => `${a}/${b}`
  });
  vm.runInContext(code,context);
  const entries = await context.readFolderEntriesFromPath('/picked');
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [
    {path:'assets',type:'dir'},
    {path:'assets/image.png',bytes:[1]},
    {path:'assets/.theme-config',bytes:[1]},
    {path:'empty',type:'dir'}
  ]);
  assert.equal(reads.length,2);
});

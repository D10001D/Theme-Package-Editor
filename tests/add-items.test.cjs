const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/app.js', 'utf8');
const fn = source.slice(source.indexOf('async function addPickedEntries('), source.indexOf('document.getElementById("addFileInput").addEventListener("change"'));
function setup(existing = {}, confirm = true) {
  const writes = [], root = {};
  const context = vm.createContext({
    rootNode: root, selected: null, normalizePath: p => p,
    getExistingNodeAtPath: p => existing[p], appConfirm: async () => confirm,
    createDirAtPath: p => { writes.push(['dir', p]); return {}; },
    createFileAtPath: (p, bytes) => writes.push(['file', p, ...bytes]),
    sortTree() {}, updateSidebarContext() {}, renderTree() {}, showToast() {}
  });
  vm.runInContext(fn, context);
  return { writes, run: entries => context.addPickedEntries(entries, root) };
}
test('keeps nested paths and empty directories alongside files', async () => {
  const s = setup();
  await s.run([{path:'icons/assets/empty', type:'dir'}, {path:'icons/assets/a.png', bytes:[1,2]}, {path:'icons/b.txt', bytes:[3]}]);
  assert.deepEqual(s.writes, [['dir','icons'],['dir','icons/assets'],['dir','icons/assets/empty'],['file','icons/assets/a.png',1,2],['file','icons/b.txt',3]]);
});
test('cancelled overwrite leaves all entries untouched', async () => {
  const s = setup({'a.txt':{isDir:false}}, false);
  await s.run([{path:'empty',type:'dir'}, {path:'a.txt',bytes:[1]}]);
  assert.equal(s.writes.length, 0);
});
test('ancestor file conflict rejects the batch before changes', async () => {
  const s = setup({'icons':{isDir:false}});
  await assert.rejects(s.run([{path:'other.txt',bytes:[1]}, {path:'icons/a.png',bytes:[2]}]), /路径冲突/);
  assert.equal(s.writes.length, 0);
});
test('merges directories and overwrites confirmed files', async () => {
  const s = setup({'icons':{isDir:true},'icons/a.png':{isDir:false}});
  await s.run([{path:'icons',type:'dir'}, {path:'icons/a.png',bytes:[9]}]);
  assert.deepEqual(s.writes, [['dir','icons'],['file','icons/a.png',9]]);
});

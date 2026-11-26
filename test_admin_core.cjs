const {test} = require('node:test');
const assert = require('node:assert/strict');
const {words, draftLabel, findDrafts, markdownExport} = require('./admin-core.js');
const old = {id:'a', title:'', body:'', freewrite:'A café in Montréal.', updated:1, build:{text:'Where do you belong?',stage:'freewrite', point:'Home is a practice.',beats:[{label:'Hook', note:'The train'}]}};
const newer = {id:'b', title:'Home', body:'A different answer.', updated:2, path:'posts/home.md'};
test('finds unfinished answers by their prose, prompt, point and plan', () => {
  for (const q of ['café', 'belong', 'practice', 'train', 'CAFÉ Montréal']) assert.deepEqual(findDrafts([old,newer],q).map(d=>d.id), ['a']);
  assert.equal(draftLabel(old),'Where do you belong?');
});
test('filters and sorts without changing the library', () => {
  const input=[old,newer];
  assert.deepEqual(findDrafts(input).map(d=>d.id),['b','a']);
  assert.deepEqual(findDrafts(input,'','drafts').map(d=>d.id),['a']);
  assert.deepEqual(findDrafts(input,'','published').map(d=>d.id),['b']);
  assert.deepEqual(findDrafts([{...old,build:{...old.build,stage:'kept'}}],'','journal').map(d=>d.id),['a']);
  assert.equal(input[0],old);
});
test('exports both finished prose and the original prompt material', () => {
  const out=markdownExport({...old,body:'The finished piece.',next:'Check the ending.'});
  for(const text of ['The finished piece.','A café in Montréal.','Home is a practice.','The train','Check the ending.']) assert.ok(out.includes(text));
  assert.equal(markdownExport(newer),'# Home\n\nA different answer.\n');
});
test('counts accented words and contractions without splitting letters', () => {
  assert.equal(words('naïve café isn’t déjà-vu'),4);
  assert.equal(words('... — ***'),0);
});
test('blank-page writing carries reader context into search and export', () => {
  const d={...newer,path:undefined,brief:{who:'A tired apprentice',point:'Ask before fixing'},next:'Add the scene'};
  assert.deepEqual(findDrafts([d],'apprentice fixing').map(d=>d.id),['b']);
  for(const text of ['A tired apprentice','Ask before fixing','Add the scene']) assert.ok(markdownExport(d).includes(text));
});

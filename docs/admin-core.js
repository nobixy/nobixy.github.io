// Pure document operations shared by the editor and regression tests.
(function (root) {
  'use strict';
  const words = (text) => (String(text).match(/[\p{L}\p{N}]+(?:['’’-][\p{L}\p{N}]+)*/gu) || []).length;
  const draftLabel = (d) => d.title.trim() || d.build?.text || (d.freewrite || d.body || '').trim().split('\n')[0].slice(0, 100) || 'Untitled';
  const draftStatus = (d) => d.path ? 'Published' : d.build?.stage === 'kept' ? 'Journal' : ({freewrite: 'Freewrite', point: 'Finding the point', compare: 'Comparing answers', plan: 'Planning', revise: 'Revising', publish: 'Ready to publish'}[d.build?.stage] || 'Draft');
  function findDrafts(drafts, query = '', filter = 'all') {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return drafts.filter(d => {
      if (filter === 'published' && !d.path) return false;
      if (filter === 'journal' && (d.path || d.build?.stage !== 'kept')) return false;
      if (filter === 'drafts' && (d.path || d.build?.stage === 'kept')) return false;
      const text = [d.title, d.desc, d.kind, d.body, d.freewrite, d.next, d.build?.text, d.build?.point, d.build?.who, d.build?.reflect, ...(d.build?.beats || []).map(b => b.note)].join(' ').toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }).sort((a, b) => b.updated - a.updated);
  }
  function markdownExport(d) {
    const sections = [`# ${draftLabel(d)}`, d.body || ''];
    if (d.freewrite || d.build || d.next) {
      sections.push('---', '## Working notes');
      if (d.build?.text) sections.push('### Prompt', d.build.text);
      if (d.build?.point) sections.push('### Point', d.build.point);
      if (d.build?.who) sections.push('### Reader', d.build.who);
      if (d.next) sections.push('### Next session', d.next);
      if (d.build?.beats?.length) sections.push('### Plan', d.build.beats.map(b => `- ${b.label}: ${b.note || ''}`).join('\n'));
      if (d.build?.reflect) sections.push('### What changed', d.build.reflect);
      if (d.freewrite) sections.push('### Freewrite', d.freewrite);
    }
    return sections.filter(Boolean).join('\n\n') + '\n';
  }
  const api = { words, draftLabel, draftStatus, findDrafts, markdownExport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WriterCore = api;
})(globalThis);

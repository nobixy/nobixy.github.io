// The Writer's Station: a private writing desk on a public static site.
//
// Security model: this file and the page are public and hold no secrets. Every save to the site is a
// GitHub API call that needs Joseph's fine-grained token (Contents: write on this one repo). GitHub checks
// it on every request. The token stays in this browser (sessionStorage, or localStorage if "remember").
// The page's Content-Security-Policy allows only this script and api.github.com, and the preview escapes
// all HTML, so nothing else on the page can read the token.
//
// Drafts live in this browser only: the repo is public, so a draft never goes to GitHub until Publish.
(() => {
  'use strict';
  const REPO = 'nobixy/nobixy.github.io';
  const API = 'https://api.github.com';
  const WPM = 220;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const words = (s) => (s.match(/[A-Za-z0-9'-]+/g) || []).length;
  const slugify = (t) => t.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ------------------------------------------------------------------ GitHub
  let token = sessionStorage.getItem('ws.token') || localStorage.getItem('ws.token') || '';
  async function gh(path, opts = {}) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      ...opts,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`,
                 ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg += `: ${(await res.json()).message}`; } catch { /* no body */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const readFile = async (path) => { const f = await gh(`/repos/${REPO}/contents/${path}?ref=main`); return b64decode(f.content); };

  // ------------------------------------------------------------------ log on / log off
  const login = $('#ws-login'), ws = $('#ws');
  async function checkToken() {
    const repo = await gh(`/repos/${REPO}`);
    if (!repo.permissions || !repo.permissions.push) throw new Error('That token can read the repo but not write to it. Give it Contents: Read and write.');
  }
  function showStation() { login.hidden = true; ws.hidden = false; boot(); }
  $('#ws-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#ws-login-error');
    err.hidden = true;
    token = $('#ws-token').value.trim();
    try {
      await checkToken();
      ($('#ws-remember').checked ? localStorage : sessionStorage).setItem('ws.token', token);
      $('#ws-token').value = '';
      showStation();
    } catch (ex) {
      token = '';
      err.textContent = ex.status === 401 ? 'GitHub says that token is not valid (or it expired).' : ex.status === 404 ? 'That token cannot see nobixy.github.io. Pick it under "Only select repositories".' : ex.message;
      err.hidden = false;
    }
  });
  function logout() { sessionStorage.removeItem('ws.token'); localStorage.removeItem('ws.token'); token = ''; location.reload(); }
  if (token) checkToken().then(showStation, () => { sessionStorage.removeItem('ws.token'); localStorage.removeItem('ws.token'); token = ''; });

  // ------------------------------------------------------------------ drafts (this browser only)
  const el = { title: $('#ws-title'), desc: $('#ws-desc'), kind: $('#ws-kind'), body: $('#ws-body') };
  let drafts = store.get('ws.drafts', {});
  let cur = null;
  let kindsMap = {};
  const newDraft = () => ({ id: `d${Date.now().toString(36)}`, title: '', desc: '', kind: '', body: '', created: Date.now(), updated: Date.now(), snapshots: [], revised: false, readAloud: false });

  function load(d) {
    cur = d;
    el.title.value = d.title; el.desc.value = d.desc; el.kind.value = d.kind; el.body.value = d.body;
    lastCount = words(d.body); sessionStart = lastCount;
    store.set('ws.current', d.id);
    refresh();
  }
  function persist(snapshot = false) {
    if (!cur) return;
    Object.assign(cur, { title: el.title.value, desc: el.desc.value, kind: el.kind.value, body: el.body.value, updated: Date.now() });
    const last = cur.snapshots[cur.snapshots.length - 1];
    if ((snapshot || !last || Date.now() - last.t > 5 * 60000) && cur.body.trim() && (!last || last.body !== cur.body)) {
      cur.snapshots.push({ t: Date.now(), title: cur.title, body: cur.body });
      cur.snapshots = cur.snapshots.slice(-30);
    }
    drafts[cur.id] = cur;
    try { store.set('ws.drafts', drafts); $('#ws-saved').textContent = `saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; }
    catch { say('Browser storage is full: delete old drafts in Open.'); }
  }
  const autosave = debounce(() => persist(), 700);

  // ------------------------------------------------------------------ counts, session, log
  let lastCount = 0, sessionStart = 0;
  const say = (m) => { $('#ws-msg').textContent = m; };
  function track() {
    const n = words(el.body.value);
    const delta = n - lastCount;
    if (delta > 0 && delta < 400) { // a paste of a whole piece isn't "writing"
      const log = store.get('ws.log', {});
      log[today()] = (log[today()] || 0) + delta;
      store.set('ws.log', log);
    }
    lastCount = n;
  }
  function refresh() {
    const n = words(el.body.value);
    $('#ws-count').textContent = `${n.toLocaleString()} words`;
    $('#ws-read').textContent = `${Math.max(1, Math.round(n / WPM))} min read`;
    $('#ws-session').textContent = `+${Math.max(0, n - sessionStart)} this session`;
    const name = el.title.value.trim() || 'Untitled';
    $('#ws-doc-name').textContent = `${name} - ${cur && cur.path ? 'Published (editing)' : 'Draft'}`;
    document.title = `${name} | Writer's Station`;
    renderLog();
    if (mode === 'revise') analyzeSoon();
  }

  function renderLog() {
    const log = store.get('ws.log', {});
    const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [k, log[k] || 0, d]; });
    const max = Math.max(250, ...days.map((d) => d[1]));
    const week = days.slice(7).reduce((a, d) => a + d[1], 0);
    const active = days.filter((d) => d[1] > 0).length;
    $('#ws-log').innerHTML = `<div class="ws-bars" role="img" aria-label="Words written per day, last 14 days">${days.map(([k, v, d]) =>
      `<span title="${k}: ${v} words"><i style="height:${Math.round((v / max) * 100)}%"></i><small>${'SMTWTFS'[d.getDay()]}</small></span>`).join('')}</div>
      <p class="ws-logline"><b>${week.toLocaleString()}</b> words in the last 7 days &nbsp;/&nbsp; wrote on <b>${active}</b> of the last 14 days</p>`;
  }

  // ------------------------------------------------------------------ modes: draft vs revise
  let mode = 'draft';
  function setMode(m) {
    mode = m;
    ws.dataset.mode = m;
    $$('.ws-mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    el.body.spellcheck = m === 'revise';
    $('#ws-hint').textContent = m === 'draft' ? 'Draft mode: just write. Checks wait for Revise.' : 'Revise mode: big things first (Outline), then sentences (Feedback).';
    if (m === 'revise' && cur) { cur.revised = true; persist(true); analyze(); }
  }

  // ------------------------------------------------------------------ feedback (Orwell + plain English)
  const SWAPS = { utilize: 'use', utilise: 'use', utilization: 'use', commence: 'start', approximately: 'about', demonstrate: 'show', facilitate: 'help', individuals: 'people', numerous: 'many', purchase: 'buy', sufficient: 'enough', assistance: 'help', endeavor: 'try', endeavour: 'try', terminate: 'end', obtain: 'get', additional: 'more', subsequently: 'later', regarding: 'about', initiate: 'start', ascertain: 'find out', possess: 'have', residence: 'home', inquire: 'ask', require: 'need', methodology: 'method', functionality: 'feature', 'prior to': 'before', 'in order to': 'to', 'due to the fact that': 'because', 'at this point in time': 'now', 'in the event that': 'if', 'a large number of': 'many', 'the majority of': 'most', 'has the ability to': 'can', 'is able to': 'can', 'with regard to': 'about', 'for the purpose of': 'to', 'in spite of the fact that': 'although' };
  const CLICHES = ['at the end of the day', 'think outside the box', 'low-hanging fruit', 'game changer', 'game-changer', 'in this day and age', 'needless to say', 'it goes without saying', 'only time will tell', 'last but not least', 'avoid it like the plague', 'easier said than done', 'the calm before the storm', 'a blessing in disguise', 'every cloud has a silver lining', 'better late than never', 'all walks of life', 'move the needle', 'circle back', 'deep dive', 'hit the ground running', 'at the drop of a hat', 'tip of the iceberg', 'the bottom line', 'paradigm shift', 'win-win', 'take it to the next level', 'whole new level', 'since the dawn of time', 'throughout history', 'little did i know', 'in today\'s world', 'fast-paced world', 'touch base'];
  const FILLERS = ['very', 'really', 'just', 'basically', 'actually', 'literally', 'quite', 'rather', 'somewhat', 'totally', 'simply', 'honestly', 'kind of', 'sort of', 'a bit', 'definitely', 'certainly', 'pretty much'];
  const NOT_ADVERBS = new Set(['only', 'family', 'early', 'reply', 'supply', 'apply', 'july', 'holy', 'ugly', 'belly', 'jelly', 'fly', 'ally', 'rely', 'italy', 'lonely', 'friendly', 'lovely', 'likely', 'daily', 'weekly', 'monthly', 'yearly', 'silly', 'bully', 'rally', 'sally', 'billy', 'molly', 'emily', 'curly', 'hourly', 'costly', 'elderly', 'chilly', 'lily', 'oily', 'smelly', 'wily', 'jolly', 'assembly', 'anomaly', 'butterfly', 'dragonfly', 'firefly', 'comply', 'multiply', 'imply', 'fully', 'really', 'actually', 'basically', 'literally', 'totally', 'simply', 'honestly', 'definitely', 'certainly']);
  const IRREG = 'known|done|made|given|taken|seen|written|built|shown|told|found|thought|left|kept|held|brought|begun|broken|chosen|driven|eaten|fallen|forgotten|gotten|hidden|ridden|risen|spoken|stolen|sworn|thrown|worn|woven|sold|paid|said|sent|spent|caught|taught|bought|fought|won|lost|felt|led|met|read|run|set|put|cut|hit|hurt|shut|understood|drawn|grown|blown|flown|frozen|known|beaten|bitten|forgiven|hung|struck|sung|sunk|swum|torn|withdrawn';
  const PASSIVE = new RegExp(`\\b(am|is|are|was|were|be|been|being|get|gets|got|gotten)\\s+(?:\\w+ly\\s+)?(\\w+ed|${IRREG})\\b`, 'gi');
  const syllables = (w) => { w = w.toLowerCase().replace(/[^a-z]/g, ''); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); return (w.match(/[aeiouy]{1,2}/g) || []).length || 1; };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Code blocks and link targets are blanked out (same length) so offsets still match the textarea.
  function mask(text) {
    return text.replace(/```[\s\S]*?(```|$)/g, (m) => m.replace(/[^\n]/g, ' '))
               .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
               .replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length))
               .replace(/^#{1,6} .*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  }
  function sentences(text) {
    const out = [];
    const re = /[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g;
    let m;
    while ((m = re.exec(text))) { if (!m[0]) { re.lastIndex++; continue; } if (m[0].trim()) out.push({ start: m.index + m[0].search(/\S/), text: m[0].trim() }); }
    return out;
  }
  function analyze() {
    const raw = el.body.value, text = mask(raw);
    const issues = [];
    const add = (type, weight, start, len, hint) => issues.push({ type, weight, start, end: start + len, hint, text: raw.slice(start, start + len) });
    const sents = sentences(text);
    let wc = 0, syl = 0;
    for (const s of sents) {
      const ws_ = s.text.match(/[A-Za-z0-9'-]+/g) || [];
      wc += ws_.length; syl += ws_.reduce((a, w) => a + syllables(w), 0);
      if (ws_.length > 35) add('Very long sentence', 5, s.start, s.text.length, `${ws_.length} words. Split it in two.`);
      else if (ws_.length > 25) add('Long sentence', 3, s.start, s.text.length, `${ws_.length} words. Can it be shorter?`);
    }
    const lower = text.toLowerCase();
    for (const c of CLICHES) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(c)}\\b`, 'g'))) add('Worn-out phrase', 4, m.index, c.length, 'Orwell rule 1: say it your own way.');
    for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) if (!/^(had|that|is)$/i.test(m[1])) add('Doubled word', 5, m.index, m[0].length, `"${m[1]} ${m[1]}"`);
    for (const m of text.matchAll(/\bits (a|the|not|been|going|really|just|very|so|time)\b/gi)) add("its / it's", 4, m.index, m[0].length, "Did you mean it's (it is)?");
    for (const m of text.matchAll(/\bit's (own|self)\b/gi)) add("its / it's", 4, m.index, m[0].length, 'Did you mean its?');
    for (const m of text.matchAll(PASSIVE)) add('Passive voice', 3, m.index, m[0].length, 'Orwell rule 4: who did it? Make them the subject.');
    for (const [k, v] of Object.entries(SWAPS)) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(k)}\\b`, 'g'))) add('Long word', 2, m.index, k.length, `Orwell rule 2: try "${v}".`);
    for (const f of FILLERS) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(f)}\\b`, 'g'))) add('Filler', 2, m.index, f.length, 'Orwell rule 3: cut it and reread.');
    for (const m of text.matchAll(/\b[A-Za-z]+ly\b/g)) if (!NOT_ADVERBS.has(m[0].toLowerCase())) add('Adverb', 1, m.index, m[0].length, 'Would a stronger verb do the job?');
    let pos = 0;
    for (const p of raw.split(/\n\s*\n/)) { const n = words(p); if (n > 150 && !p.trim().startsWith('```')) add('Big paragraph', 2, raw.indexOf(p, pos), Math.min(p.length, 60), `${n} words. Break it up.`); pos += p.length; }

    const grade = wc ? 0.39 * (wc / Math.max(1, sents.length)) + 11.8 * (syl / wc) - 15.59 : 0;
    const counts = issues.reduce((a, i) => ((a[i.type] = (a[i.type] || 0) + 1), a), {});
    issues.sort((a, b) => b.weight - a.weight || a.start - b.start);
    const item = (i) => `<li><button type="button" class="ws-issue" data-start="${i.start}" data-end="${i.end}"><b>${esc(i.type)}</b> <q>${esc(i.text.length > 70 ? i.text.slice(0, 70) + '...' : i.text)}</q><small>${esc(i.hint)}</small></button></li>`;
    const top = issues.slice(0, 5), rest = issues.slice(5);
    $('#ws-pane-feedback').innerHTML = !wc ? '<p class="ws-empty">Write something first. Feedback shows up here in Revise mode.</p>' : `
      <div class="stat-row ws-stats"><div><strong>${grade > 0 ? grade.toFixed(1) : '-'}</strong><span>GRADE LEVEL ${grade <= 9 ? '(CLEAR)' : '(AIM FOR 9 OR LESS)'}</span></div><div><strong>${(wc / Math.max(1, sents.length)).toFixed(0)}</strong><span>AVG WORDS / SENTENCE</span></div></div>
      <p class="ws-counts">${Object.entries(counts).map(([k, v]) => `<span>${esc(k)}: ${v}</span>`).join('') || '<span>Nothing flagged. Read it aloud next.</span>'}</p>
      ${top.length ? `<h3 class="subheading">FIX THESE FIRST</h3><ul class="ws-issues">${top.map(item).join('')}</ul>` : ''}
      ${rest.length ? `<details class="phase-details"><summary>EVERYTHING ELSE (${rest.length}) <span aria-hidden="true">[ + ]</span></summary><ul class="ws-issues">${rest.map(item).join('')}</ul></details>` : ''}
      <p class="ws-note">These are hints, not rules. Orwell's rule 6: break any of them before you write something ugly.</p>`;
    renderOutline(); renderPreview(); renderHistory();
  }
  const analyzeSoon = debounce(analyze, 400);

  function jump(start, end) {
    el.body.focus();
    el.body.setSelectionRange(start, end);
    const before = el.body.value.slice(0, start).split('\n').length - 1;
    const total = el.body.value.split('\n').length;
    el.body.scrollTop = Math.max(0, (before / Math.max(1, total)) * el.body.scrollHeight - el.body.clientHeight / 3);
  }

  function renderOutline() {
    const raw = el.body.value; let pos = 0, n = 0; const rows = [];
    for (const p of raw.split(/\n\s*\n/)) {
      const at = raw.indexOf(p, pos); pos = at + p.length;
      const t = p.trim(); if (!t) continue;
      if (/^#{1,6} /.test(t)) { rows.push(`<li class="ws-ol-head"><button type="button" class="ws-issue" data-start="${at}" data-end="${at + p.length}">${esc(t.replace(/^#+ /, ''))}</button></li>`); continue; }
      n++;
      const first = (t.replace(/[*_`>#]/g, '').match(/^[^.!?]+[.!?]?/) || [t])[0];
      rows.push(`<li><button type="button" class="ws-issue" data-start="${at}" data-end="${at + p.length}"><b>P${n}</b> <small>${words(t)} words</small><q>${esc(first.length > 110 ? first.slice(0, 110) + '...' : first)}</q></button></li>`);
    }
    $('#ws-pane-outline').innerHTML = rows.length ? `<p class="ws-note">Revise big before small. Each paragraph's first sentence should say what it's for. If two say the same thing, merge them. If one goes nowhere, cut it.</p><ol class="ws-issues ws-outline">${rows.join('')}</ol>` : '<p class="ws-empty">No paragraphs yet.</p>';
  }

  // ------------------------------------------------------------------ preview (escapes all HTML)
  function inline(s) {
    const codes = [];
    s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    const safe = (u) => (/^(https?:\/\/|\/|#|mailto:)/i.test(u) ? u : '#');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img alt="${a}" src="${safe(u)}">`)
         .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safe(u)}">${t}</a>`)
         .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
         .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
         .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  }
  function md(src) {
    const lines = src.replace(/\r/g, '').split('\n'), out = [];
    for (let i = 0; i < lines.length;) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
      if (/^#{1,6} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); i++; continue; }
      if (/^(\*\s*\*\s*\*|-\s*-\s*-)[\s*-]*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^>/.test(l)) { const buf = []; while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`); continue; }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) { const ordered = /^\s*\d+\./.test(l), buf = []; while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))}</li>`); out.push(`<${ordered ? 'ol' : 'ul'}>${buf.join('')}</${ordered ? 'ol' : 'ul'}>`); continue; }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(```|#{1,6} |>|\s*([-*+]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }
  function renderPreview() {
    $('#ws-pane-preview').innerHTML = `<h1 class="ws-pv-title">${esc(el.title.value || 'Untitled')}</h1>${el.desc.value ? `<p class="ws-pv-desc">${esc(el.desc.value)}</p>` : ''}${md(el.body.value) || '<p class="ws-empty">Nothing to preview yet.</p>'}`;
  }

  // ------------------------------------------------------------------ history (snapshots)
  function renderHistory() {
    if (!cur) return;
    const snaps = cur.snapshots.slice().reverse();
    $('#ws-pane-history').innerHTML = snaps.length ? `<p class="ws-note">Saved every 5 minutes while you write, and on Save, Revise and Publish. Last 30 kept.</p><ul class="ws-list">${snaps.map((s) =>
      `<li><span>${new Date(s.t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${words(s.body)} words</span><button type="button" class="dlg-btn" data-restore="${s.t}">Restore</button></li>`).join('')}</ul>` : '<p class="ws-empty">No snapshots yet.</p>';
  }

  // ------------------------------------------------------------------ sprint, freewrite, read aloud
  let sprint = null;
  function startSprint(min) {
    clearInterval(sprint && sprint.timer);
    if (!min) { sprint = null; $('#ws-timer').textContent = 'no sprint'; say('Sprint stopped.'); return; }
    sprint = { end: Date.now() + min * 60000, start: words(el.body.value), goal: +$('#ws-goal').value || 0, nobs: $('#ws-nobs').checked };
    setMode('draft');
    el.body.focus();
    sprint.timer = setInterval(() => {
      const left = Math.max(0, sprint.end - Date.now()), done = words(el.body.value) - sprint.start;
      $('#ws-timer').textContent = `Sprint ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} | ${done}${sprint.goal ? `/${sprint.goal}` : ''} words`;
      if (!left) {
        clearInterval(sprint.timer);
        say(`Time! ${done} words in ${min} min${sprint.goal && done >= sprint.goal ? '. Goal hit.' : '.'} Now rest, or switch to Revise.`);
        $('#ws-timer').textContent = `sprint done: ${done} words`;
        beep(); persist(true); sprint = null;
      }
    }, 1000);
    say(`Sprint on: ${min} min. Don't fix, just write.${sprint.nobs ? ' Backspace is off.' : ''}`);
  }
  function beep() {
    try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch { /* no audio */ }
  }
  let speaking = false;
  function readAloud() {
    if (!('speechSynthesis' in window)) { say('This browser cannot read aloud.'); return; }
    if (speaking) { speechSynthesis.cancel(); speaking = false; say('Stopped reading.'); return; }
    const sel = el.body.value.slice(el.body.selectionStart, el.body.selectionEnd);
    const text = (sel.trim() ? sel : `${el.title.value}. ${el.body.value}`).replace(/```[\s\S]*?```/g, ' code block. ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>]/g, '');
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => { speaking = false; if (cur && !sel.trim()) { cur.readAloud = true; persist(); } say('Done reading. What sounded wrong?'); };
    speechSynthesis.speak(u); speaking = true;
    say('Reading aloud. Listen for where you stumble. Click Read aloud again to stop.');
  }

  // ------------------------------------------------------------------ formatting
  function wrap(before, after = before, placeholder = 'text') {
    const { selectionStart: a, selectionEnd: b, value: v } = el.body;
    const mid = v.slice(a, b) || placeholder;
    el.body.setRangeText(before + mid + after, a, b, 'end');
    el.body.setSelectionRange(a + before.length, a + before.length + mid.length);
    el.body.focus(); el.body.dispatchEvent(new Event('input'));
  }
  function linePrefix(prefix) {
    const { selectionStart: a, value: v } = el.body;
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    el.body.setRangeText(prefix, ls, ls, 'end');
    el.body.focus(); el.body.dispatchEvent(new Event('input'));
  }
  const FMT = { h2: () => linePrefix('## '), b: () => wrap('**'), i: () => wrap('*'), q: () => linePrefix('> '), ul: () => linePrefix('- '), code: () => wrap('`', '`', 'code'), link: () => wrap('[', '](https://)', 'link text') };

  // ------------------------------------------------------------------ open
  async function openDialog() {
    const dlg = $('#ws-open');
    const list = Object.values(drafts).sort((a, b) => b.updated - a.updated);
    $('#ws-open-drafts').innerHTML = list.map((d) => `<li><span><b>${esc(d.title || 'Untitled')}</b> <small>${words(d.body)} words, ${ago(d.updated)}${d.path ? ', published' : ''}</small></span><span><button type="button" class="dlg-btn" data-open-draft="${d.id}">Open</button><button type="button" class="dlg-btn" data-del-draft="${d.id}">Delete</button></span></li>`).join('') || '<li>No drafts yet.</li>';
    dlg.showModal();
    try {
      const files = (await gh(`/repos/${REPO}/contents/posts?ref=main`)).filter((f) => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
      $('#ws-open-posts').innerHTML = files.map((f) => `<li><span>${esc(f.name.replace(/\.md$/, ''))}</span><button type="button" class="dlg-btn" data-open-post="${esc(f.path)}">Edit</button></li>`).join('');
    } catch (ex) { $('#ws-open-posts').innerHTML = `<li>Couldn't list posts: ${esc(ex.message)}</li>`; }
  }
  function frontMatter(text) {
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    const meta = {};
    if (!m) return [meta, text];
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':'); if (i < 0) continue;
      let v = line.slice(i + 1).trim();
      if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') v = v.slice(1, -1).replace(/\\"/g, '"');
      meta[line.slice(0, i).trim()] = v;
    }
    return [meta, text.slice(m[0].length)];
  }
  async function openPost(path) {
    const existing = Object.values(drafts).find((d) => d.path === path);
    if (existing) { persist(); load(existing); $('#ws-open').close(); say('Opened your local copy of this post (it has your unpublished edits).'); return; }
    say('Loading from GitHub...');
    const [meta, body] = frontMatter(await readFile(path));
    const slug = path.replace(/^posts\/\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    persist();
    const d = Object.assign(newDraft(), { title: meta.title || '', desc: meta.description || '', kind: kindsMap[slug] || '', body: body.replace(/^\n+/, ''), path, date: meta.date || path.slice(6, 16), extra: meta, created: 0 });
    drafts[d.id] = d; load(d); persist(true);
    $('#ws-open').close();
    say('Editing a published piece. Publish saves your changes to the live page.');
  }

  // ------------------------------------------------------------------ publish
  const PHONE = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
  function checklist() {
    const body = el.body.value, n = words(body);
    return [
      { ok: !!el.title.value.trim(), text: 'Has a title', block: true },
      { ok: !PHONE.test(body + el.title.value + el.desc.value), text: 'No phone numbers (privacy)', block: true },
      { ok: !EMAIL.test(body + el.desc.value), text: 'No email addresses (privacy)', block: true },
      { ok: !!el.desc.value.trim(), text: 'One-line summary (shows in lists and link previews)' },
      { ok: !!el.kind.value.trim(), text: 'Kind picked (Story, Essay, Study notes, Personal...)' },
      { ok: n >= 150, text: `At least 150 words (now ${n})` },
      { ok: !/\b(TODO|TK|XXX)\b/.test(body), text: 'No TODO or TK left in' },
      { ok: !!(cur && cur.revised), text: 'Had a pass in Revise mode' },
      { ok: !!(cur && cur.readAloud), text: 'Read aloud once, start to finish' },
      { ok: !!(cur && (cur.path || Date.now() - cur.created > 8 * 3600000)), text: 'Slept on it (draft is 8+ hours old)' },
    ];
  }
  function publishDialog() {
    persist(true);
    const items = checklist();
    $('#ws-checklist').innerHTML = items.map((c) => `<li class="${c.ok ? 'ok' : c.block ? 'bad' : 'warn'}"><b aria-hidden="true">${c.ok ? '[x]' : c.block ? '[!]' : '[ ]'}</b>${esc(c.text)}${!c.ok && c.block ? ' <em>(must fix)</em>' : ''}</li>`).join('');
    const slug = cur.path ? cur.path.replace(/^posts\/\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') : slugify(el.title.value);
    $('#ws-pub-where').innerHTML = slug ? `Goes live at <code>nobixy.github.io/${esc(slug)}/</code>${cur.path ? ' (updating the published piece)' : ''}. Unchecked boxes are advice. Only [!] blocks publishing.` : '';
    $('#ws-pub-go').disabled = items.some((c) => c.block && !c.ok) || !slug;
    $('#ws-pub-status').textContent = '';
    $('#ws-publish').showModal();
  }
  const q = (s) => `"${s.replace(/[\r\n]+/g, ' ').trim().replace(/"/g, '\\"')}"`;
  async function publish() {
    const status = $('#ws-pub-status'), go = $('#ws-pub-go');
    go.disabled = true;
    const editing = !!cur.path;
    const slug = editing ? cur.path.replace(/^posts\/\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') : slugify(el.title.value);
    const date = editing ? cur.date : today();
    const path = editing ? cur.path : `posts/${date}-${slug}.md`;
    const extra = Object.entries(cur.extra || {}).filter(([k]) => !['title', 'date', 'description'].includes(k)).map(([k, v]) => `${k}: ${/[:#"]/.test(v) ? q(v) : v}\n`).join('');
    const file = `---\n${extra}title: ${q(el.title.value)}\ndate: ${date}\ndescription: ${q(el.desc.value)}\n---\n\n${el.body.value.replace(/\s+$/, '')}\n`;
    try {
      status.textContent = 'Talking to GitHub...';
      if (!editing) {
        const names = (await gh(`/repos/${REPO}/contents/posts?ref=main`)).map((f) => f.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''));
        if (names.includes(slug)) throw new Error(`There's already a piece at /${slug}/. Change the title a little.`);
      }
      const tree = [{ path, mode: '100644', type: 'blob', content: file }];
      const kind = el.kind.value.trim();
      if (kind) {
        const site = JSON.parse(await readFile('site.json'));
        site.writing_kinds = site.writing_kinds || {};
        if (site.writing_kinds[slug] !== kind) { site.writing_kinds[slug] = kind; tree.push({ path: 'site.json', mode: '100644', type: 'blob', content: `${JSON.stringify(site, null, 2)}\n` }); }
      }
      // One commit with every file, made with the Git Data API, so the site never sees half a publish.
      let sha;
      for (let attempt = 0; attempt < 2; attempt++) {
        const ref = await gh(`/repos/${REPO}/git/ref/heads/main`);
        const base = await gh(`/repos/${REPO}/git/commits/${ref.object.sha}`);
        const t = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
        const c = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `${editing ? 'Update' : 'Publish'}: ${slug}`, tree: t.sha, parents: [ref.object.sha] }) });
        try { await gh(`/repos/${REPO}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) }); sha = c.sha; break; }
        catch (ex) { if (ex.status !== 422 || attempt) throw ex; }
      }
      Object.assign(cur, { path, date, kind }); persist(true); refresh();
      status.textContent = 'Saved to GitHub. Building the site (about a minute)...';
      await waitForBuild(sha, slug, status);
    } catch (ex) {
      status.textContent = `Not published: ${ex.message}`;
      go.disabled = false;
    }
  }
  async function waitForBuild(sha, slug, status) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const runs = await gh(`/repos/${REPO}/actions/runs?head_sha=${sha}`);
        const run = runs.workflow_runs && runs.workflow_runs[0];
        if (run && run.status === 'completed') {
          status.innerHTML = run.conclusion === 'success' ? `Live! <a href="/${esc(slug)}/" target="_blank" rel="noopener">Open /${esc(slug)}/ -></a>` : `The build ${esc(run.conclusion)}. <a href="${esc(run.html_url)}" target="_blank" rel="noopener noreferrer">See why -></a>`;
          say('Published.'); return;
        }
        status.textContent = `Building the site... (${run ? run.status.replace('_', ' ') : 'queued'})`;
      } catch {
        const res = await fetch(`/${slug}/`, { cache: 'no-store' }).catch(() => null);
        if (res && res.ok && i > 8) { status.innerHTML = `Should be live now: <a href="/${esc(slug)}/" target="_blank" rel="noopener">/${esc(slug)}/ -></a>`; return; }
        status.textContent = 'Building the site... (give the token "Actions: Read" to see progress here)';
      }
    }
    status.textContent = 'Still building. Check back in a few minutes.';
  }

  // ------------------------------------------------------------------ wire it up
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    const id = store.get('ws.current', null);
    load(drafts[id] || Object.values(drafts).sort((a, b) => b.updated - a.updated)[0] || newDraft());
    setMode('draft');
    try {
      kindsMap = JSON.parse(await readFile('site.json')).writing_kinds || {};
    } catch { kindsMap = {}; }
    $('#ws-kinds').innerHTML = [...new Set(['Story', 'Essay', 'Study notes', 'Personal', ...Object.values(kindsMap)])].map((k) => `<option value="${esc(k)}">`).join('');
    say('Logged on. Drafts save on this computer as you type. Nothing goes public until Publish.');
  }

  for (const k of ['title', 'desc', 'kind']) el[k].addEventListener('input', () => { autosave(); refresh(); });
  el.body.addEventListener('input', () => { track(); autosave(); refresh(); });
  el.body.addEventListener('keydown', (e) => {
    if (sprint && sprint.nobs && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); say('Keep going. Fix it later.'); }
  });
  document.addEventListener('keydown', (e) => {
    if (ws.hidden || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); persist(true); say('Saved on this computer.'); }
    else if (k === 'b' && document.activeElement === el.body) { e.preventDefault(); FMT.b(); }
    else if (k === 'i' && document.activeElement === el.body) { e.preventDefault(); FMT.i(); }
    else if (k === 'k' && document.activeElement === el.body) { e.preventDefault(); FMT.link(); }
  });
  ws.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    const act = t.closest('[data-act]'), modeBtn = t.closest('[data-mode]'), fmt = t.closest('[data-fmt]'), tab = t.closest('[data-tab]'), issue = t.closest('.ws-issue'), restore = t.closest('[data-restore]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'new') { persist(); load(newDraft()); el.title.focus(); say('New draft. Start anywhere.'); }
      else if (a === 'open') openDialog();
      else if (a === 'save') { persist(true); say('Saved on this computer. It goes public only when you Publish.'); }
      else if (a === 'sprint') $('#ws-sprint').showModal();
      else if (a === 'aloud') readAloud();
      else if (a === 'focus') { if (document.fullscreenElement) document.exitFullscreen(); else ws.requestFullscreen().catch(() => say('Full screen is blocked here.')); }
      else if (a === 'publish') publishDialog();
      else if (a === 'logout') { persist(); logout(); }
    }
    if (modeBtn) setMode(modeBtn.dataset.mode);
    if (fmt) FMT[fmt.dataset.fmt]();
    if (tab) {
      $$('.ws-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === tab)));
      $$('.ws-pane').forEach((p) => { p.hidden = p.id !== `ws-pane-${tab.dataset.tab}`; });
      analyze();
    }
    if (issue) jump(+issue.dataset.start, +issue.dataset.end);
    if (restore) {
      const s = cur.snapshots.find((x) => String(x.t) === restore.dataset.restore);
      if (s) { persist(true); el.body.value = s.body; el.title.value = s.title || el.title.value; persist(true); refresh(); analyze(); say('Restored. The version before it is saved in History too.'); }
    }
  });
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    if (t.closest('[data-close]')) t.closest('dialog').close();
    const sp = t.closest('[data-sprint]'); if (sp) { $('#ws-sprint').close(); startSprint(+sp.dataset.sprint); }
    const od = t.closest('[data-open-draft]'); if (od) { persist(); load(drafts[od.dataset.openDraft]); $('#ws-open').close(); }
    const op = t.closest('[data-open-post]'); if (op) openPost(op.dataset.openPost).catch((ex) => say(`Couldn't open: ${ex.message}`));
    const dd = t.closest('[data-del-draft]');
    if (dd) {
      if (dd.dataset.armed) { delete drafts[dd.dataset.delDraft]; store.set('ws.drafts', drafts); if (cur && cur.id === dd.dataset.delDraft) load(newDraft()); dd.closest('li').remove(); }
      else { dd.dataset.armed = '1'; dd.textContent = 'Sure?'; }
    }
    if (t.closest('#ws-pub-go')) publish();
  });
  window.addEventListener('beforeunload', () => persist());
})();

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
  const { words, draftLabel, draftStatus, findDrafts, markdownExport } = window.WriterCore;
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
  const newDraft = () => ({ id: `d${crypto.randomUUID()}`, title: '', desc: '', kind: '', body: '', created: Date.now(), updated: Date.now(), snapshots: [], revised: false, readAloud: false });

  function load(d) {
    cur = d;
    el.title.value = d.title; el.desc.value = d.desc; el.kind.value = d.kind;
    bindField();
    store.set('ws.current', d.id);
    renderBuild();
    setMode(d.build && d.build.stage === 'revise' ? 'revise' : 'draft');
    refresh();
  }
  function persist(snapshot = false) {
    if (!cur) return;
    Object.assign(cur, { title: el.title.value, desc: el.desc.value, kind: el.kind.value, [field()]: el.body.value, updated: Date.now() });
    const last = cur.snapshots[cur.snapshots.length - 1];
    if ((snapshot || !last || Date.now() - last.t > 5 * 60000) && cur.body.trim() && (!last || last.body !== cur.body)) {
      cur.snapshots.push({ t: Date.now(), title: cur.title, body: cur.body });
      cur.snapshots = cur.snapshots.slice(-30);
    }
    drafts[cur.id] = cur;
    try {
      store.set('ws.drafts', drafts);
      if (cur.build && ((cur.freewrite || '').trim() || (cur.build.point || '').trim() || cur.build.answered)) recordAnswer();
      $('#ws-saved').textContent = `saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; }
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
    updateBuildLive();
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
      <p class="ws-logline"><b>${week.toLocaleString()}</b> words in the last 7 days &nbsp;/&nbsp; wrote on <b>${active}</b> of the last 14 days</p>`
      + craftLine();
  }

  function craftLine() {
    const ps = allPrompts(), ans = ps.reduce((a, p) => a + p.answers.length, 0), rev = ps.reduce((a, p) => a + Math.max(0, p.answers.length - 1), 0);
    const planned = Object.values(drafts).filter((d) => d.build && d.build.beats && d.build.beats.length && ['draft', 'revise', 'publish'].includes(d.build.stage)).length;
    const due = dueNow().length;
    return `<p class="ws-logline">Prompts answered <b>${ans}</b> &nbsp;/&nbsp; revisits <b>${rev}</b> &nbsp;/&nbsp; built from a plan <b>${planned}</b>${due ? ` &nbsp;/&nbsp; <button type="button" class="ws-linkbtn" data-act="new"><b>${due}</b> due for a revisit</button>` : ''}</p>`;
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
  // Four families, each a fixed color (validated for color blindness: scripts/validate_palette.js passes),
  // and every mark also carries a text label, so color is never the only cue.
  const FAMILIES = {
    Sentences: { color: '#0066cc', types: ['Very long sentence', 'Long sentence', 'Big paragraph'], what: 'length and shape' },
    Clarity: { color: '#cc6600', types: ['Passive voice', 'Long word', 'Worn-out phrase'], what: "Orwell's rules 1, 2 and 4" },
    Clutter: { color: '#009966', types: ['Filler', 'Adverb'], what: 'words you can cut' },
    Mistakes: { color: '#993399', types: ['Doubled word', "its / it's"], what: 'probably typos' },
  };
  const FAMILY_OF = {};
  for (const [f, d] of Object.entries(FAMILIES)) for (const t of d.types) FAMILY_OF[t] = f;
  const SENTENCE_LEVEL = new Set(['Very long sentence', 'Long sentence', 'Big paragraph']);
  const STOP = new Set("a an the and or but if so of to in on at by for with from as is are was were be been being am i me my we our you your he she it its they them their this that these those there here what which who whom when where why how not no do does did done have has had will would can could should may might must just very really than then too also into out up down over about after before again more most some any all each few other such only own same both get got one like even it's i'm don't can't didn't i've i'll that's there's you're they're them him her his hers us much many way well back now still because while through off".split(' '));
  const issueKey = (i) => `${i.type}|${i.text.toLowerCase().trim()}`;

  function measure(raw) {
    const text = mask(raw);
    const issues = [];
    const add = (type, weight, start, len, hint) => issues.push({ type, family: FAMILY_OF[type], weight, start, end: start + len, hint, text: raw.slice(start, start + len) });
    const sents = sentences(text).map((s) => ({ ...s, n: (s.text.match(/[A-Za-z0-9'-]+/g) || []).length })).filter((s) => s.n > 0);
    let wc = 0, syl = 0;
    for (const s of sents) {
      const ws_ = s.text.match(/[A-Za-z0-9'-]+/g) || [];
      wc += ws_.length; syl += ws_.reduce((a, w) => a + syllables(w), 0);
      if (s.n > 35) add('Very long sentence', 5, s.start, s.text.length, `${s.n} words. Split it in two.`);
      else if (s.n > 25) add('Long sentence', 3, s.start, s.text.length, `${s.n} words. Can it be shorter?`);
    }
    const lower = text.toLowerCase();
    for (const c of CLICHES) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(c)}\\b`, 'g'))) add('Worn-out phrase', 4, m.index, c.length, 'Orwell rule 1: say it your own way.');
    for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) if (!/^(had|that|is)$/i.test(m[1])) add('Doubled word', 5, m.index, m[0].length, 'Typed twice? Delete one.');
    for (const m of text.matchAll(/\bits (a|the|not|been|going|really|just|very|so|time)\b/gi)) add("its / it's", 4, m.index, m[0].length, "Did you mean it's (it is)?");
    for (const m of text.matchAll(/\bit's (own|self)\b/gi)) add("its / it's", 4, m.index, m[0].length, 'Did you mean its?');
    for (const m of text.matchAll(PASSIVE)) add('Passive voice', 3, m.index, m[0].length, 'Orwell rule 4: who did it? Make them the subject.');
    for (const [k, v] of Object.entries(SWAPS)) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(k)}\\b`, 'g'))) add('Long word', 2, m.index, k.length, `Orwell rule 2: try "${v}".`);
    for (const f of FILLERS) for (const m of lower.matchAll(new RegExp(`\\b${reEsc(f)}\\b`, 'g'))) add('Filler', 2, m.index, f.length, 'Orwell rule 3: cut it and reread.');
    for (const m of text.matchAll(/\b[A-Za-z]+ly\b/g)) if (!NOT_ADVERBS.has(m[0].toLowerCase())) add('Adverb', 1, m.index, m[0].length, 'Would a stronger verb do the job?');
    let pos = 0;
    for (const p of raw.split(/\n\s*\n/)) { const at = raw.indexOf(p, pos); const n = words(p); if (n > 150 && !p.trim().startsWith('```')) add('Big paragraph', 2, at, Math.min(p.length, 60), `${n} words. Break it up.`); pos = at + p.length; }

    const ns = Math.max(1, sents.length);
    const tokens = lower.match(/[a-z][a-z'-]*/g) || [];
    const content = tokens.filter((w) => w.length > 2 && !STOP.has(w));
    const freq = new Map();
    for (const w of content) freq.set(w, (freq.get(w) || 0) + 1);
    const top = [...freq].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const openers = new Map();
    for (const s of sents) { const w = (s.text.toLowerCase().match(/[a-z][a-z']*/) || [''])[0]; if (w) openers.set(w, (openers.get(w) || 0) + 1); }
    const lens = sents.map((s) => s.n);
    const mean = wc / ns;
    const sd = Math.sqrt(lens.reduce((a, n) => a + (n - mean) ** 2, 0) / ns);
    return {
      issues, sents, wc, ns, sd,
      grade: wc ? 0.39 * mean + 11.8 * (syl / wc) - 15.59 : 0,
      ease: wc ? 206.835 - 1.015 * mean - 84.6 * (syl / wc) : 0,
      avg: mean,
      top, openers: [...openers].sort((a, b) => b[1] - a[1]).slice(0, 3),
      variety: content.length ? new Set(content).size / content.length : 0,
    };
  }
  const per100 = (count, wc) => (wc ? (count * 100) / wc : 0);
  function familyRates(issues, wc) {
    const out = {};
    for (const f of Object.keys(FAMILIES)) out[f] = per100(issues.filter((i) => i.family === f).length, wc);
    return out;
  }

  // Your own published writing is the yardstick: averaged once, cached for 12 hours.
  let baseline = store.get('ws.baseline', null);
  async function loadBaseline() {
    if (baseline && Date.now() - baseline.t < 12 * 3600000) return;
    try {
      const files = (await gh(`/repos/${REPO}/contents/posts?ref=main`)).filter((f) => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 12);
      const ms = [];
      for (const f of files) { const [, body] = frontMatter(await readFile(f.path)); ms.push(measure(body)); }
      if (!ms.length) return;
      const avg = (fn) => ms.reduce((a, m) => a + fn(m), 0) / ms.length;
      const fam = {};
      for (const f of Object.keys(FAMILIES)) fam[f] = avg((m) => familyRates(m.issues, m.wc)[f]);
      baseline = { t: Date.now(), n: ms.length, grade: avg((m) => m.grade), ease: avg((m) => m.ease), avg: avg((m) => m.avg), per100: avg((m) => per100(m.issues.length, m.wc)), fam };
      store.set('ws.baseline', baseline);
      if (mode === 'revise') analyze();
    } catch { /* the yardstick is a bonus; feedback works without it */ }
  }

  // ------------------------------------------------------------------ charts (inline SVG, flat 1996 colors)
  const SERIOUS = '#cc3300', INK = '#333333', MUTED = '#666699', GRID = '#cccccc';
  const tipAttr = (t) => `data-tip="${esc(t)}"`;
  function rhythmChart(m) {
    const W = 320, H = 120, L = 24, R = 4, T = 10, B = 14, n = m.sents.length;
    const max = Math.max(30, ...m.sents.map((s) => s.n));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const bw = (W - L - R) / n, gap = bw > 5 ? 2 : bw > 2 ? 1 : 0;
    let bars = '', hits = '';
    m.sents.forEach((s, i) => {
      const x = L + i * bw;
      bars += `<rect x="${(x + gap / 2).toFixed(1)}" y="${y(s.n).toFixed(1)}" width="${Math.max(0.8, bw - gap).toFixed(1)}" height="${(y(0) - y(s.n)).toFixed(1)}" fill="${s.n > 25 ? SERIOUS : '#000080'}"/>`;
      hits += `<rect class="ws-hit" x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" fill="transparent" data-start="${s.start}" data-end="${s.start + s.text.length}" ${tipAttr(`Sentence ${i + 1}: ${s.n} words. "${s.text.slice(0, 60)}${s.text.length > 60 ? '...' : ''}"`)}/>`;
    });
    return `<svg class="ws-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Words per sentence, in order. ${m.sents.filter((s) => s.n > 25).length} sentences over 25 words.">
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="${INK}"/>
      <line x1="${L}" x2="${W - R}" y1="${y(25)}" y2="${y(25)}" stroke="${SERIOUS}" stroke-dasharray="4 3"/>
      <text x="${L - 4}" y="${y(25) + 3}" text-anchor="end" class="ws-ax">25</text>
      <text x="${L - 4}" y="${y(max) + 6}" text-anchor="end" class="ws-ax">${max}</text>
      <text x="${L - 4}" y="${y(0) + 3}" text-anchor="end" class="ws-ax">0</text>
      ${bars}${hits}
      <text x="${L}" y="${H - 2}" class="ws-ax">first sentence</text><text x="${W - R}" y="${H - 2}" text-anchor="end" class="ws-ax">last</text>
    </svg>`;
  }
  function heatStrip(issues, len) {
    const W = 320, L = 62, rowH = 9, fams = Object.keys(FAMILIES), H = fams.length * rowH + 4;
    let out = '';
    fams.forEach((f, r) => {
      const yy = 2 + r * rowH;
      out += `<text x="${L - 4}" y="${yy + 7}" text-anchor="end" class="ws-ax">${f}</text><rect x="${L}" y="${yy}" width="${W - L}" height="${rowH - 2}" fill="#eeeeee"/>`;
      for (const i of issues.filter((x) => x.family === f)) {
        const x = L + (i.start / Math.max(1, len)) * (W - L);
        out += `<rect x="${x.toFixed(1)}" y="${yy}" width="2.5" height="${rowH - 2}" fill="${FAMILIES[f].color}"/>`
             + `<rect class="ws-hit" x="${(x - 3).toFixed(1)}" y="${yy}" width="8" height="${rowH - 2}" fill="transparent" data-start="${i.start}" data-end="${i.end}" ${tipAttr(`${i.type}: "${i.text.slice(0, 50)}"`)}/>`;
      }
    });
    return `<svg class="ws-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where in the piece each kind of flag sits, start to end">${out}</svg>
      <p class="ws-axis-row"><span>start of piece</span><span>end</span></p>`;
  }
  const snapCache = new Map();
  function progressChart() {
    const pts = cur.snapshots.map((s) => {
      if (!snapCache.has(s.t)) { const m = measure(s.body); snapCache.set(s.t, { t: s.t, r: per100(m.issues.length, m.wc), w: m.wc }); }
      return snapCache.get(s.t);
    });
    const live = measure(el.body.value);
    pts.push({ t: Date.now(), r: per100(live.issues.length, live.wc), w: live.wc, now: true });
    if (pts.length < 2) return '<p class="ws-note">Revision progress shows up after your first snapshot (every 5 min, or press Save).</p>';
    const W = 320, H = 110, L = 24, R = 10, T = 10, B = 14;
    const max = Math.max(2, ...pts.map((p) => p.r)) * 1.1;
    const x = (i) => L + (i / (pts.length - 1)) * (W - L - R), y = (v) => T + (H - T - B) * (1 - v / max);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.r).toFixed(1)}" r="4" fill="${p.now ? '#ffcc00' : '#000080'}" stroke="#ffffff" stroke-width="2"/>`
      + `<rect class="ws-hit ws-hit-pt" x="${(x(i) - 8).toFixed(1)}" y="${T}" width="16" height="${H - T - B}" fill="transparent" ${tipAttr(`${p.now ? 'Now' : new Date(p.t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: ${p.r.toFixed(1)} flags per 100 words, ${p.w} words`)}/>`).join('');
    const base = baseline ? `<line x1="${L}" x2="${W - R}" y1="${y(Math.min(baseline.per100, max))}" y2="${y(Math.min(baseline.per100, max))}" stroke="${MUTED}" stroke-dasharray="2 3"/><text x="${W - R}" y="${y(Math.min(baseline.per100, max)) - 3}" text-anchor="end" class="ws-ax">your published avg</text>` : '';
    const first = pts[0].r, last = pts[pts.length - 1].r;
    return `<svg class="ws-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Flags per 100 words across revisions, from ${first.toFixed(1)} to ${last.toFixed(1)}">
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="${INK}"/>
      <text x="${L - 4}" y="${y(0) + 3}" text-anchor="end" class="ws-ax">0</text><text x="${L - 4}" y="${y(max) + 6}" text-anchor="end" class="ws-ax">${max.toFixed(0)}</text>
      ${base}<path d="${path}" fill="none" stroke="#000080" stroke-width="2"/>${dots}
      <text x="${L}" y="${H - 2}" class="ws-ax">first snapshot</text><text x="${W - R}" y="${H - 2}" text-anchor="end" class="ws-ax">now</text></svg>
      <p class="ws-caption">${last < first ? `Down from <b>${first.toFixed(1)}</b> to <b>${last.toFixed(1)}</b> flags per 100 words. That's revision working.` : last > first ? `Up from <b>${first.toFixed(1)}</b> to <b>${last.toFixed(1)}</b> per 100 words. New writing adds flags. That's fine while drafting.` : `Flat at <b>${last.toFixed(1)}</b> per 100 words.`}</p>`;
  }

  function tile(label, value, sub, base, better, fmt = (v) => v.toFixed(1)) {
    let cmp = '<small class="ws-cmp">no published average yet</small>';
    if (base != null) {
      const d = value - base, good = better === 'lower' ? d <= 0 : d >= 0;
      cmp = Math.abs(d) < 0.05 ? `<small class="ws-cmp">same as your published avg</small>` : `<small class="ws-cmp ${good ? 'up' : 'down'}">${d > 0 ? '^' : 'v'} ${fmt(Math.abs(d))} ${d > 0 ? 'above' : 'below'} your avg (${fmt(base)})</small>`;
    }
    return `<div class="ws-tile"><span class="ws-tile-label">${label}</span><strong>${fmt(value)}</strong><span class="ws-tile-sub">${sub}</span>${cmp}</div>`;
  }
  function gradeGauge(g) {
    const pct = Math.max(0, Math.min(100, (g / 16) * 100));
    return `<div class="ws-gauge" role="img" aria-label="Grade level ${g.toFixed(1)} on a 0 to 16 scale; 9 or less is clear"><span class="ws-gauge-ok"></span><i style="left:${pct}%"></i></div><p class="ws-axis-row"><span>0 easy</span><span>9</span><span>16 hard</span></p>`;
  }

  let famFilter = new Set(Object.keys(FAMILIES));
  let lastMeasure = null;
  function analyze() {
    const m = measure(el.body.value);
    const ignored = new Set((cur && cur.ignored) || []);
    const all = m.issues;
    const issues = all.filter((i) => !ignored.has(issueKey(i)));
    lastMeasure = { ...m, issues };
    const pane = $('#ws-pane-feedback');
    if (!m.wc) { pane.innerHTML = '<p class="ws-empty">Write something first. Feedback shows up here in Revise mode.</p>'; renderMarked(); renderOutline(); renderPreview(); renderHistory(); return; }
    const rate = per100(issues.length, m.wc), fam = familyRates(issues, m.wc);
    const shown = issues.filter((i) => famFilter.has(i.family)).sort((a, b) => b.weight - a.weight || a.start - b.start);
    const groups = [];
    const byKey = new Map();
    for (const i of shown) {
      const k = issueKey(i);
      if (!byKey.has(k)) { const g = { ...i, occ: [] }; byKey.set(k, g); groups.push(g); }
      byKey.get(k).occ.push(`${i.start}-${i.end}`);
    }
    const item = (i) => `<li class="ws-item"><button type="button" class="ws-issue" data-start="${i.start}" data-end="${i.end}" data-occ="${i.occ.join(',')}"><span class="ws-issue-head"><span class="ws-chip" style="background:${FAMILIES[i.family].color}" aria-hidden="true"></span><b>${esc(i.type)}</b>${i.occ.length > 1 ? `<span class="ws-times">x${i.occ.length}</span>` : ''}</span><q>${esc(i.text.length > 70 ? i.text.slice(0, 70) + '...' : i.text)}</q><small>${esc(i.hint)}</small></button><button type="button" class="ws-ignore" data-ignore="${esc(issueKey(i))}" title="Ignore every one of these (for this piece)">ignore</button></li>`;
    const top = groups.slice(0, 5), rest = groups.slice(5);
    const famMax = Math.max(1, ...Object.values(fam), ...(baseline ? Object.values(baseline.fam) : [0]));
    const famRows = Object.entries(FAMILIES).map(([f, d]) => {
      const count = issues.filter((i) => i.family === f).length;
      const b = baseline ? baseline.fam[f] : null;
      return `<button type="button" class="ws-fam" data-fam="${f}" aria-pressed="${famFilter.has(f)}" ${tipAttr(`${f} (${d.what}): ${count} flags, ${fam[f].toFixed(1)} per 100 words${b != null ? `. Your published average: ${b.toFixed(1)}` : ''}. Click to show or hide in the list.`)}>
        <span class="ws-fam-name"><span class="ws-chip" style="background:${d.color}" aria-hidden="true"></span>${f}</span>
        <span class="ws-fam-track"><span class="ws-fam-bar" style="width:${(fam[f] / famMax) * 100}%;background:${d.color}"></span>${b != null ? `<span class="ws-fam-base" style="left:${(b / famMax) * 100}%"></span>` : ''}</span>
        <span class="ws-fam-num">${count} <small>(${fam[f].toFixed(1)})</small></span></button>`;
    }).join('');
    const over = m.sents.filter((s) => s.n > 25).length;
    const lens = m.sents.map((s) => s.n);
    const rhythmNote = m.ns >= 6 && m.sd < 4 ? '<b>Same-y rhythm:</b> most sentences are about the same length. Drop in a short one. Then a long one.' : over ? `<b>${over}</b> sentence${over > 1 ? 's' : ''} over 25 words (red). Longest: ${Math.max(...lens)}. Shortest: ${Math.min(...lens)}.` : `Good mix. Longest: ${Math.max(...lens)} words, shortest: ${Math.min(...lens)}.`;
    const [op, opc] = m.openers[0] || ['', 0];
    const openerNote = m.ns >= 6 && opc / m.ns > 0.25 ? `<p class="ws-caption"><b>${opc} of ${m.ns}</b> sentences start with "${esc(op)}". Vary how they open.</p>` : '';
    const topMax = m.top.length ? m.top[0][1] : 1;
    pane.innerHTML = `
      <div class="ws-tiles">
        <div class="ws-tile ws-tile-wide"><span class="ws-tile-label">GRADE LEVEL</span><strong>${m.grade > 0 ? m.grade.toFixed(1) : '-'}</strong><span class="ws-tile-sub">${m.grade <= 9 ? 'Clear. Most adults read this easily.' : 'Dense. Aim for 9 or less.'}</span>${gradeGauge(Math.max(0, m.grade))}${baseline ? tile('', m.grade, '', baseline.grade, 'lower').match(/<small[\s\S]*<\/small>/)[0] : ''}</div>
        ${tile('READING EASE', Math.max(0, m.ease), '0-100, higher is easier', baseline && baseline.ease, 'higher', (v) => v.toFixed(0))}
        ${tile('WORDS / SENTENCE', m.avg, 'average', baseline && baseline.avg, 'lower')}
        ${tile('FLAGS / 100 WORDS', rate, `${issues.length} flags in ${m.wc} words`, baseline && baseline.per100, 'lower')}
        ${tile('WORD VARIETY', m.variety * 100, 'different words / all words (minus the, and, is...)', null, 'higher', (v) => `${v.toFixed(0)}%`).replace('<small class="ws-cmp">no published average yet</small>', '')}
      </div>
      ${baseline ? `<p class="ws-note">Compared with the average of your ${baseline.n} published pieces.</p>` : ''}

      <h3 class="subheading">SENTENCE RHYTHM</h3>${rhythmChart(m)}<p class="ws-caption">${rhythmNote}</p>${openerNote}

      <h3 class="subheading">FLAGS BY KIND <small>(per 100 words, | = your avg)</small></h3><div class="ws-fams">${famRows}</div>

      <h3 class="subheading">WHERE THEY ARE</h3>${heatStrip(issues, el.body.value.length)}

      <h3 class="subheading">FIX THESE FIRST</h3>
      ${top.length ? `<ul class="ws-issues">${top.map(item).join('')}</ul>` : '<p class="ws-empty">Nothing flagged here. Read it aloud next.</p>'}
      ${rest.length ? `<details class="phase-details"><summary>EVERYTHING ELSE (${rest.length}) <span aria-hidden="true">[ + ]</span></summary><ul class="ws-issues">${rest.map(item).join('')}</ul></details>` : ''}
      ${ignored.size ? `<p class="ws-note">${ignored.size} ignored for this piece. <button type="button" class="ws-linkbtn" data-unignore>Show them again</button></p>` : ''}

      <h3 class="subheading">REVISION PROGRESS</h3>${progressChart()}

      ${m.top.length ? `<h3 class="subheading">WORDS YOU LEAN ON</h3><ul class="ws-words">${m.top.map(([w, c]) =>
        `<li><button type="button" class="ws-word" data-word="${esc(w)}" ${tipAttr(`"${w}" appears ${c} times. Click to step through them.`)}><span>${esc(w)}</span><span class="ws-word-track"><span style="width:${(c / topMax) * 100}%"></span></span><span class="ws-word-num">${c}</span></button></li>`).join('')}</ul>
        <p class="ws-caption">Repeats aren't wrong. But if one word keeps showing up, try a synonym or cut a few.</p>` : ''}

      <p class="ws-note">These are hints, not rules. Orwell's rule 6: break any of them before you write something ugly.</p>`;
    renderMarked(); renderOutline(); renderPreview(); renderHistory();
  }
  const analyzeSoon = debounce(analyze, 400);

  // The piece with every flag marked in place: blue tint for long sentences, colored underlines for the rest.
  function renderMarked() {
    const raw = el.body.value, pane = $('#ws-pane-marked');
    if (!pane) return;
    const issues = (lastMeasure && lastMeasure.issues) || [];
    if (!raw.trim()) { pane.innerHTML = '<p class="ws-empty">Nothing to mark yet.</p>'; return; }
    const cuts = new Set([0, raw.length]);
    for (const i of issues) { cuts.add(i.start); cuts.add(i.end); }
    const pts = [...cuts].sort((a, b) => a - b);
    let html = '';
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], seg = esc(raw.slice(a, b));
      const on = issues.filter((i) => i.start <= a && i.end >= b);
      if (!on.length) { html += seg; continue; }
      const long = on.find((i) => SENTENCE_LEVEL.has(i.type));
      const word = on.filter((i) => !SENTENCE_LEVEL.has(i.type)).sort((x, y) => y.weight - x.weight)[0];
      const top = word || long;
      const style = `${long ? 'background:#ddeeff;' : ''}${word ? `border-bottom:3px solid ${FAMILIES[word.family].color};` : ''}`;
      html += `<span class="ws-mark" style="${style}" data-start="${top.start}" data-end="${top.end}" ${tipAttr(on.map((i) => `${i.type}: ${i.hint}`).join(' | '))}>${seg}</span>`;
    }
    pane.innerHTML = `<p class="ws-legend">${Object.entries(FAMILIES).map(([f, d]) => `<span><i style="background:${d.color}"></i>${f}</span>`).join('')}<span><i class="ws-legend-tint"></i>Long sentence</span></p><div class="ws-marked">${html}</div>`;
  }

  // One tooltip for every chart and mark in the side panel.
  const tip = document.createElement('div');
  tip.className = 'ws-tip'; tip.hidden = true; document.body.appendChild(tip);
  document.addEventListener('mouseover', (e) => {
    const t = e.target instanceof Element && e.target.closest('.ws-side [data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip'); tip.hidden = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`;
  });

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
    const b = cur && cur.build;
    const plan = b && b.beats && b.beats.length ? `<h3 class="subheading">YOUR PLAN</h3>${b.point ? `<p class="ws-caption"><b>Point:</b> ${esc(b.point)}</p>` : ''}<ol class="ws-planlist">${b.beats.map((x) => `<li class="${raw.includes(`TK ${x.label}`) ? '' : 'done'}"><b>${esc(x.label)}</b> ${esc(x.note || '')}</li>`).join('')}</ol><p class="ws-note">Does each paragraph below do one beat's job? A paragraph with no beat is a candidate to cut. A beat with no paragraph is a hole.</p><h3 class="subheading">WHAT YOU WROTE</h3>` : '';
    $('#ws-pane-outline').innerHTML = plan + (rows.length ? `<p class="ws-note">Revise big before small. Each paragraph's first sentence should say what it's for. If two say the same thing, merge them. If one goes nowhere, cut it.</p><ol class="ws-issues ws-outline">${rows.join('')}</ol>` : '<p class="ws-empty">No paragraphs yet.</p>');
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

  // ------------------------------------------------------------------ build-up: prompt -> freewrite -> point -> plan -> draft
  // A new piece can start from a prompt and climb small steps to a real draft. Every answer to a prompt is kept
  // (this browser only), and answered prompts come back later so you can see how your thinking moved.
  const PROMPTS = [
    ['Memory', 'Describe the first time a computer did something that felt like magic to you.'],
    ['Memory', 'Write about a job you had and one person there you still think about.'],
    ['Memory', 'What is a moment you were proud of that nobody else saw?'],
    ['Memory', 'Describe a place you went almost every day for a year. What did it teach you?'],
    ['Memory', 'Write about a time you quit something. Was it the right call?'],
    ['Memory', 'What did your family believe about work when you were growing up?'],
    ['Belief', "What is something you believe that most people around you don't?"],
    ['Belief', 'What does school get wrong about learning?'],
    ['Belief', "Is talent real, or is it just practice nobody saw?"],
    ['Belief', 'What does it mean to be good at your job?'],
    ['Belief', 'Will AI make people better at things, or lazier?'],
    ['Belief', 'What do you owe the people who helped you get where you are?'],
    ['Work', 'What does a good shift feel like? A bad one?'],
    ['Work', 'What have customers taught you about people?'],
    ['Work', 'What do you think about on the ride home?'],
    ['Work', 'How do you make yourself do something when you have nothing left?'],
    ['Work', 'What would you do with two extra hours every day?'],
    ['Craft', "Explain one thing you learned this week to someone who's never coded."],
    ['Craft', 'What problem beat you recently, and what did it teach you?'],
    ['Craft', 'Why do you want to build software? Answer without saying money.'],
    ['Craft', 'Pick a tool or app you use every day. How would you make it better?'],
    ['Craft', "What's the difference between knowing something and being able to do it?"],
    ['Future', 'Describe a normal Tuesday five years from now.'],
    ['Future', 'What do you want people at work to say about you when you leave the room?'],
    ['Future', 'Write a letter to yourself from one year ago.'],
    ['Future', "What are you afraid happens if you don't change anything?"],
    ['Future', 'What would make this year a win, even if nothing big happens?'],
    ['Self', 'What do you do when nobody is telling you what to do?'],
    ['Self', "What habit are you trying to build, and why does it keep slipping?"],
    ['Self', 'When do you feel most like yourself?'],
    ['Self', "What's something you changed your mind about this year?"],
    ['Self', 'Who taught you the most without trying to teach you anything?'],
  ].map(([g, text], i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, g, text }));
  const REVISIT_DAYS = [7, 30, 90, 180];
  const DAY = 864e5;
  const mmddyy = (t) => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`; };
  let saved = store.get('ws.prompts', {});
  const savePrompts = () => store.set('ws.prompts', saved);
  const allPrompts = () => [...PROMPTS.map((p) => ({ ...p, answers: (saved[p.id] && saved[p.id].answers) || [] })), ...Object.values(saved).filter((p) => p.mine)];
  const promptById = (id) => allPrompts().find((p) => p.id === id);
  const lastT = (p) => Math.max(0, ...p.answers.map((a) => a.t));
  const dueAt = (p) => (p.answers.length ? lastT(p) + REVISIT_DAYS[Math.min(p.answers.length - 1, REVISIT_DAYS.length - 1)] * DAY : null);
  const dueNow = () => allPrompts().filter((p) => { const d = dueAt(p); return d && d <= Date.now(); });
  const prevAnswers = (b) => { const p = promptById(b.pid); return p ? p.answers.filter((a) => a.draftId !== cur.id).sort((x, y) => x.t - y.t) : []; };
  const comparedAnswer = (b) => { const prev = prevAnswers(b); return prev.find((a) => a.t === b.cmpWith) || prev.at(-1); };

  function recordAnswer() {
    const b = cur && cur.build; if (!b || !b.pid) return;
    const p = saved[b.pid] || (saved[b.pid] = { id: b.pid, text: b.text, answers: [] });
    p.answers = p.answers || [];
    let a = p.answers.find((x) => x.draftId === cur.id);
    if (!a) { a = { t: Date.now(), draftId: cur.id }; p.answers.push(a); }
    Object.assign(a, { freewrite: cur.freewrite || '', point: b.point || '', reflect: b.reflect || '', slug: b.slug || a.slug || '' });
    b.answered = true;
    savePrompts();
  }

  const SHAPES = {
    story: { name: 'Story', kind: 'Story', what: 'Something happened and it changed you.', beats: [
      ['Hook', 'Drop the reader into one moment: a place, a sound, a line someone said.'],
      ['Setup', 'Who, where, and what you wanted.'],
      ['Trouble', 'What got in the way.'],
      ['Turn', 'The moment it changed. Slow down here.'],
      ['Landing', 'What you know now. Tie it back to the hook.']] },
    essay: { name: 'Argument', kind: 'Essay', what: 'You think something and want to convince a stranger.', beats: [
      ['Hook', 'A question, a surprising fact, or a tiny story.'],
      ['Claim', 'Your point, said plainly.'],
      ['Reason 1', 'Why it is true, plus one real example.'],
      ['Reason 2', 'Another reason, another example.'],
      ['Pushback', 'The best argument against you, and your answer.'],
      ['So what', 'Why it matters to the reader.']] },
    explain: { name: 'Explainer', kind: 'Study notes', what: 'You learned how something works.', beats: [
      ['Question', 'What are we explaining, and why care?'],
      ['Short answer', 'One paragraph a 12-year-old would get.'],
      ['How it works', 'Step by step. One idea per paragraph.'],
      ['Gotcha', 'Where people (or you) get it wrong.'],
      ['Why it matters', 'Where this shows up in real life.']] },
    reflect: { name: 'Reflection', kind: 'Journal', what: 'Then vs now: how your thinking moved.', beats: [
      ['Then', 'What you believed or did before.'],
      ['Now', 'What you believe or do now.'],
      ['Why', 'What changed you. Be specific.'],
      ['Still unsure', "The part you haven't figured out yet."]] },
  };
  const STAGE_INFO = {
    freewrite: ['Freewrite', "Freewriting splits finding ideas from judging them (Peter Elbow's trick). Write fast. Bad sentences are allowed. Stopping isn't."],
    point: ['Find the point', "If you can't say it in one sentence, you don't know it yet. The real point often hides near the end of a freewrite. Look there first."],
    compare: ['Then vs now', "Your old answer is a snapshot of an older you. Don't grade it. Notice what moved and what stayed put."],
    plan: ['Plan', 'Structure is how a reader follows you. Pick a shape and give every beat one job. A beat with no job gets cut.'],
    draft: ['Draft', 'Replace each TK line with real sentences, in any order. Steal good lines from your freewrite. No polishing yet.'],
    revise: ['Revise', 'Big before small. Does every paragraph serve your point? Then fix sentences. Then words.'],
    publish: ['Publish', 'Done beats perfect. Ship it, then start the next one.'],
  };
  const stagesFor = (b) => Object.keys(STAGE_INFO).filter((s) => s !== 'compare' || b.revisit);
  const FW_STAGES = new Set(['freewrite', 'point', 'compare', 'plan', 'kept']);
  const field = () => (cur && cur.build && FW_STAGES.has(cur.build.stage) ? 'freewrite' : 'body');

  // The editor shows the freewrite during the early steps and the draft after. Once you move past the
  // freewrite it locks: it's the honest record of your first thoughts, which is what a revisit compares.
  function bindField() {
    const f = field();
    el.body.value = cur[f] || '';
    el.body.readOnly = f === 'freewrite' && cur.build.stage !== 'freewrite';
    $$('.ws-format [data-fmt]').forEach((button) => { button.disabled = el.body.readOnly; });
    el.body.placeholder = f !== 'freewrite' ? "Start anywhere. Don't fix anything yet. Keep the pen moving."
      : el.body.readOnly ? 'Your freewrite is locked: it is the record of your first thoughts.' : 'Answer the prompt. Fast. No fixing. Keep the pen moving.';
    lastCount = words(el.body.value); sessionStart = lastCount;
  }

  function startPrompt(p) {
    if (!p) return;
    persist();
    const d = Object.assign(newDraft(), { freewrite: '' });
    d.build = { pid: p.id, text: p.text, stage: 'freewrite', revisit: p.answers.length > 0, point: '', who: '', reflect: '', shape: '', beats: [], openThen: true, answered: false };
    load(d); persist();
    $$('dialog[open]').forEach((x) => x.close());
    el.body.focus();
    say(d.build.revisit ? 'Revisit: write it fresh. Your old answer stays hidden until you have a point.' : 'Prompt picked. Freewrite first: fast, no fixing.');
  }

  function draftFromPlan() {
    const b = cur.build, out = [];
    const then = b.revisit && b.openThen && comparedAnswer(b);
    if (then && then.point) out.push(`> On ${mmddyy(then.t)} I wrote: "${then.point}"`);
    for (const x of b.beats) out.push(beatLine(x));
    b.placed = b.beats.map((x) => x.label);
    return `${out.join('\n\n')}\n`;
  }

  const beatLine = (x) => `TK ${x.label}: ${x.note.trim() || x.help}`;
  function setStage(s) {
    const b = cur && cur.build; if (!b) return;
    if (s === 'publish') { publishDialog(); return; }
    persist();
    // Any freewrite counts as an answer, even when you skip steps, so the prompt still comes back for a revisit.
    if ((cur.freewrite || '').trim() || b.point.trim() || s === 'kept') recordAnswer();
    if (['draft', 'revise'].includes(s) && !cur.body.trim()) {
      cur.body = b.beats.length ? draftFromPlan() : cur.freewrite || '';
      if (b.shape && !el.kind.value.trim()) el.kind.value = SHAPES[b.shape].kind;
    } else if (['draft', 'revise'].includes(s) && b.beats.length) {
      // Back from Plan with a draft already going: add only the beats that never made it into the draft.
      const placed = new Set(b.placed || b.beats.filter((x) => cur.body.includes(`TK ${x.label}`)).map((x) => x.label));
      const fresh = b.beats.filter((x) => !placed.has(x.label));
      if (fresh.length) { cur.body = `${cur.body.replace(/\s+$/, '')}\n\n${fresh.map(beatLine).join('\n\n')}\n`; b.placed = [...placed, ...fresh.map((x) => x.label)]; say(`Added ${fresh.length} new beat${fresh.length > 1 ? 's' : ''} to the end of your draft.`); }
    }
    b.stage = s;
    if (s === 'plan' && !b.shape && b.revisit) pickShape('reflect', false);
    bindField(); persist();
    setMode(s === 'revise' ? 'revise' : 'draft');
    renderBuild(); refresh();
    if (s === 'draft') { const i = el.body.value.indexOf('TK '); el.body.focus(); if (i >= 0) el.body.setSelectionRange(i, el.body.value.indexOf('\n', i)); }
    else if (!el.body.readOnly) el.body.focus();
    if (s === 'kept') say(`Kept in your Prompt Journal. This prompt comes back ${mmddyy(dueAt(promptById(b.pid)) || Date.now())}.`);
  }

  function pickShape(key, render = true) {
    const b = cur.build, sh = SHAPES[key]; if (!sh) return;
    const old = new Map(b.beats.map((x) => [x.label, x.note]));
    b.shape = key;
    b.beats = sh.beats.map(([label, help]) => ({ label, help, note: old.get(label) || (['Claim', 'Now'].includes(label) ? b.point : '') || '' }));
    persist();
    if (render) renderBuild();
  }

  let cands = [];
  function candidates(text) {
    const KEY = /\b(i think|i reali[sz]ed?|i guess|i believe|i know|i want|maybe|the truth|the thing is|because|actually|never|always|what matters|i learned)\b/gi;
    const ss = sentences(text).map((s) => s.text.replace(/\s+/g, ' ')).filter((s) => { const n = words(s); return n >= 6 && n <= 40; });
    return ss.map((s, i) => ({ s, score: (s.match(KEY) || []).length + (i >= ss.length - 3 ? 1.5 : 0) + (i === ss.length - 1 ? 1 : 0) }))
      .sort((x, y) => y.score - x.score).filter((x) => x.score > 0).slice(0, 3).map((x) => x.s);
  }
  function wordFreq(text) {
    const f = new Map();
    for (const w of (text.toLowerCase().match(/[a-z][a-z'-]*/g) || [])) if (w.length > 2 && !STOP.has(w)) f.set(w, (f.get(w) || 0) + 1);
    return f;
  }
  const beatItems = () => cur.build.beats.map((x) => { const done = !el.body.value.includes(`TK ${x.label}`); return `<li class="${done ? 'done' : ''}">${done ? '[x]' : '[ ]'} ${esc(x.label)}</li>`; }).join('');
  const pointLine = (b) => (b.point.trim() ? `<p class="ws-point"><b>POINT</b> ${esc(b.point)}</p>` : '<p class="ws-note">No point sentence yet. <button type="button" class="ws-linkbtn" data-stage-go="point">Find it</button> before you plan.</p>');

  function compareHtml(b) {
    const prev = prevAnswers(b), then = comparedAnswer(b);
    if (!then) return '<p class="ws-empty">No earlier answer to compare with.</p>';
    const A = wordFreq(`${then.freewrite} ${then.point}`), B = wordFreq(`${cur.freewrite || ''} ${b.point}`);
    const only = (X, Y) => [...X].filter(([w]) => !Y.has(w)).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([w]) => esc(w)).join(', ') || '-';
    const union = new Set([...A.keys(), ...B.keys()]).size, shared = [...A.keys()].filter((w) => B.has(w)).length;
    const pct = union ? Math.round((shared * 100) / union) : 0;
    const gap = Math.round((Date.now() - then.t) / DAY);
    const col = (label, a) => { const n = words(a.freewrite || ''); return `<div class="ws-tn-col"><h4>${label}</h4><blockquote>${a.point ? esc(a.point) : '<i>no point sentence</i>'}</blockquote><small>${n} word${n === 1 ? '' : 's'} of freewrite</small></div>`; };
    const pick = prev.length > 1 ? `<p class="ws-cmp-pick">Compare with: ${prev.map((a, i) => `<button type="button" class="ws-step${a === then ? ' now' : ''}" data-cmp="${a.t}">${i === 0 ? 'first ' : i === prev.length - 1 ? 'last ' : ''}${mmddyy(a.t)}</button>`).join('')}</p>` : '';
    return `${pick}<div class="ws-tn">${col(`THEN ${mmddyy(then.t)}`, then)}${col('NOW', { point: b.point, freewrite: cur.freewrite })}</div>
      <p class="ws-caption">${gap} day${gap === 1 ? '' : 's'} apart. <b>${pct}%</b> of your words overlap. ${pct < 20 ? 'You came at it from somewhere new.' : pct > 45 ? 'Same ground. Is the thinking the same too?' : 'Some old ground, some new.'}</p>
      <p class="ws-caption"><b>Only then:</b> ${only(A, B)}<br><b>Only now:</b> ${only(B, A)}</p>
      ${prev.length > 1 ? `<h3 class="subheading">EVERY TIME YOU ANSWERED</h3><ol class="ws-timeline">${prev.map((a) => `<li><b>${mmddyy(a.t)}</b> ${esc(a.point || '(no point)')}</li>`).join('')}<li><b>now</b> ${esc(b.point)}</li></ol>` : ''}
      <details class="ws-peek"><summary>Read the old freewrite</summary><div class="ws-fw">${esc(then.freewrite || '')}</div>${then.reflect ? `<p class="ws-caption"><b>What you said changed, back then:</b> ${esc(then.reflect)}</p>` : ''}</details>
      <label class="ws-field">What changed in you? Why? <textarea id="ws-b-reflect" rows="3">${esc(b.reflect || '')}</textarea></label>
      <label class="ws-check"><input type="checkbox" id="ws-b-openthen"${b.openThen ? ' checked' : ''}> If I build a piece, open it with what I said back then</label>
      <p class="ws-choices"><button type="button" class="dlg-btn" data-stage-go="kept">Keep it as a journal entry</button><button type="button" class="dlg-btn" data-stage-go="plan">Build it into a piece -&gt;</button></p>`;
  }

  function coach(b) {
    const why = (s) => `<p class="ws-why"><b>WHY THIS STEP</b> ${STAGE_INFO[s][1]}</p>`;
    const prev = b.revisit ? prevAnswers(b) : [];
    switch (b.stage) {
      case 'freewrite': return `${why('freewrite')}
        ${prev.length ? `<p class="ws-note">You answered this ${prev.length} time${prev.length > 1 ? 's' : ''} before, last on ${mmddyy(prev.at(-1).t)}. No peeking: write it fresh, then compare.</p>` : ''}
        <p class="ws-choices"><button type="button" class="dlg-btn" data-fw-sprint>Start a 10 min freewrite (no backspace)</button><button type="button" class="dlg-btn" data-stage-go="point">Done: find the point -&gt;</button></p>
        <p class="ws-note" id="ws-fw-count"></p>`;
      case 'point':
        cands = candidates(cur.freewrite || '');
        return `${why('point')}
        ${cands.length ? `<p class="ws-note">Lines from your freewrite that sound like a point. Click one, or select your own line in the editor and press Grab.</p><ul class="ws-cands">${cands.map((c, i) => `<li><button type="button" class="ws-cand" data-cand="${i}">${esc(c)}</button></li>`).join('')}</ul>` : '<p class="ws-note">Select the truest line in your freewrite and press Grab, or just write it below.</p>'}
        <label class="ws-field">In one sentence, what do I actually think? <input id="ws-b-point" maxlength="300" value="${esc(b.point)}" placeholder="What I actually think is..."></label>
        <label class="ws-field">Who is it for, and what should they walk away with? <input id="ws-b-who" maxlength="200" value="${esc(b.who || '')}" placeholder="Someone who... / They should leave knowing..."></label>
        <p class="ws-choices"><button type="button" class="dlg-btn" data-grab>Grab the selected line</button>${b.revisit ? '' : '<button type="button" class="dlg-btn" data-stage-go="kept">Keep it as a journal entry</button>'}<button type="button" class="dlg-btn" data-stage-go="${b.revisit ? 'compare' : 'plan'}">Next: ${b.revisit ? 'then vs now' : 'plan it'} -&gt;</button></p>`;
      case 'compare': return why('compare') + compareHtml(b);
      case 'plan': return `${why('plan')}${pointLine(b)}
        <div class="ws-shapes">${Object.entries(SHAPES).map(([k, s]) => `<button type="button" class="ws-shape" data-shape="${k}" aria-pressed="${b.shape === k}">${s.name}<small>${s.what}</small></button>`).join('')}</div>
        ${b.beats.length ? `<ol class="ws-beats">${b.beats.map((x, i) => `<li><label><span>${i + 1}. ${esc(x.label)} <small>${esc(x.help)}</small></span><input data-beat="${i}" maxlength="240" value="${esc(x.note)}" placeholder="What goes here? A few words."></label><button type="button" class="ws-ignore" data-beat-del="${i}" title="Remove this beat">X</button></li>`).join('')}</ol>
        <p class="ws-choices"><button type="button" class="dlg-btn" data-beat-add>+ Add a beat</button><button type="button" class="dlg-btn" data-stage-go="draft">${cur.body.trim() ? 'Back to the draft (adds any new beats) -&gt;' : 'Build the draft from this plan -&gt;'}</button></p>` : '<p class="ws-note">Pick a shape. You can change every beat after.</p>'}`;
      case 'draft': return `${why('draft')}${pointLine(b)}
        ${b.beats.length ? `<ul class="ws-beatlist" id="ws-beatlist">${beatItems()}</ul>` : ''}
        <details class="ws-peek"><summary>Peek at your freewrite</summary><div class="ws-fw">${esc(cur.freewrite || '')}</div></details>
        <p class="ws-choices"><button type="button" class="dlg-btn" data-stage-go="revise">Ready to revise -&gt;</button></p>`;
      case 'revise': return `${why('revise')}${pointLine(b)}
        <p class="ws-choices"><button type="button" class="dlg-btn" data-open-tab="outline">Plan vs what you wrote</button><button type="button" class="dlg-btn" data-act="aloud">Read it aloud</button><button type="button" class="dlg-btn" data-stage-go="publish">Publish -&gt;</button></p>`;
      case 'publish': return b.slug ? `<p class="ws-why"><b>SHIPPED</b> Live at <a href="/${esc(b.slug)}/" target="_blank" rel="noopener">/${esc(b.slug)}/</a>. This prompt comes back for a revisit on ${mmddyy(dueAt(promptById(b.pid)) || Date.now())}. See how you've changed then.</p>`
        : `${why('publish')}<p class="ws-choices"><button type="button" class="dlg-btn" data-act="publish">Open the publish checklist</button></p>`;
      case 'kept': return `<p class="ws-why"><b>KEPT</b> Saved in your Prompt Journal (toolbar: Journal). This prompt comes back on ${mmddyy(dueAt(promptById(b.pid)) || Date.now())}.</p>
        <p class="ws-choices"><button type="button" class="dlg-btn" data-stage-go="plan">Build it into a piece anyway -&gt;</button></p>`;
      default: return '';
    }
  }

  function renderBuild() {
    const box = $('#ws-build'), b = cur && cur.build;
    box.hidden = !b;
    if (!b) { box.innerHTML = ''; return; }
    const list = stagesFor(b), at = b.stage === 'kept' ? list.indexOf(b.revisit ? 'compare' : 'point') + 1 : list.indexOf(b.stage);
    box.innerHTML = `<p class="ws-prompt-line"><span>${b.revisit ? 'REVISITING A PROMPT' : 'PROMPT'}</span>${esc(b.text)}</p>
      <ol class="ws-steps" aria-label="Steps from prompt to piece">${list.map((s, i) => `<li><button type="button" class="ws-step${i === at ? ' now' : i < at ? ' done' : ''}" data-stage-go="${s}"${i === at ? ' aria-current="step"' : ''}><b>${i < at ? 'x' : i + 1}</b>${STAGE_INFO[s][0]}</button></li>`).join('')}</ol>
      <div class="ws-coach">${coach(b)}</div>`;
    updateBuildLive();
  }
  function updateBuildLive() {
    if (!cur || !cur.build) return;
    const bl = $('#ws-beatlist'); if (bl) bl.innerHTML = beatItems();
    const fc = $('#ws-fw-count'); if (fc) { const n = words(el.body.value); fc.textContent = n < 150 ? `${n} words. Aim for 150+ before you move on.` : `${n} words. Enough to work with. Keep going or move on.`; }
  }

  function buildClick(t) {
    const b = cur && cur.build; if (!b) return;
    const go = t.closest('[data-stage-go]'); if (go) { setStage(go.dataset.stageGo); return; }
    if (t.closest('[data-fw-sprint]')) { $('#ws-nobs').checked = true; startSprint(10); return; }
    if (t.closest('[data-grab]')) {
      const s = el.body.value.slice(el.body.selectionStart, el.body.selectionEnd).replace(/\s+/g, ' ').trim();
      if (!s) { say('Select a line in your freewrite first, then press Grab.'); return; }
      b.point = s; persist(); renderBuild(); return;
    }
    const c = t.closest('[data-cand]'); if (c) { b.point = cands[+c.dataset.cand] || b.point; persist(); renderBuild(); return; }
    const sh = t.closest('[data-shape]'); if (sh) { pickShape(sh.dataset.shape); return; }
    if (t.closest('[data-beat-add]')) {
      const used = new Set([...b.beats.map((beat) => beat.label), ...(b.placed || [])]);
      let number = b.beats.length + 1;
      while (used.has(`Beat ${number}`)) number++;
      b.beats.push({ label: `Beat ${number}`, help: 'Give it one job.', note: '' });
      persist(); renderBuild(); return;
    }
    const del = t.closest('[data-beat-del]'); if (del) { b.beats.splice(+del.dataset.beatDel, 1); persist(); renderBuild(); return; }
    const cmp = t.closest('[data-cmp]'); if (cmp) { b.cmpWith = +cmp.dataset.cmp; persist(); renderBuild(); return; }
    const ot = t.closest('[data-open-tab]'); if (ot) { if (mode !== 'revise') setMode('revise'); $(`.ws-tabs [data-tab="${ot.dataset.openTab}"]`).click(); }
  }
  $('#ws-build').addEventListener('input', (e) => {
    const b = cur && cur.build, t = e.target; if (!b) return;
    if (t.id === 'ws-b-point') b.point = t.value;
    else if (t.id === 'ws-b-who') b.who = t.value;
    else if (t.id === 'ws-b-reflect') b.reflect = t.value;
    else if (t.id === 'ws-b-openthen') b.openThen = t.checked;
    else if (t.dataset.beat != null && b.beats[+t.dataset.beat]) b.beats[+t.dataset.beat].note = t.value;
    else return;
    autosave();
  });

  // ------------------------------------------------------------------ new piece + prompt journal dialogs
  function renderNew() {
    const ps = allPrompts(), now = Date.now(), due = dueNow();
    const soon = ps.filter((p) => { const d = dueAt(p); return d && d > now; }).sort((a, b) => dueAt(a) - dueAt(b));
    const groups = [...new Set(ps.map((p) => p.g))];
    const row = (p) => `<li><span>${esc(p.text)}${p.answers.length ? ` <small>answered ${p.answers.length}x</small>` : ''}</span><button type="button" class="dlg-btn" data-start-prompt="${p.id}">${p.answers.length ? 'Revisit' : 'Write'}</button></li>`;
    $('#ws-new-body').innerHTML = `
      <h3 class="subheading">DUE FOR A REVISIT</h3>
      ${due.length ? `<p class="ws-note">Same prompt, new you. Write it fresh, then see what changed.</p><ul class="ws-list">${due.map((p) => `<li><span><b>${esc(p.text)}</b> <small>answered ${p.answers.length}x, last ${mmddyy(lastT(p))}</small></span><button type="button" class="dlg-btn" data-start-prompt="${p.id}">Revisit</button></li>`).join('')}</ul>`
        : `<p class="ws-note">Nothing due. ${soon.length ? `Next: "${esc(soon[0].text)}" on ${mmddyy(dueAt(soon[0]))}.` : 'Answer a prompt and it comes back after 7 days, then 30, 90 and 180.'}</p>`}
      <h3 class="subheading">PICK A PROMPT</h3>
      <p class="ws-choices"><button type="button" class="dlg-btn" data-lucky>I'm Feeling Lucky</button></p>
      ${groups.map((g) => { const gp = ps.filter((p) => p.g === g); return `<details class="ws-pgroup"><summary>${esc(g)} <small>(${gp.length})</small></summary><ul class="ws-list">${gp.map(row).join('')}</ul></details>`; }).join('')}
      <h3 class="subheading">YOUR OWN PROMPT</h3>
      <form class="ws-own" id="ws-own"><input id="ws-own-text" maxlength="200" placeholder="A question you want to answer..." aria-label="Your own prompt"><button type="submit" class="dlg-btn">Start</button></form>
      <h3 class="subheading">NO PROMPT</h3>
      <p class="ws-choices"><button type="button" class="dlg-btn" data-blank>Blank page</button></p>`;
  }

  function renderJournal() {
    persist();
    const ps = allPrompts().filter((p) => p.answers.length).sort((a, b) => lastT(b) - lastT(a));
    $('#ws-journal-body').innerHTML = `<p class="ws-note">Every prompt you've answered, every time you answered it. Kept on this computer only, so export a backup now and then.</p>
      <p class="ws-choices"><button type="button" class="dlg-btn" data-export>Export backup</button><label class="dlg-btn ws-file">Import backup<input type="file" id="ws-import" accept=".json,application/json" hidden></label></p>
      ${ps.length ? ps.map((p) => { const d = dueAt(p); return `<section class="ws-jentry"><h4>${esc(p.text)}</h4>
        <p class="ws-note">${p.answers.length} answer${p.answers.length > 1 ? 's' : ''}. ${d <= Date.now() ? '<b>Due for a revisit.</b>' : `Comes back ${mmddyy(d)}.`} <button type="button" class="ws-linkbtn" data-start-prompt="${p.id}">Revisit now</button></p>
        <ol class="ws-timeline">${p.answers.slice().sort((x, y) => x.t - y.t).map((a) => `<li><b>${mmddyy(a.t)}</b> ${a.point ? `<q>${esc(a.point)}</q>` : '<i>no point sentence</i>'}${a.slug ? ` <a href="/${esc(a.slug)}/" target="_blank" rel="noopener">became /${esc(a.slug)}/</a>` : ''}${a.reflect ? `<br><small>What changed: ${esc(a.reflect)}</small>` : ''}
          ${drafts[a.draftId] ? `<button type="button" class="ws-linkbtn" data-open-draft="${esc(a.draftId)}">Resume this piece</button>` : ''}<details><summary>freewrite (${words(a.freewrite || '')} words)</summary><div class="ws-fw">${esc(a.freewrite || '')}</div></details></li>`).join('')}</ol></section>`; }).join('')
        : '<p class="ws-empty">No answers yet. New -&gt; pick a prompt.</p>'}`;
  }

  function exportBackup() {
    persist();
    const data = { v: 1, exported: new Date().toISOString(), drafts, prompts: saved, log: store.get('ws.log', {}) };
    downloadText(JSON.stringify(data, null, 2), 'application/json', `writers-station-${today()}.json`);
    say('Backup saved to your downloads. Keep it somewhere private: it has your drafts.');
  }
  async function importBackup(file) {
    const data = JSON.parse(await file.text());
    if (!data || data.v !== 1) throw new Error("that isn't a Writer's Station backup");
    for (const [id, d] of Object.entries(data.drafts || {})) if (id !== (cur && cur.id) && (!drafts[id] || drafts[id].updated < d.updated)) drafts[id] = d;
    for (const [id, p] of Object.entries(data.prompts || {})) {
      if (!saved[id]) { saved[id] = p; continue; }
      const have = new Set((saved[id].answers || []).map((a) => a.draftId));
      for (const a of p.answers || []) if (!have.has(a.draftId)) saved[id].answers.push(a);
    }
    const log = store.get('ws.log', {});
    for (const [k, v] of Object.entries(data.log || {})) log[k] = Math.max(log[k] || 0, v);
    store.set('ws.log', log); store.set('ws.drafts', drafts); savePrompts();
    renderJournal(); renderLog();
    say('Backup merged in. Newer copies win; nothing newer got overwritten.');
  }

  // ------------------------------------------------------------------ sprint, freewrite, read aloud
  let sprint = null;
  function startSprint(min) {
    clearInterval(sprint && sprint.timer);
    if (!min) { sprint = null; $('#ws-timer').textContent = 'no sprint'; say('Sprint stopped.'); return; }
    sprint = { end: Date.now() + min * 60000, start: words(el.body.value), goal: +$('#ws-goal').value || 0, nobs: $('#ws-nobs').checked };
    setMode('draft');
    el.body.focus();
    $('#ws-timer').textContent = `Sprint ${min}:00 | 0${sprint.goal ? `/${sprint.goal}` : ''} words`;
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
    if (el.body.readOnly) { say('Your freewrite is locked. Return to Freewrite to edit it.'); return; }
    const { selectionStart: a, selectionEnd: b, value: v } = el.body;
    const mid = v.slice(a, b) || placeholder;
    el.body.setRangeText(before + mid + after, a, b, 'end');
    el.body.setSelectionRange(a + before.length, a + before.length + mid.length);
    el.body.focus(); el.body.dispatchEvent(new Event('input'));
  }
  function linePrefix(prefix) {
    if (el.body.readOnly) { say('Your freewrite is locked. Return to Freewrite to edit it.'); return; }
    const { selectionStart: a, value: v } = el.body;
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    el.body.setRangeText(prefix, ls, ls, 'end');
    el.body.focus(); el.body.dispatchEvent(new Event('input'));
  }
  const FMT = { h2: () => linePrefix('## '), b: () => wrap('**'), i: () => wrap('*'), q: () => linePrefix('> '), ul: () => linePrefix('- '), code: () => wrap('`', '`', 'code'), link: () => wrap('[', '](https://)', 'link text') };

  // ------------------------------------------------------------------ open
  function renderLibrary() {
    const list = findDrafts(Object.values(drafts), $('#ws-library-search').value, $('#ws-library-filter').value);
    $('#ws-library-count').textContent = `${list.length} piece${list.length === 1 ? '' : 's'}`;
    $('#ws-open-drafts').innerHTML = list.map((d) => `<li><span><b>${esc(draftLabel(d))}</b><small>${words(d.body || d.freewrite || '')} words · ${esc(draftStatus(d))} · ${ago(d.updated)}</small>${d.next ? `<small>Next: ${esc(d.next)}</small>` : ''}</span><span class="ws-library-actions"><button type="button" class="dlg-btn" data-open-draft="${esc(d.id)}">Resume</button><button type="button" class="dlg-btn" data-del-draft="${esc(d.id)}" aria-label="Delete ${esc(draftLabel(d))}">Delete</button></span></li>`).join('') || '<li>No pieces match. Try another search or filter.</li>';
  }
  async function openDialog() {
    persist();
    const dlg = $('#ws-open');
    renderLibrary();
    if (!dlg.open) dlg.showModal();
    $('#ws-library-search').focus();
    $('#ws-open-posts').innerHTML = '<li>Loading...</li>';
    try {
      const files = (await gh(`/repos/${REPO}/contents/posts?ref=main`)).filter((f) => f.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
      $('#ws-open-posts').innerHTML = files.map((f) => `<li><span>${esc(f.name.replace(/\.md$/, ''))}</span><button type="button" class="dlg-btn" data-open-post="${esc(f.path)}">Edit</button></li>`).join('') || '<li>No published pieces yet.</li>';
    } catch (ex) { $('#ws-open-posts').innerHTML = `<li>Couldn't list posts: ${esc(ex.message)}</li>`; }
  }
  $('#ws-library-search').addEventListener('input', renderLibrary);
  $('#ws-library-filter').addEventListener('change', renderLibrary);
  function downloadText(text, type, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportPiece() {
    persist();
    downloadText(markdownExport(cur), 'text/markdown;charset=utf-8', `${slugify(draftLabel(cur)) || 'writing'}.md`);
    say('Markdown downloaded, including your freewrite and working notes.');
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
      { ok: !!body.trim(), text: 'Has writing in the body', block: true },
      { ok: !PHONE.test(body + el.title.value + el.desc.value), text: 'No phone numbers (privacy)', block: true },
      { ok: !EMAIL.test(body + el.desc.value), text: 'No email addresses (privacy)', block: true },
      { ok: !!el.desc.value.trim(), text: 'One-line summary (shows in lists and link previews)' },
      { ok: !!el.kind.value.trim(), text: 'Kind picked (Story, Essay, Study notes, Personal...)' },
      { ok: n >= 150, text: `At least 150 words (now ${n})` },
      { ok: !/\b(TODO|TK|XXX)\b/.test(body), text: 'No TODO or TK left in' },
      { ok: !!(cur && cur.revised), text: 'Had a pass in Revise mode' },
      { ok: !!(cur && cur.readAloud), text: 'Read aloud once, start to finish' },
      { ok: !!(cur && (cur.path || Date.now() - cur.created > 8 * 3600000)), text: 'Slept on it (draft is 8+ hours old)' },
      ...(cur && cur.build ? [{ ok: !!(cur.build.point || '').trim(), text: 'Knows its point (one sentence, from the build steps)' }] : []),
    ];
  }
  function publishDialog() {
    if (cur && cur.build && field() === 'freewrite') { say('No draft yet: this is still your freewrite. Click Draft in the steps bar to start the draft.'); return; }
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
  let publishing = false;
  function setPublishing(busy) {
    publishing = busy;
    $$('#ws-publish [data-close]').forEach((button) => { button.disabled = busy; });
  }
  $('#ws-publish').addEventListener('cancel', (event) => { if (publishing) event.preventDefault(); });
  async function publish() {
    if (publishing) return;
    setPublishing(true);
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
      Object.assign(cur, { path, date, kind });
      if (cur.build) { cur.build.slug = slug; cur.build.stage = 'publish'; recordAnswer(); renderBuild(); }
      persist(true); refresh();
      status.textContent = 'Saved to GitHub. Building the site (about a minute)...';
      setPublishing(false);
      await waitForBuild(sha, slug, status);
    } catch (ex) {
      setPublishing(false);
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
    try {
      kindsMap = JSON.parse(await readFile('site.json')).writing_kinds || {};
    } catch { kindsMap = {}; }
    $('#ws-kinds').innerHTML = [...new Set(['Story', 'Essay', 'Study notes', 'Personal', 'Journal', ...Object.values(kindsMap)])].map((k) => `<option value="${esc(k)}">`).join('');
    const due = dueNow().length;
    say(`Logged on. Drafts save on this computer as you type. Nothing goes public until Publish.${due ? ` ${due} prompt${due > 1 ? 's are' : ' is'} due for a revisit: New -> Revisit.` : ''}`);
    loadBaseline();
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
      if (a === 'new') { renderNew(); $('#ws-new').showModal(); }
      else if (a === 'journal') { renderJournal(); $('#ws-journal').showModal(); }
      else if (a === 'open') openDialog();
      else if (a === 'export-piece') exportPiece();
      else if (a === 'save') { persist(true); say('Saved on this computer. It goes public only when you Publish.'); }
      else if (a === 'sprint') $('#ws-sprint').showModal();
      else if (a === 'aloud') readAloud();
      else if (a === 'focus') { if (document.fullscreenElement) document.exitFullscreen(); else ws.requestFullscreen().catch(() => say('Full screen is blocked here.')); }
      else if (a === 'publish') publishDialog();
      else if (a === 'logout') { persist(); logout(); }
    }
    if (t.closest('#ws-build')) buildClick(t);
    if (modeBtn) setMode(modeBtn.dataset.mode);
    if (fmt) FMT[fmt.dataset.fmt]();
    if (tab) {
      $$('.ws-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === tab)));
      $$('.ws-pane').forEach((p) => { p.hidden = p.id !== `ws-pane-${tab.dataset.tab}`; });
      analyze();
    }
    const spot = issue || t.closest('.ws-hit, .ws-mark');
    if (spot && spot.dataset.occ && spot.dataset.occ.includes(',')) {
      const occ = spot.dataset.occ.split(',').map((x) => x.split('-').map(Number));
      const k = Math.max(0, occ.findIndex(([a]) => a >= el.body.selectionEnd));
      const [a, b] = occ[occ.findIndex(([a2]) => a2 >= el.body.selectionEnd)] || occ[0];
      jump(a, b); say(`${k + 1} of ${occ.length}. Click again for the next one.`);
    } else if (spot) jump(+spot.getAttribute('data-start'), +spot.getAttribute('data-end'));
    const famBtn = t.closest('[data-fam]');
    if (famBtn) { const f = famBtn.dataset.fam; if (famFilter.has(f) && famFilter.size > 1) famFilter.delete(f); else famFilter.add(f); analyze(); }
    const ign = t.closest('[data-ignore]');
    if (ign) { cur.ignored = [...new Set([...(cur.ignored || []), ign.dataset.ignore])]; persist(); analyze(); say('Ignored for this piece. "Show them again" brings it back.'); }
    if (t.closest('[data-unignore]')) { cur.ignored = []; persist(); analyze(); }
    const wb = t.closest('[data-word]');
    if (wb) {
      const re = new RegExp(`\\b${reEsc(wb.dataset.word)}\\b`, 'gi'), v = el.body.value, from = el.body.selectionEnd;
      const all = [...v.matchAll(re)];
      const next = all.find((m) => m.index >= from) || all[0];
      if (next) { jump(next.index, next.index + next[0].length); say(`"${wb.dataset.word}": ${all.indexOf(next) + 1} of ${all.length}`); }
    }
    if (restore) {
      const s = cur.snapshots.find((x) => String(x.t) === restore.dataset.restore);
      if (s && field() !== 'body') say('History holds your draft. Go to the Draft step first.');
      else if (s) { persist(true); el.body.value = s.body; el.title.value = s.title || el.title.value; persist(true); refresh(); analyze(); say('Restored. The version before it is saved in History too.'); }
    }
  });
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    if (t.closest('[data-close]')) t.closest('dialog').close();
    const sp = t.closest('[data-sprint]'); if (sp) { $('#ws-sprint').close(); startSprint(+sp.dataset.sprint); }
    const od = t.closest('[data-open-draft]'); if (od) { persist(); load(drafts[od.dataset.openDraft]); $('#ws-open').close(); $('#ws-journal').close(); say('Resumed where you left off.'); }
    const op = t.closest('[data-open-post]'); if (op) openPost(op.dataset.openPost).catch((ex) => say(`Couldn't open: ${ex.message}`));
    const dd = t.closest('[data-del-draft]');
    if (dd) {
      if (dd.dataset.armed) { delete drafts[dd.dataset.delDraft]; store.set('ws.drafts', drafts); if (cur && cur.id === dd.dataset.delDraft) load(newDraft()); renderLibrary(); }
      else { dd.dataset.armed = '1'; dd.textContent = 'Sure?'; }
    }
    if (t.closest('#ws-pub-go')) publish();
    const spp = t.closest('[data-start-prompt]'); if (spp) startPrompt(promptById(spp.dataset.startPrompt));
    if (t.closest('[data-lucky]')) { const ps = allPrompts(), fresh = ps.filter((p) => !p.answers.length), pool = fresh.length ? fresh : ps; startPrompt(pool[Math.floor(Math.random() * pool.length)]); }
    if (t.closest('[data-blank]')) { persist(); load(newDraft()); $('#ws-new').close(); el.title.focus(); say('Blank page. Start anywhere.'); }
    if (t.closest('[data-export]')) exportBackup();
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'ws-own') return;
    e.preventDefault();
    const text = $('#ws-own-text').value.replace(/\s+/g, ' ').trim(); if (!text) return;
    const id = `m${Date.now().toString(36)}`;
    saved[id] = { id, g: 'Mine', text, mine: true, answers: [] }; savePrompts();
    startPrompt(promptById(id));
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'ws-import' || !e.target.files[0]) return;
    importBackup(e.target.files[0]).catch((ex) => say(`Couldn't import: ${ex.message}`)).finally(() => { e.target.value = ''; });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('beforeunload', () => persist());
})();

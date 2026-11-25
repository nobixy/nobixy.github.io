// A small enhancement layer in the spirit of 1996. Navigation still works when
// JavaScript is off; with reduced motion on, everything below is instant and still.
(() => {
  const html = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reducedMotion.matches;
  const status = document.getElementById('sb-text');
  const DIAL_IN = 1600;   // matches --slow in style.css
  const DIAL_OUT = 1000;  // the leaving animation in style.css
  const say = (text) => { if (status) status.textContent = text; };
  const later = (ms, fn) => window.setTimeout(fn, ms);

  // Arriving: the page "downloads" over a slow modem, top to bottom.
  const host = location.host || 'nobixy.github.io';
  if (still()) {
    html.classList.remove('dialing-in');
  } else {
    say(`Contacting host: ${host}...`);
    later(DIAL_IN * .3, () => say(`Host contacted. Waiting for reply...`));
    later(DIAL_IN * .55, () => say(`Transferring data from ${host}...`));
    later(DIAL_IN + 100, () => { html.classList.remove('dialing-in'); say('Document: Done'); });
  }

  // Leaving: same idea in reverse, then go.
  let leaving = false;
  const go = (href, label) => {
    if (still()) { location.assign(href); return; }
    if (leaving) return;
    leaving = true;
    html.classList.add('page-leaving');
    say(`Connecting to ${label}...`);
    later(DIAL_OUT * .5, () => say(`Transferring data...`));
    later(DIAL_OUT, () => location.assign(href));
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || destination.pathname.endsWith('.xml')) return;
    if (destination.pathname === location.pathname && destination.search === location.search && destination.hash) return;
    event.preventDefault();
    go(destination.href, destination.pathname);
  });

  // The location bar always shows the real address (the 404 page is served for any missing path).
  const loc = document.querySelector('.loc-field');
  if (loc) loc.textContent = location.href;
  const errPath = document.querySelector('.err-path');
  if (errPath) errPath.textContent = location.pathname;

  // Toolbar Back and Forward, like the real thing.
  const back = document.querySelector('[data-browser="back"]');
  const forward = document.querySelector('[data-browser="forward"]');
  if (back) {
    if (history.length <= 1) back.disabled = true;
    back.addEventListener('click', () => { if (!still()) { html.classList.add('page-leaving'); say('Going back...'); later(DIAL_OUT / 2, () => history.back()); } else history.back(); });
  }
  if (forward) forward.addEventListener('click', () => history.forward());

  // Hovering a link shows where it goes, in the status bar.
  document.addEventListener('mouseover', (event) => {
    const link = event.target instanceof Element && event.target.closest('a[href]');
    if (link && !leaving && !html.classList.contains('dialing-in')) say(link.href);
  });
  document.addEventListener('mouseout', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href]') && !leaving && !html.classList.contains('dialing-in')) say('Document: Done');
  });

  // The writing room: filter by kind (the full list still shows with JavaScript off), and a random piece.
  const tabs = document.querySelector('.kind-tabs');
  if (tabs) {
    tabs.hidden = false;
    const items = [...document.querySelectorAll('.archive .posts li')];
    const months = [...document.querySelectorAll('.archive .month')];
    const empty = document.querySelector('.filter-empty');
    tabs.addEventListener('click', (event) => {
      const tab = event.target instanceof Element && event.target.closest('.kind-tab');
      if (!tab) return;
      if (tab.hasAttribute('data-lucky')) {
        const shown = items.filter((li) => !li.hidden);
        const pick = shown[Math.floor(Math.random() * shown.length)];
        if (pick) { say('Picking something at random...'); pick.querySelector('a').click(); }
        return;
      }
      const kind = tab.dataset.kind;
      tabs.querySelectorAll('[data-kind]').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
      items.forEach((li) => { li.hidden = Boolean(kind) && li.dataset.kind !== kind; });
      months.forEach((m) => { m.hidden = !m.querySelector('li:not([hidden])'); });
      if (empty) empty.hidden = items.some((li) => !li.hidden);
      say(kind ? `Showing: ${kind}` : 'Showing: all writing');
    });
  }

  window.addEventListener('pageshow', (event) => {
    leaving = false;
    html.classList.remove('page-leaving');
    if (event.persisted) { html.classList.remove('dialing-in'); say('Document: Done'); }
  });
})();

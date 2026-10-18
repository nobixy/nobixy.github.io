// A small enhancement layer; navigation still works when JavaScript is off.
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let leaving = false;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname.endsWith('.xml')) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    if (reducedMotion.matches) return;

    event.preventDefault();
    if (leaving) return;
    leaving = true;
    document.documentElement.classList.add('page-leaving');
    window.setTimeout(() => window.location.assign(destination.href), 260);
  });

  window.addEventListener('pageshow', () => {
    leaving = false;
    document.documentElement.classList.remove('page-leaving');
  });

  const meter = document.querySelector('.reading-meter span');
  if (meter) {
    let queued = false;
    const updateMeter = () => {
      const distance = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / distance));
      meter.style.transform = `scaleX(${progress})`;
      queued = false;
    };
    const queueUpdate = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(updateMeter);
    };
    window.addEventListener('scroll', queueUpdate, { passive: true });
    window.addEventListener('resize', queueUpdate);
    window.addEventListener('pageshow', queueUpdate);
    queueUpdate();
  }
})();

/* New section links use layout positions, independent of the moving seam. */
(() => {
  const destinations = new Set(['commission', 'how-we-work', 'commission-process-title']);
  let interacted = false;
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(event, () => { interacted = true; }, { once: true, passive: true });
  }

  function alignSection() {
    const id = location.hash.slice(1);
    if (!destinations.has(id)) return;
    let element = document.getElementById(id);
    if (!element) return;
    let top = 0;
    for (; element; element = element.offsetParent) top += element.offsetTop;
    window.scrollTo({ top, left: 0, behavior: 'instant' });
  }

  // Correct initial hash positioning after the aperture's own measurements.
  // Never pull a visitor back once they have started browsing the page.
  const alignInitial = () => requestAnimationFrame(() => { if (!interacted) alignSection(); });
  alignInitial();
  window.addEventListener('load', alignInitial, { once: true });
  if (document.fonts) document.fonts.ready.then(alignInitial);
  window.addEventListener('hashchange', () => requestAnimationFrame(alignSection));
})();

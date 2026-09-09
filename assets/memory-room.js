/* A four-step tour of the commission, told in one room. Each step fills its own
   corner with colour, opens the card that explains that stage, and then hands
   the visitor on: the next step arrives, breathes, and an arc is drawn to it.
   One step is open at a time; no routes, dialogs or stored visitor data. */
(() => {
  'use strict';

  const room = document.getElementById('memoryRoom');
  if (!room) return;
  const canvas = room.querySelector('.memory-room__canvas');
  const buttons = [...room.querySelectorAll('[data-memory]')];
  const layers = [...room.querySelectorAll('[data-recollection]')];
  const cards = [...document.querySelectorAll('#roomSteps [data-step]')];
  const progress = document.getElementById('roomProgress');
  const fullScene = document.getElementById('roomComplete');
  const resetButton = document.getElementById('memoryReset');
  const caption = document.getElementById('roomCaption');
  const announcement = document.getElementById('roomAnnouncement');
  const errorMessage = document.getElementById('roomImageError');
  const guide = document.getElementById('roomGuide');
  const guideLine = document.getElementById('roomGuideLine');
  const guideHead = document.getElementById('roomGuideHead');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealed = new Set();
  const pending = new Set();
  // The card beside each step carries the wording; only the line for the caption
  // bar and the scene description live here.
  const descriptions = {
    window: {
      caption: 'Step one. We start by listening, for as long as it takes.',
      announcement: 'A little girl on tiptoes appears in colour, peeking out of the window.'
    },
    table: {
      caption: 'Step two. Everything you have kept, gathered and made sense of.',
      announcement: 'Children playing cards appear in colour around the table.'
    },
    shelf: {
      caption: 'Step three. Four to six weeks at the bench.',
      announcement: 'Trophies and medals appear in colour on the display shelf.'
    },
    settee: {
      caption: 'Step four. We bring your life back to you, in objects you can hold.',
      announcement: 'A family laughing together appears in colour on the rattan settee.'
    }
  };
  // How deeply each hand-off bows away from the middle of the room. The last one
  // swings wider to keep clear of the card standing open beside the shelf.
  const guideDepth = { window: .17, table: .17, shelf: .26 };
  const restingCaption = caption.textContent;
  const restingProgress = progress.textContent;
  const handOffDelay = 900;
  const drawDelay = 420;
  let imageReady = null;
  let completeTimer = null;
  let resetTimer = null;
  let handOffTimer = null;
  let drawTimer = null;
  let guideSettleTimer = null;
  let guideClearTimer = null;
  let guidePair = null;
  let guideDrawing = false;
  let guideStale = false;
  let epoch = 0;

  function loadImage(image) {
    return new Promise((resolve, reject) => {
      let handled = false;
      const cleanup = () => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
      };
      const failed = () => {
        if (handled) return;
        handled = true;
        cleanup();
        reject(new Error('Memory image unavailable'));
      };
      const loaded = async () => {
        if (handled) return;
        handled = true;
        cleanup();
        try {
          if (image.decode) await image.decode();
        } catch (_) {
          // A loaded bitmap remains usable when decode was interrupted.
        }
        if (image.naturalWidth) resolve();
        else reject(new Error('Empty memory image'));
      };
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
      image.src = image.dataset.src;
      if (image.complete) {
        if (image.naturalWidth) loaded();
        else failed();
      }
    });
  }

  function prepareMemories() {
    if (imageReady) return imageReady;
    // Shared URLs are downloaded once. Separate background and foreground plates
    // let the table children naturally occlude the settee in any selection order.
    // Decode every layer before beginning a reveal: never expose an empty patch.
    imageReady = Promise.all([fullScene, ...layers].map(loadImage))
      .then(() => { errorMessage.hidden = true; })
      .catch(error => {
        imageReady = null;
        throw error;
      });
    return imageReady;
  }

  function updateReset() {
    resetButton.disabled = revealed.size === 0 && pending.size === 0;
  }

  // One card at a time: the step just chosen. The room stays legible, and the
  // tour reads in the order the steps are numbered.
  function showCard(key) {
    cards.forEach(card => card.classList.toggle('is-current', card.dataset.step === key));
  }

  function updateProgress() {
    if (!revealed.size) progress.textContent = restingProgress;
    else if (revealed.size === buttons.length) progress.textContent = 'All four steps';
    else progress.textContent = revealed.size + ' of 4 steps';
  }

  // Read the card aloud in parts, so the step number and title do not run into
  // the sentence that follows them.
  function cardText(key) {
    const card = cards.find(item => item.dataset.step === key);
    if (!card) return '';
    return [...card.children]
      .map(part => part.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('. ');
  }

  /* ── The hand-off arc ──────────────────────────────────────────────────────
     Measured from layout, never from rendered boxes: the chips lift, breathe and
     grow under the pointer, and none of that may drag the arrow with it. */

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  function laidOutAt(element) {
    const shift = window.getComputedStyle(element).transform;
    let x = element.offsetLeft;
    let y = element.offsetTop;
    if (shift && shift !== 'none' && window.DOMMatrixReadOnly) {
      try {
        const matrix = new DOMMatrixReadOnly(shift);
        x += matrix.e;
        y += matrix.f;
      } catch (_) {
        // An unreadable matrix leaves the untransformed corner, which is close.
      }
    }
    return { x, y };
  }

  function chipBox(button) {
    const chip = button.querySelector('.memory-hotspot__chip');
    const outer = laidOutAt(button);
    const inner = laidOutAt(chip);
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    return { cx: outer.x + inner.x + w / 2, cy: outer.y + inner.y + h / 2, w, h };
  }

  // Where a ray towards (tx, ty) leaves the chip, held off by a small gap.
  function edgeOf(box, tx, ty, gap) {
    const dx = tx - box.cx;
    const dy = ty - box.cy;
    const reachX = dx ? (box.w / 2 + gap) / Math.abs(dx) : Infinity;
    const reachY = dy ? (box.h / 2 + gap) / Math.abs(dy) : Infinity;
    const reach = Math.min(reachX, reachY);
    return { x: box.cx + dx * reach, y: box.cy + dy * reach };
  }

  function renderGuide(animate) {
    if (!guidePair) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const from = chipBox(guidePair.from);
    const to = chipBox(guidePair.to);
    const start = edgeOf(from, to.cx, to.cy, Math.max(9, width * .008));
    const end = edgeOf(to, from.cx, from.cy, Math.max(12, width * .011));
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const span = Math.hypot(vx, vy);
    if (span < 30) return;
    // Bow the arc away from the middle of the room, where the memories are.
    let nx = -vy / span;
    let ny = vx / span;
    if (nx * ((start.x + end.x) / 2 - width / 2) + ny * ((start.y + end.y) / 2 - height / 2) < 0) {
      nx = -nx;
      ny = -ny;
    }
    // A short hand-off wants a gentler sweep than a long one, or the arc curls
    // into a hook in the small space it has.
    const ease = Math.min(1, span / (Math.max(width, height) * .38));
    const bow = Math.min(span * guidePair.depth * ease, height * .17);
    const rein = Math.max(8, width * .006);
    const hold = point => ({
      x: Math.min(Math.max(point.x, rein), width - rein),
      y: Math.min(Math.max(point.y, rein), height - rein)
    });
    const first = hold({ x: start.x + vx * .28 + nx * bow, y: start.y + vy * .28 + ny * bow });
    const second = hold({ x: start.x + vx * .70 + nx * bow * .85, y: start.y + vy * .70 + ny * bow * .85 });
    const angle = Math.atan2(end.y - second.y, end.x - second.x);
    const barb = Math.max(7, width * .0088);
    const spread = .42;
    guide.setAttribute('viewBox', '0 0 ' + round(width) + ' ' + round(height));
    guideLine.setAttribute('d', 'M' + round(start.x) + ' ' + round(start.y) +
      'C' + round(first.x) + ' ' + round(first.y) +
      ' ' + round(second.x) + ' ' + round(second.y) +
      ' ' + round(end.x) + ' ' + round(end.y));
    guideHead.setAttribute('d', 'M' + round(end.x - barb * Math.cos(angle - spread)) + ' ' + round(end.y - barb * Math.sin(angle - spread)) +
      'L' + round(end.x) + ' ' + round(end.y) +
      'L' + round(end.x - barb * Math.cos(angle + spread)) + ' ' + round(end.y - barb * Math.sin(angle + spread)));
    const stroke = Math.max(1.15, width * .0013).toFixed(2);
    guideLine.style.strokeWidth = stroke;
    guideHead.style.strokeWidth = stroke;

    let length = 0;
    try {
      length = guideLine.getTotalLength();
    } catch (_) {
      // Without a measurable path the arc simply appears whole.
    }
    if (animate && length && !reducedMotion.matches) {
      guideDrawing = true;
      guideLine.style.transition = 'none';
      guideLine.style.strokeDasharray = length;
      guideLine.style.strokeDashoffset = length;
      guideLine.getBoundingClientRect();
      guideLine.style.transition = '';
      guideLine.style.strokeDashoffset = '0';
      guide.classList.remove('is-drawn');
      window.clearTimeout(guideSettleTimer);
      guideSettleTimer = window.setTimeout(() => {
        guideDrawing = false;
        if (guideStale) {
          guideStale = false;
          renderGuide(false);
        }
      }, 1100);
    } else {
      guideLine.style.transition = 'none';
      guideLine.style.strokeDasharray = 'none';
      guideLine.style.strokeDashoffset = '0';
    }
    window.clearTimeout(guideClearTimer);
    guide.classList.add('is-visible');
    if (animate && !reducedMotion.matches) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (guidePair) guide.classList.add('is-drawn');
      }));
    } else {
      guide.classList.add('is-drawn');
    }
  }

  function clearGuide() {
    window.clearTimeout(guideSettleTimer);
    guidePair = null;
    guideDrawing = false;
    guideStale = false;
    // An arc already fading out keeps the timer that empties it.
    if (!guide.classList.contains('is-visible')) return;
    window.clearTimeout(guideClearTimer);
    guide.classList.remove('is-visible', 'is-drawn');
    guideClearTimer = window.setTimeout(() => {
      guideLine.setAttribute('d', '');
      guideHead.setAttribute('d', '');
    }, reducedMotion.matches ? 0 : 520);
  }

  /* ── The sequence ─────────────────────────────────────────────────────────
     Only the step whose turn it is stands in the room. Taking it brings the
     next one forward. */

  function offer(button, moveFocus) {
    button.classList.add('is-available', 'is-next');
    if (moveFocus) button.focus({ preventScroll: true });
  }

  function completeRoom() {
    window.clearTimeout(completeTimer);
    const expectedEpoch = epoch;
    // Finish the last memory before filling the quiet spaces between memories.
    completeTimer = window.setTimeout(() => {
      if (epoch !== expectedEpoch || revealed.size !== buttons.length) return;
      room.classList.add('is-complete');
      caption.textContent = 'Four steps. A room is made of the life inside it.';
      announcement.textContent = 'All four steps are open. The whole room is now in colour.';
    }, reducedMotion.matches ? 0 : 2500);
  }

  async function revealMemory(button, viaKeyboard) {
    const key = button.dataset.memory;
    if (!Object.prototype.hasOwnProperty.call(descriptions, key) || revealed.has(key) || pending.has(key)) return;
    if (!button.classList.contains('is-available')) return;
    const expectedEpoch = epoch;
    const oldCaption = caption.textContent;
    pending.add(key);
    button.setAttribute('aria-busy', 'true');
    updateReset();
    const loadingNotice = window.setTimeout(() => {
      if (epoch === expectedEpoch && pending.has(key)) {
        caption.textContent = 'The memories are finding their way back…';
      }
    }, 450);
    try {
      await prepareMemories();
      if (epoch !== expectedEpoch) return;
      window.clearTimeout(resetTimer);
      window.clearTimeout(handOffTimer);
      window.clearTimeout(drawTimer);
      // The arc has done its work the moment its step is taken.
      clearGuide();
      room.classList.remove('is-resetting');
      revealed.add(key);
      layers.find(layer => layer.dataset.recollection === key).classList.add('is-revealed');
      button.classList.add('is-revealed');
      button.classList.remove('is-next');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-label', button.dataset.label + '. Step open.');
      showCard(key);
      caption.textContent = descriptions[key].caption;
      announcement.textContent = cardText(key) + ' ' + descriptions[key].announcement;
      const next = buttons[buttons.indexOf(button) + 1];
      if (next && !revealed.has(next.dataset.memory)) {
        announcement.textContent += ' Next: ' + next.dataset.label + '.';
        const pace = reducedMotion.matches ? 0 : handOffDelay;
        handOffTimer = window.setTimeout(() => {
          if (epoch === expectedEpoch) offer(next, viaKeyboard);
        }, pace);
        drawTimer = window.setTimeout(() => {
          if (epoch !== expectedEpoch || revealed.has(next.dataset.memory)) return;
          guidePair = { from: button, to: next, depth: guideDepth[key] || .17 };
          renderGuide(true);
        }, pace + (reducedMotion.matches ? 0 : drawDelay));
      }
      updateProgress();
      if (revealed.size === buttons.length) completeRoom();
    } catch (_) {
      if (epoch !== expectedEpoch) return;
      errorMessage.hidden = false;
      caption.textContent = oldCaption;
      announcement.textContent = 'The memory image could not load. Choose the step again to retry.';
    } finally {
      window.clearTimeout(loadingNotice);
      if (epoch === expectedEpoch) {
        pending.delete(key);
        button.removeAttribute('aria-busy');
        updateReset();
      }
    }
  }

  buttons.forEach(button => {
    button.dataset.initialLabel = button.getAttribute('aria-label');
    // A click carrying no pointer detail came from the keyboard, and only then
    // should the next step take focus.
    button.addEventListener('click', event => revealMemory(button, event.detail === 0));
  });

  resetButton.addEventListener('click', () => {
    epoch += 1;
    window.clearTimeout(completeTimer);
    window.clearTimeout(resetTimer);
    window.clearTimeout(handOffTimer);
    window.clearTimeout(drawTimer);
    clearGuide();
    revealed.clear();
    pending.clear();
    room.classList.add('is-resetting');
    room.classList.remove('is-complete');
    layers.forEach(layer => layer.classList.remove('is-revealed'));
    buttons.forEach((button, index) => {
      button.classList.remove('is-revealed', 'is-available', 'is-next');
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', button.dataset.initialLabel);
      if (index === 0) offer(button, false);
    });
    errorMessage.hidden = true;
    showCard(null);
    caption.textContent = restingCaption;
    announcement.textContent = 'The room is black and white again. Step one is ready.';
    updateReset();
    updateProgress();
    buttons[0].focus({ preventScroll: true });
    resetTimer = window.setTimeout(() => room.classList.remove('is-resetting'), reducedMotion.matches ? 0 : 1000);
  });

  // Redrawn rather than rescaled: the arc is struck in the room's own pixels, so
  // a resize, a late font or a reflowed chip all ask for fresh geometry.
  if ('ResizeObserver' in window) {
    const watcher = new ResizeObserver(() => {
      if (!guidePair) return;
      if (guideDrawing) { guideStale = true; return; }
      renderGuide(false);
    });
    watcher.observe(canvas);
    buttons.forEach(button => watcher.observe(button.querySelector('.memory-hotspot__chip')));
  }

  function armFirstStep() {
    if (revealed.size || pending.size) return;
    offer(buttons[0], false);
  }

  // Preload near the section without competing with the existing hero film.
  // Data-saving mode waits for a deliberate tap.
  if ('IntersectionObserver' in window) {
    const preloadObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      preloadObserver.disconnect();
      if (!(navigator.connection || {}).saveData) {
        prepareMemories().catch(() => { /* A later tap retries a failed preload. */ });
      }
    }, { rootMargin: '500px 0px' });
    preloadObserver.observe(room);

    // The first step arrives as the room does, rather than waiting in an empty
    // frame far below the fold.
    const arrivalObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      arrivalObserver.disconnect();
      armFirstStep();
    }, { threshold: .25 });
    arrivalObserver.observe(room);
  } else {
    armFirstStep();
  }
})();

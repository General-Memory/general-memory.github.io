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
  const stepsPanel = document.getElementById('roomSteps');
  const cards = [...stepsPanel.querySelectorAll('[data-step]')];
  const fullScene = document.getElementById('roomComplete');
  // One above the picture and one below it; either takes the tour back to the start.
  const resetButtons = [...document.querySelectorAll('.memory-reset')];
  const caption = document.getElementById('roomCaption');
  const announcement = document.getElementById('roomAnnouncement');
  const errorMessage = document.getElementById('roomImageError');
  const guide = document.getElementById('roomGuide');
  const slots = [...guide.querySelectorAll('.memory-guide__link')].map(group => ({
    group,
    line: group.querySelector('.memory-guide__line'),
    head: group.querySelector('.memory-guide__head')
  }));
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
  const handOffDelay = 900;
  const drawDelay = 420;
  let imageReady = null;
  let completeTimer = null;
  let resetTimer = null;
  let handOffTimer = null;
  let drawTimer = null;
  let guideSettleTimer = null;
  let guideClearTimer = null;
  let guideLinks = [];
  let guideDrawing = false;
  let guideStale = false;
  let summaryTimer = null;
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
    const idle = revealed.size === 0 && pending.size === 0;
    resetButtons.forEach(button => { button.disabled = idle; });
  }

  // One card at a time: the step just chosen. The room stays legible, and the
  // tour reads in the order the steps are numbered.
  function showCard(key) {
    cards.forEach(card => card.classList.toggle('is-current', card.dataset.step === key));
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

  /* Where an arc meets a box: on the face that most directly looks at the other
     end of it, held off by a small gap. A step chip is a long, low pill, and
     taking the geometric exit of a ray from its middle would put the barb over
     the top of it, flying along its length; docking on the face it presents
     lands the barb on the end of the pill, pointing into it. */
  function dockOf(box, tx, ty, gap) {
    const dx = tx - box.cx;
    const dy = ty - box.cy;
    const inset = Math.min(10, box.w / 2, box.h / 2);
    const held = (value, middle, half) => Math.min(Math.max(value, middle - half + inset), middle + half - inset);
    if (Math.abs(dx) >= Math.abs(dy)) {
      const along = dx ? box.cy + dy * ((box.w / 2) / Math.abs(dx)) : box.cy;
      return {
        x: box.cx + (dx >= 0 ? 1 : -1) * (box.w / 2 + gap),
        y: held(along, box.cy, box.h / 2)
      };
    }
    const along = dy ? box.cx + dx * ((box.h / 2) / Math.abs(dy)) : box.cx;
    return {
      x: held(along, box.cx, box.w / 2),
      y: box.cy + (dy >= 0 ? 1 : -1) * (box.h / 2 + gap)
    };
  }

  function cardBox(card) {
    const at = laidOutAt(card);
    return { cx: at.x + card.offsetWidth / 2, cy: at.y + card.offsetHeight / 2, w: card.offsetWidth, h: card.offsetHeight };
  }

  function boxOf(element, kind) {
    return kind === 'card' ? cardBox(element) : chipBox(element);
  }

  // One arc: out of the first box, around the outside of the room, into the
  // second. The last control point is held close to the chord so the barb
  // always arrives pointing into what it is aimed at, never past it.
  function arcFor(link, width, height) {
    const from = boxOf(link.from, link.kind);
    const to = boxOf(link.to, link.kind);
    const start = dockOf(from, to.cx, to.cy, Math.max(9, width * .008));
    const end = dockOf(to, from.cx, from.cy, Math.max(12, width * .011));
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const span = Math.hypot(vx, vy);
    if (span < 30) return null;
    let nx = -vy / span;
    let ny = vx / span;
    if (nx * ((start.x + end.x) / 2 - width / 2) + ny * ((start.y + end.y) / 2 - height / 2) < 0) {
      nx = -nx;
      ny = -ny;
    }
    // A short hand-off across an open room keeps its curve; one squeezed into a
    // small gap is eased flat, or it curls into a hook.
    const ease = link.taper === false ? 1 : Math.min(1, span / (Math.max(width, height) * .38));
    const bow = Math.min(span * link.depth * ease, height * .17);
    const rein = Math.max(8, width * .006);
    const hold = point => ({
      x: Math.min(Math.max(point.x, rein), width - rein),
      y: Math.min(Math.max(point.y, rein), height - rein)
    });
    const first = hold({ x: start.x + vx * .28 + nx * bow, y: start.y + vy * .28 + ny * bow });
    /* The arc leaves bowing outward and arrives aimed: the last control point is
       set off the end along the way in, blending the run of the chord with the
       line to the middle of what is being pointed at, so the barb lands in it
       however tight the hop. */
    const middleX = to.cx - end.x;
    const middleY = to.cy - end.y;
    const middleLen = Math.hypot(middleX, middleY) || 1;
    const aimX = (vx / span) * .65 + (middleX / middleLen) * .5;
    const aimY = (vy / span) * .65 + (middleY / middleLen) * .5;
    const aimLen = Math.hypot(aimX, aimY) || 1;
    const reach = Math.max(span * .22, 18);
    const second = hold({ x: end.x - (aimX / aimLen) * reach, y: end.y - (aimY / aimLen) * reach });
    const angle = Math.atan2(end.y - second.y, end.x - second.x);
    const barb = Math.max(7, width * .0088);
    const spread = .42;
    return {
      line: 'M' + round(start.x) + ' ' + round(start.y) +
        'C' + round(first.x) + ' ' + round(first.y) +
        ' ' + round(second.x) + ' ' + round(second.y) +
        ' ' + round(end.x) + ' ' + round(end.y),
      head: 'M' + round(end.x - barb * Math.cos(angle - spread)) + ' ' + round(end.y - barb * Math.sin(angle - spread)) +
        'L' + round(end.x) + ' ' + round(end.y) +
        'L' + round(end.x - barb * Math.cos(angle + spread)) + ' ' + round(end.y - barb * Math.sin(angle + spread))
    };
  }

  function renderGuide(animate) {
    if (!guideLinks.length) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    // Below the breakpoint the recap cards stand under the picture, out of the
    // canvas the arcs are struck in; there the chevrons between them do the work.
    if (guideLinks[0].kind === 'card' && window.getComputedStyle(stepsPanel).position !== 'absolute') {
      guide.classList.remove('is-visible');
      return;
    }
    const stroke = Math.max(1.15, width * .0013).toFixed(2);
    guide.setAttribute('viewBox', '0 0 ' + round(width) + ' ' + round(height));
    let drawn = false;
    slots.forEach((slot, index) => {
      const link = guideLinks[index];
      const arc = link ? arcFor(link, width, height) : null;
      if (!arc) {
        slot.line.setAttribute('d', '');
        slot.head.setAttribute('d', '');
        slot.group.classList.remove('is-drawn');
        return;
      }
      drawn = true;
      slot.line.setAttribute('d', arc.line);
      slot.head.setAttribute('d', arc.head);
      slot.line.style.strokeWidth = stroke;
      slot.head.style.strokeWidth = stroke;
      const delay = link.delay || 0;
      let length = 0;
      try {
        length = slot.line.getTotalLength();
      } catch (_) {
        // Without a measurable path the arc simply appears whole.
      }
      if (animate && length && !reducedMotion.matches) {
        slot.line.style.transition = 'none';
        slot.line.style.strokeDasharray = length;
        slot.line.style.strokeDashoffset = length;
        slot.line.getBoundingClientRect();
        slot.line.style.transition = '';
        slot.line.style.transitionDelay = delay + 'ms';
        slot.head.style.transitionDelay = (delay + 620) + 'ms';
        slot.line.style.strokeDashoffset = '0';
        slot.group.classList.remove('is-drawn');
      } else {
        slot.line.style.transition = 'none';
        slot.line.style.strokeDasharray = 'none';
        slot.line.style.strokeDashoffset = '0';
        slot.line.style.transitionDelay = '';
        slot.head.style.transitionDelay = '';
        slot.group.classList.add('is-drawn');
      }
    });
    if (!drawn) return;
    window.clearTimeout(guideClearTimer);
    guide.classList.add('is-visible');
    if (!animate || reducedMotion.matches) return;
    const longest = guideLinks.reduce((most, link) => Math.max(most, link.delay || 0), 0);
    guideDrawing = true;
    window.clearTimeout(guideSettleTimer);
    guideSettleTimer = window.setTimeout(() => {
      guideDrawing = false;
      if (guideStale) {
        guideStale = false;
        renderGuide(false);
      }
    }, longest + 1100);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (guideLinks.length) slots.forEach(slot => slot.group.classList.add('is-drawn'));
    }));
  }

  function clearGuide() {
    window.clearTimeout(guideSettleTimer);
    guideLinks = [];
    guideDrawing = false;
    guideStale = false;
    // An arc already fading out keeps the timer that empties it.
    if (!guide.classList.contains('is-visible')) return;
    window.clearTimeout(guideClearTimer);
    guide.classList.remove('is-visible');
    slots.forEach(slot => slot.group.classList.remove('is-drawn'));
    guideClearTimer = window.setTimeout(() => {
      slots.forEach(slot => {
        slot.line.setAttribute('d', '');
        slot.head.setAttribute('d', '');
      });
    }, reducedMotion.matches ? 0 : 520);
  }

  /* ── The sequence ─────────────────────────────────────────────────────────
     Only the step whose turn it is stands in the room. Taking it brings the
     next one forward. */

  // West, south, east, then the card already standing in the north.
  const recapOrder = ['window', 'table', 'shelf', 'settee'];

  function cardFor(key) {
    return cards.find(card => card.dataset.step === key);
  }

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
      caption.textContent = '';
      announcement.textContent = 'All four steps are open. The whole room is now in colour, and the four steps are shown together, in order.';
      // A beat to take in the fourth card, which keeps its place; then the other
      // three take theirs around it and the arcs are drawn between all four.
      summaryTimer = window.setTimeout(() => {
        if (epoch !== expectedEpoch || revealed.size !== buttons.length) return;
        stepsPanel.classList.add('is-summary');
        const light = () => stepsPanel.classList.contains('is-summary') && stepsPanel.classList.add('is-lit');
        if (reducedMotion.matches) light();
        else window.requestAnimationFrame(() => window.requestAnimationFrame(light));
        summaryTimer = window.setTimeout(() => {
          if (epoch !== expectedEpoch || !stepsPanel.classList.contains('is-summary')) return;
          guideLinks = recapOrder.slice(0, -1).map((key, index) => ({
            from: cardFor(key),
            to: cardFor(recapOrder[index + 1]),
            kind: 'card',
            depth: .22,
            taper: false,
            delay: reducedMotion.matches ? 0 : index * 320
          }));
          renderGuide(true);
        }, reducedMotion.matches ? 0 : 760);
      }, reducedMotion.matches ? 0 : 900);
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
          guideLinks = [{ from: button, to: next, kind: 'chip', depth: guideDepth[key] || .17, delay: 0 }];
          renderGuide(true);
        }, pace + (reducedMotion.matches ? 0 : drawDelay));
      }
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

  function restart() {
    epoch += 1;
    window.clearTimeout(completeTimer);
    window.clearTimeout(summaryTimer);
    stepsPanel.classList.remove('is-summary', 'is-lit');
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
    buttons[0].focus({ preventScroll: true });
    resetTimer = window.setTimeout(() => room.classList.remove('is-resetting'), reducedMotion.matches ? 0 : 1000);
  }

  resetButtons.forEach(button => button.addEventListener('click', restart));

  // Redrawn rather than rescaled: the arc is struck in the room's own pixels, so
  // a resize, a late font or a reflowed chip all ask for fresh geometry.
  if ('ResizeObserver' in window) {
    const watcher = new ResizeObserver(() => {
      if (!guideLinks.length) return;
      if (guideDrawing) { guideStale = true; return; }
      renderGuide(false);
    });
    watcher.observe(canvas);
    buttons.forEach(button => watcher.observe(button.querySelector('.memory-hotspot__chip')));
    cards.forEach(card => watcher.observe(card));
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

/* A four-step tour of the commission, told in one room. Each step fills its own
   corner with colour and opens the card that explains that stage. No routes,
   dialogs or stored visitor data. */
(() => {
  'use strict';

  const room = document.getElementById('memoryRoom');
  if (!room) return;
  const buttons = [...room.querySelectorAll('[data-memory]')];
  const layers = [...room.querySelectorAll('[data-recollection]')];
  const cards = [...document.querySelectorAll('#roomSteps [data-step]')];
  const progress = document.getElementById('roomProgress');
  const fullScene = document.getElementById('roomComplete');
  const resetButton = document.getElementById('memoryReset');
  const caption = document.getElementById('roomCaption');
  const announcement = document.getElementById('roomAnnouncement');
  const errorMessage = document.getElementById('roomImageError');
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
  const restingCaption = caption.textContent;
  const restingProgress = progress.textContent;
  let imageReady = null;
  let completeTimer = null;
  let resetTimer = null;
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
  // tour reads in the order the markers are numbered.
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

  async function revealMemory(button) {
    const key = button.dataset.memory;
    if (!Object.prototype.hasOwnProperty.call(descriptions, key) || revealed.has(key) || pending.has(key)) return;
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
      room.classList.remove('is-resetting');
      revealed.add(key);
      layers.find(layer => layer.dataset.recollection === key).classList.add('is-revealed');
      button.classList.add('is-revealed');
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-label', button.dataset.label + '. Step open.');
      showCard(key);
      caption.textContent = descriptions[key].caption;
      announcement.textContent = cardText(key) + ' ' + descriptions[key].announcement;
      updateProgress();
      if (revealed.size === buttons.length) completeRoom();
    } catch (_) {
      if (epoch !== expectedEpoch) return;
      errorMessage.hidden = false;
      caption.textContent = oldCaption;
      announcement.textContent = 'The memory image could not load. Choose a step again to retry.';
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
    button.addEventListener('click', () => revealMemory(button));
  });

  resetButton.addEventListener('click', () => {
    epoch += 1;
    window.clearTimeout(completeTimer);
    window.clearTimeout(resetTimer);
    revealed.clear();
    pending.clear();
    room.classList.add('is-resetting');
    room.classList.remove('is-complete');
    layers.forEach(layer => layer.classList.remove('is-revealed'));
    buttons.forEach(button => {
      button.classList.remove('is-revealed');
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', button.dataset.initialLabel);
    });
    errorMessage.hidden = true;
    showCard(null);
    caption.textContent = restingCaption;
    announcement.textContent = 'The room is black and white again. Choose any of the four steps to open it.';
    updateReset();
    updateProgress();
    buttons[0].focus({ preventScroll: true });
    resetTimer = window.setTimeout(() => room.classList.remove('is-resetting'), reducedMotion.matches ? 0 : 1000);
  });

  // Preload near the section without competing with the existing hero film.
  // Data-saving mode waits for a deliberate tap.
  if (!(navigator.connection || {}).saveData && 'IntersectionObserver' in window) {
    const preloadObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      preloadObserver.disconnect();
      prepareMemories().catch(() => { /* A later tap retries a failed preload. */ });
    }, { rootMargin: '500px 0px' });
    preloadObserver.observe(room);
  }
})();

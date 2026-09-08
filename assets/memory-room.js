/* Four independent memories in one room. No routes, dialogs or stored visitor data. */
(() => {
  'use strict';

  const room = document.getElementById('memoryRoom');
  if (!room) return;
  const buttons = [...room.querySelectorAll('[data-memory]')];
  const layers = [...room.querySelectorAll('[data-recollection]')];
  const fullScene = document.getElementById('roomComplete');
  const resetButton = document.getElementById('memoryReset');
  const caption = document.getElementById('roomCaption');
  const announcement = document.getElementById('roomAnnouncement');
  const errorMessage = document.getElementById('roomImageError');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealed = new Set();
  const pending = new Set();
  const descriptions = {
    table: {
      caption: 'One more game. Then one more after that.',
      announcement: 'Children playing cards appear in colour around the table.'
    },
    settee: {
      caption: 'The kind of laughter you can still hear.',
      announcement: 'A family laughing together appears in colour on the rattan settee.'
    },
    window: {
      caption: 'When the world was just beyond the windowsill.',
      announcement: 'A little girl on tiptoes appears in colour, peeking out of the window.'
    },
    shelf: {
      caption: 'Every small triumph, kept with pride.',
      announcement: 'Trophies and medals appear in colour on the display shelf.'
    }
  };
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

  function completeRoom() {
    window.clearTimeout(completeTimer);
    const expectedEpoch = epoch;
    // Finish the last memory before filling the quiet spaces between memories.
    completeTimer = window.setTimeout(() => {
      if (epoch !== expectedEpoch || revealed.size !== buttons.length) return;
      room.classList.add('is-complete');
      caption.textContent = 'A room is made of the life inside it.';
      announcement.textContent = 'All four memories are revealed. The whole room is now in colour.';
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
      button.setAttribute('aria-label', button.dataset.label + '. Memory revealed.');
      caption.textContent = descriptions[key].caption;
      announcement.textContent = descriptions[key].announcement;
      if (revealed.size === buttons.length) completeRoom();
    } catch (_) {
      if (epoch !== expectedEpoch) return;
      errorMessage.hidden = false;
      caption.textContent = oldCaption;
      announcement.textContent = 'The memory image could not load. Choose an object again to retry.';
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
    caption.textContent = 'Some rooms never really leave us.';
    announcement.textContent = 'The room is black and white again. Choose any of the four objects to reveal its memory.';
    updateReset();
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

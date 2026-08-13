/* Homepage card transition — see _internal/portfolio-design-guide.md §4.
   The mist expands from the clicked card's center, then navigation happens. */

(function () {
  'use strict';

  var mist  = document.querySelector('.mist');
  var label = document.querySelector('.mist__label');
  var cards = document.querySelectorAll('.card');

  if (!mist || !cards.length) return;

  var DURATION = 900; // keep in sync with .mist.is-active in styles.css

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener('click', function (e) {
      // Let the browser handle modified clicks (new tab, download, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      // Reduced motion: navigate straight through, no transition.
      if (prefersReducedMotion()) return;

      e.preventDefault();

      var rect = card.getBoundingClientRect();
      mist.style.setProperty('--ox', (rect.left + rect.width  / 2) + 'px');
      mist.style.setProperty('--oy', (rect.top  + rect.height / 2) + 'px');
      mist.style.setProperty('--tint', getComputedStyle(card).getPropertyValue('--accent'));

      if (label) label.textContent = card.dataset.label || '';

      mist.classList.add('is-active');

      var href = card.getAttribute('href');
      window.setTimeout(function () { window.location.href = href; }, DURATION);
    });
  });

  // Coming back via the browser's back button restores a cached page with the
  // mist still expanded — clear it so the homepage isn't stuck behind fog.
  window.addEventListener('pageshow', function () {
    mist.classList.remove('is-active');
  });
})();

/* William Dooling — portfolio interactions.
   See _internal/portfolio-design-guide.md §4.

   Three jobs:
     1. Pointer-tracked tilt and sheen on the project cards.
     2. Prefetching, so the mist is spent on the animation and not the network.
     3. The mist transition — the outgoing half only. The incoming half is pure
        CSS driven by the `is-arriving` class that each page's inline head script
        sets before first paint, so the fog is already painted when the new
        document appears and clears even if this file never loads. */

(function () {
  'use strict';

  var KEY   = 'wd:mist';
  var ENTER = 700;   // keep in sync with .mist.is-entering in styles.css
  var LEAD  = 90;    // the card reacts before the fog starts gathering

  var root = document.documentElement;
  var mist = document.querySelector('.mist');
  var busy = false;

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------------------
     Arrival cleanup. The dissipate itself already ran in CSS; this just
     clears the handoff and drops the class once the fog is gone.
     --------------------------------------------------------------------- */

  try { sessionStorage.removeItem(KEY); } catch (e) {}

  if (root.classList.contains('is-arriving')) {
    window.setTimeout(function () {
      root.classList.remove('is-arriving');
    }, 1400);
  }

  /* ---------------------------------------------------------------------
     Card pointer tracking — tilt and specular sheen.
     --------------------------------------------------------------------- */

  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (fine && !reduced()) {
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
      var tilt = card.querySelector('.card__tilt');
      if (!tilt) return;

      var frame = 0;
      var next  = null;

      function apply() {
        frame = 0;
        if (!next) return;
        tilt.style.setProperty('--tilt-y', next.ty + 'deg');
        tilt.style.setProperty('--tilt-x', next.tx + 'deg');
        card.style.setProperty('--mx', next.mx + '%');
        card.style.setProperty('--my', next.my + '%');
      }

      card.addEventListener('pointermove', function (e) {
        if (card.classList.contains('is-chosen')) return;
        var r  = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top)  / r.height;
        next = {
          ty: ((px - 0.5) *  9).toFixed(2),
          tx: ((0.5 - py) *  7).toFixed(2),
          mx: (px * 100).toFixed(1),
          my: (py * 100).toFixed(1)
        };
        if (!frame) frame = window.requestAnimationFrame(apply);
      });

      card.addEventListener('pointerleave', function () {
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        next = null;
        tilt.style.setProperty('--tilt-y', '0deg');
        tilt.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--mx', '50%');
        card.style.setProperty('--my', '50%');
      });
    });
  }

  /* ---------------------------------------------------------------------
     Prefetch on intent.
     --------------------------------------------------------------------- */

  var warmed = {};

  function warm(href) {
    if (!href || warmed[href]) return;
    warmed[href] = true;
    var link = document.createElement('link');
    link.rel  = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  }

  /* ---------------------------------------------------------------------
     The transition.
     --------------------------------------------------------------------- */

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function readVar(el, name) {
    return window.getComputedStyle(el).getPropertyValue(name).trim();
  }

  /* The mask's opaque core only extends to 55% of the gradient radius — the
     rest is feather. So the radius has to overshoot the furthest corner by
     ~1.8x for the screen to actually be opaque; 2.2x buys margin so full
     coverage lands a beat before the navigation rather than exactly on it. */
  var OVERSHOOT = 2.2;

  function mistMax(o) {
    var w = window.innerWidth, h = window.innerHeight;
    var farthest = Math.max(
      Math.sqrt(o.x * o.x + o.y * o.y),
      Math.sqrt((w - o.x) * (w - o.x) + o.y * o.y),
      Math.sqrt(o.x * o.x + (h - o.y) * (h - o.y)),
      Math.sqrt((w - o.x) * (w - o.x) + (h - o.y) * (h - o.y))
    );
    return farthest * OVERSHOOT;
  }

  function depart(link, href) {
    var card = link.classList.contains('card') ? link : null;

    /* Measure the element that is actually on screen — .card__inner carries the
       float and hover transforms, so the fog starts from the card's visible
       centre rather than its untransformed layout box. */
    var anchor = (card && card.querySelector('.card__inner')) || link;
    var o = centerOf(anchor);

    var tint = readVar(link, '--next-accent') ||
               readVar(card || link, '--accent') ||
               readVar(root, '--mist-glow');

    /* Reduced motion: no fog, no expanding anything. A short flat fade marks
       the navigation, driven through WAAPI because the reduced-motion block in
       the stylesheet flattens every CSS transition to nothing.

       The navigation is fired by a timer, never by the animation's `finished`
       promise. A document timeline can sit frozen — a backgrounded tab, a
       stalled compositor — and a promise that never settles would leave the
       click doing nothing at all. The fade is decoration; the timer is the
       contract. */
    if (reduced()) {
      if (mist) {
        mist.classList.add('is-entering');
        mist.animate([{ opacity: 0 }, { opacity: 1 }],
                     { duration: 110, easing: 'linear', fill: 'forwards' });
      }
      window.setTimeout(function () { window.location.href = href; }, 110);
      return;
    }

    var max = mistMax(o);

    root.style.setProperty('--ox', o.x + 'px');
    root.style.setProperty('--oy', o.y + 'px');
    root.style.setProperty('--mist-max', max + 'px');
    root.style.setProperty('--tint', tint);

    var labelText = link.getAttribute('data-label') || '';
    var labelEl = mist && mist.querySelector('.mist__label span');
    if (labelEl) labelEl.textContent = labelText;

    /* Hand the fog to the next document: same origin point, same tint, so the
       two halves read as one continuous piece of weather. */
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        ox: o.x, oy: o.y,
        max: max,
        tint: tint,
        label: labelText,
        t: Date.now()
      }));
    } catch (e) {}

    if (card) card.classList.add('is-chosen');
    document.body.classList.add('is-leaving');

    window.setTimeout(function () {
      if (mist) mist.classList.add('is-entering');
    }, LEAD);

    window.setTimeout(function () {
      window.location.href = href;
    }, LEAD + ENTER);
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-mist]'), function (link) {
    var href = link.getAttribute('href');

    link.addEventListener('pointerenter', function () { warm(href); });
    link.addEventListener('focus', function () { warm(href); });
    link.addEventListener('pointerdown', function () { warm(href); });

    link.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      // Let the browser handle modified clicks (new tab, download, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (!href || href.charAt(0) === '#') return;

      e.preventDefault();
      if (busy) return;      // a second click must not queue a second navigation
      busy = true;

      depart(link, href);
    });
  });

  /* ---------------------------------------------------------------------
     Returning through the browser's back button restores a cached page with
     the transition still mid-flight. Reset everything it touched.
     --------------------------------------------------------------------- */

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    busy = false;
    if (mist) mist.classList.remove('is-entering');
    root.classList.remove('is-arriving');
    document.body.classList.remove('is-leaving');
    Array.prototype.forEach.call(document.querySelectorAll('.card.is-chosen'), function (c) {
      c.classList.remove('is-chosen');
    });
  });

  /* Guard against a navigation that never completes leaving the page fogged. */
  window.addEventListener('pagehide', function () { busy = false; });
})();

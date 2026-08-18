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

        /* Deck latch release. Rides the tilt's rect read rather than taking its
           own, and tests the art box's RESTING footprint — see overArt() below
           for why the rendered rect cannot be trusted here. */
        if (deck && deck.classList.contains('is-lifted') &&
            !overArt(e.clientX, e.clientY, r)) release();

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

      /* --- The pops (A9) ------------------------------------------------
         Both bounces used to be declared inside their own :hover rule. A CSS
         animation named in a conditional rule is added when the rule starts
         matching and removed when it stops, so every momentary loss of hover
         restarted it from 0%.

         Hover does flicker here, and the animations cause most of it
         themselves: card-pop rings through four reversals over 460ms, moving
         the whole card between -16px and -11px, and deck-pop translates the
         fan -15px and scales it 1.052 on top of that. Either can slide a phone
         edge past a pointer that has not moved. The phones are also fanned at
         ±8° with gaps between them, so a real crossing passes over bare deck
         for a frame or two. Every one of those was a fresh bounce.

         The fix is to own the animation's lifetime here instead: start it once
         per genuine entry, let it finish, and give the trigger enough
         hysteresis that the effect cannot cancel its own cause. */

      /* Restart honestly: a class that is already present will not re-fire an
         animation, so it has to come off and the style be flushed first. Only
         costs a reflow when the pointer re-enters mid-bounce. */
      function fire(el, cls) {
        if (el.classList.contains(cls)) {
          el.classList.remove(cls);
          void el.offsetWidth;
        }
        el.classList.add(cls);
      }

      /* The card. Its own layout box does not move — transforms live on the
         wrappers inside it — so :hover is stable across most of the card and
         this is belt-and-braces there. It is not belt-and-braces in the ~13px
         band the 1.05 scale and the -14px lift push OUTSIDE that box, where
         hovering the overflow really does oscillate. GRACE swallows a flicker
         without swallowing a deliberate re-entry, which is a much slower move
         than a dropped frame. */
      var GRACE = 140;
      var cool  = 0;

      card.addEventListener('pointerenter', function () {
        if (cool) { window.clearTimeout(cool); cool = 0; return; }
        if (card.classList.contains('is-chosen')) return;
        fire(card, 'is-popping');
      });

      card.addEventListener('pointerleave', function () {
        if (cool) window.clearTimeout(cool);
        cool = window.setTimeout(function () { cool = 0; }, GRACE);
      });

      /* The deck. Geometric latch rather than a timed one: it lifts the moment
         the pointer touches a phone and holds until the pointer leaves the art
         box, so crossing between phones — or a phone stepping out from under a
         stationary pointer — cannot drop it.

         The boundary it latches against must be a box that DOES NOT MOVE, and
         `.card__art`'s own rect is not one: the card's pop drags it up to 16px,
         so along the bottom of the art the box lifts off a pointer that has not
         moved, fires pointerleave, and releases the latch that exists to
         survive exactly that. The release boundary was being animated by the
         thing it was insulating against — the first fix had the same shape of
         bug it was fixing, one level up.

         `.card` is the stable frame. Every transform on this component lives on
         `.card__float`/`__tilt`/`__inner`, so `.card`'s own rect never moves,
         and the art's position inside it is layout — which transforms do not
         touch. One rectangle governs both entry and exit, so a phone that the
         bounce lifts above the art's resting top cannot latch and immediately
         un-latch either.

         Entry is still "on an actual phone", which is the whole reason the CSS
         uses :has(.deck__shot:hover) and not .deck:hover. */
      var art  = card.querySelector('.card__art');
      var deck = card.querySelector('.deck');
      var box  = null;   /* art's resting offset inside .card, in layout px */

      function overArt(cx, cy, r) {
        if (!box) {
          var x = 0, y = 0, n;
          for (n = art;  n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
          for (n = card; n; n = n.offsetParent) { x -= n.offsetLeft; y -= n.offsetTop; }
          box = { x: x, y: y, w: art.offsetWidth, h: art.offsetHeight };
        }
        var px = cx - r.left - box.x, py = cy - r.top - box.y;
        return px >= 0 && py >= 0 && px <= box.w && py <= box.h;
      }

      function release() {
        deck.classList.remove('is-lifted');
        deck.classList.remove('is-popping');
      }

      if (art && deck) {
        window.addEventListener('resize', function () { box = null; });

        art.addEventListener('pointerover', function (e) {
          var el = e.target;
          if (!el || !el.closest || !el.closest('.deck__shot')) return;
          if (deck.classList.contains('is-lifted')) return;
          if (!overArt(e.clientX, e.clientY, card.getBoundingClientRect())) return;
          deck.classList.add('is-lifted');
          fire(deck, 'is-popping');
        });

        /* Release is checked against the resting rect on the move itself — see
           the pointermove handler above, which already holds the card's rect —
           plus this backstop for leaving the card without a final move inside
           it. */
        card.addEventListener('pointerleave', release);
      }

      /* animationend bubbles, and the deck's ambient shine and orbit bubble
         through here too — hence the name check. Dropping the class on the way
         out means the next entry starts from a clean slate rather than from
         fire()'s reflow. */
      card.addEventListener('animationend', function (e) {
        if (e.animationName === 'card-pop') card.classList.remove('is-popping');
        else if (e.animationName === 'deck-pop' && deck) deck.classList.remove('is-popping');
      });
    });
  }

  /* ---------------------------------------------------------------------
     Ambient fog parallax. The pointer leans the fog banks against each other
     by a few pixels — enough to feel like depth, not enough to notice as an
     effect. Sheets carry their own depth multiplier in CSS; this only
     publishes a normalised -1..1 pointer position.
     --------------------------------------------------------------------- */

  var fog = document.querySelector('.fog');

  if (fog && fine && !reduced()) {
    var fogFrame = 0;
    var fogNext  = null;

    function applyFog() {
      fogFrame = 0;
      if (!fogNext) return;
      fog.style.setProperty('--fog-x', fogNext.x);
      fog.style.setProperty('--fog-y', fogNext.y);
    }

    window.addEventListener('pointermove', function (e) {
      fogNext = {
        x: ((e.clientX / window.innerWidth)  * 2 - 1).toFixed(3),
        y: ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3)
      };
      if (!fogFrame) fogFrame = window.requestAnimationFrame(applyFog);
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
     The profile dot — expands into the panel carrying the portrait, the two
     action shots, the name and the contact links.
     --------------------------------------------------------------------- */

  var me    = document.querySelector('.me');
  var dot   = me && me.querySelector('.me__dot');
  var panel = me && me.querySelector('.me__panel');

  if (me && dot && panel) {
    var closeTimer = 0;

    /* The close duration lives in CSS, on `.me` as `--me-close`, and is read
       back here rather than restated. This used to be a constant with a "keep
       in sync" comment above it, which is a comment doing a job the cascade can
       do — and it picks up any per-breakpoint override for free. */
    function closeMs() {
      var raw = getComputedStyle(me).getPropertyValue('--me-close').trim();
      var n = parseFloat(raw);
      if (!n) return 280;                        /* token missing or unparseable */
      return /ms$/.test(raw) ? n : n * 1000;     /* `280ms` or `.28s` both work  */
    }

    /* A panel that is mid-close counts as closed. Without the second test, a
       click landing inside the close window would re-run closeMe and just
       restart the timer — so the dot would look dead for a fifth of a second
       right as it comes back up. */
    function isOpen() {
      return !panel.hasAttribute('hidden') && !me.classList.contains('is-closing');
    }

    /* The panel grows out of the dot by being scaled down onto it, so the
       morph needs the ratio between the two boxes. The panel's height depends
       on its content and on the breakpoint, so this is measured rather than
       assumed — the CSS carries a desktop fallback for when this never runs.

       Measure LAYOUT boxes, not rendered ones. getBoundingClientRect() reports
       the *transformed* rect, and a mouse user's pointer is on the ball at the
       moment they click it — so this used to measure the 60.5px hovered ball
       rather than the 54px resting one. Opening still looked right, since that
       first frame did match the ball as it stood; but the close then landed the
       skin ~6px wide of a ball that had gone back to rest.

       Both boxes scale about their own centre, and a centred scale leaves the
       centre exactly where it was — so the rendered rect still gives an honest
       position, while offsetWidth/Height give the size with the transform taken
       back out. */
    function restingBox(el) {
      var r = el.getBoundingClientRect();
      var w = el.offsetWidth;
      var h = el.offsetHeight;
      return { w: w, h: h, bottom: r.top + r.height / 2 + h / 2 };
    }

    function sizeMorph() {
      var p = restingBox(panel);
      var d = restingBox(dot);
      if (!p.w || !p.h || !d.w) return;
      me.style.setProperty('--me-sx', (d.w / p.w).toFixed(4));
      me.style.setProperty('--me-sy', (d.h / p.h).toFixed(4));
      me.style.setProperty('--me-dy', (d.bottom - p.bottom).toFixed(1) + 'px');
    }

    function openMe() {
      window.clearTimeout(closeTimer);
      me.classList.remove('is-closing');
      panel.removeAttribute('hidden');
      sizeMorph();
      dot.setAttribute('aria-expanded', 'true');
      document.body.classList.add('me-open');

      /* The deck's lift is a JS latch (A9), and `.me-open .roster` kills the
         roster's pointer events rather than moving the pointer — so no
         pointerleave arrives to release it, the same gap that makes the CSS
         reset .card__tilt by hand. Let go of it here or the deck stays lifted
         after the panel closes. */
      Array.prototype.forEach.call(document.querySelectorAll('.deck'), function (d) {
        d.classList.remove('is-lifted');
        d.classList.remove('is-popping');
      });

      /* Move focus in so keyboard and screen-reader users land on the content
         they just opened rather than staying on the dot. */
      var first = panel.querySelector('.me__link');
      if (first) first.focus();
    }

    function closeMe(returnFocus) {
      if (!isOpen()) return;
      dot.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('me-open');

      var finish = function () {
        panel.setAttribute('hidden', '');
        me.classList.remove('is-closing');
      };

      if (reduced()) {
        finish();
      } else {
        me.classList.add('is-closing');
        closeTimer = window.setTimeout(finish, closeMs());
      }

      if (returnFocus) dot.focus();
    }

    dot.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) closeMe(false); else openMe();
    });

    /* Clicks inside the panel must not reach the document handler below. */
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    document.addEventListener('click', function () { closeMe(false); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeMe(true);
    });

    /* -------------------------------------------------------------------
       Copy the address rather than opening a mail client. Clipboard API
       first; the textarea path covers insecure origins and older browsers,
       where navigator.clipboard is simply undefined.
       ------------------------------------------------------------------- */

    var copyBtn = panel.querySelector('.me__copy');
    var status  = panel.querySelector('.me__status');
    var copyTimer = 0;

    function legacyCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    var copyDone = copyBtn && copyBtn.querySelector('.me__copy-done');

    /* Clipboard writes fail for reasons the visitor cannot act on — iOS Safari
       outside a gesture, hardened browsers, a backgrounded document. Failing
       silently would leave them clicking a button that does nothing, so the
       fallback shows the address itself and holds it there long enough to
       select by hand. */
    function confirmCopy(ok, text) {
      if (status) status.textContent = ok ? 'Email address copied' : ('Copy this address: ' + text);
      if (copyDone) copyDone.textContent = ok ? 'Copied' : text;
      copyBtn.classList.toggle('is-plain', !ok);

      copyBtn.classList.remove('is-copied');
      void copyBtn.offsetWidth;              // restart the pop if clicked twice
      copyBtn.classList.add('is-copied');

      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        copyBtn.classList.remove('is-copied');
      }, ok ? 1500 : 6000);
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = copyBtn.getAttribute('data-copy') || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { confirmCopy(true, text); },
            function () { confirmCopy(legacyCopy(text), text); }
          );
        } else {
          confirmCopy(legacyCopy(text), text);
        }
      });
    }

    /* The name used to be split into per-character spans for an idle wave.
       Cut deliberately — it read as a glitch rather than as charm. The name is
       now plain text with a CSS glow, so there is nothing to enhance here. */
  }

  /* ---------------------------------------------------------------------
     Prefetch.

     Two things have to be in cache before the click, not after it: the
     destination DOCUMENT, and the images that document will paint.

     The document alone was enough while the case studies were text — styles.css
     and main.js are shared, so they are already warm — but an arriving page
     paints its first frame under opaque fog and then has ~980ms of dissipation
     to get through. Anything that has not landed inside that window surfaces in
     the clear, which is precisely the seam the fog exists to hide. Both case
     studies are carrying empty `.case-figure--empty` slots waiting on
     screenshots; the moment those are filled, this is the difference between a
     transition and a pop-in.

     `prefetch` throughout, never `preload`. These belong to the NEXT navigation:
     `preload` would fetch them at high priority, compete with the page the
     visitor is actually looking at, and then log an unused-resource warning a
     few seconds later for the privilege.
     --------------------------------------------------------------------- */

  /* Safari has never shipped `rel=prefetch`. Feature-detect rather than assume,
     and fall back to an off-DOM Image(), which fetches into the ordinary HTTP
     cache everywhere. It costs normal image priority instead of idle priority —
     acceptable, because everything here already runs after `load`. */
  var canPrefetch = (function () {
    try { return document.createElement('link').relList.supports('prefetch'); }
    catch (e) { return false; }
  })();

  var warmed = {};

  function hint(href, as) {
    var url;
    try { url = new URL(href, location.href).href; } catch (e) { return; }
    if (warmed[url]) return;
    warmed[url] = true;

    if (!canPrefetch) {
      /* Only images have a usable fallback. A document without prefetch support
         is covered by discover()'s own fetch(), which lands it in the HTTP
         cache as a side effect of reading it. */
      if (as === 'image') new Image().src = url;
      return;
    }

    var link = document.createElement('link');
    link.rel = 'prefetch';
    if (as) link.as = as;
    link.href = url;
    document.head.appendChild(link);
  }

  function warm(href) {
    if (href) hint(href);
  }

  /* Which images a destination needs is read out of the destination itself
     rather than restated in a list here. A hand-maintained manifest is one more
     thing to remember when a screenshot finally goes into one of those figure
     slots, and forgetting fails invisibly — the site still works, just worse,
     in the one moment it is trying hardest to impress. This cannot drift.

     `getAttribute('src')`, not `.src`. A DOMParser document has no base URL, so
     `.src` resolves against the CURRENT page — which turns the case studies'
     `../../assets/img/x.webp` into the wrong URL from everywhere except a
     sibling. Resolve against the destination explicitly.

     `srcset` is deliberately not followed: prefetching every density would
     multiply the bytes for an image only one of which will ever be shown. If
     responsive art arrives on these pages later, this needs revisiting. */
  function discover(href) {
    var dest;
    try { dest = new URL(href, location.href).href; } catch (e) { return; }

    /* Reading the document IS warming it — fetch() stores the response in the
       ordinary HTTP cache, so the navigation that follows is served from there.
       Claim the URL up front so the hover-time `warm()` does not ask for it a
       second time: `rel=prefetch` fills a SEPARATE cache, and the browser will
       cheerfully pull the same document twice to fill both. Claimed before the
       response lands rather than after, because a hover can easily beat it. */
    if (warmed[dest]) return;
    warmed[dest] = true;

    window.fetch(dest, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        Array.prototype.forEach.call(doc.querySelectorAll('img[src]'), function (img) {
          var raw = img.getAttribute('src');
          if (!raw || raw.slice(0, 5) === 'data:') return;
          try { hint(new URL(raw, dest).href, 'image'); } catch (e) {}
        });
      })
      .catch(function () {});   /* offline, 404, file:// — nothing to do */
  }

  /* Hover covers a visitor who approaches a card deliberately. It does not cover
     one who lands and clicks straight away, and on touch it covers nothing at
     all — there the first pointer event IS the tap, and the prefetch and the
     navigation race each other. So once this page has finished its own work,
     pull the neighbours down.

     Gated on `load` rather than fired immediately: this is a nicety and it must
     not compete with the card art the visitor is looking at right now. Skipped
     outright on Save-Data and 2g, where two speculative documents and their
     images are not a trade worth making on someone else's behalf. */
  function prewarm() {
    var c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-mist]'), function (link) {
      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      /* discover() warms the document itself as a side effect of reading it, so
         only fall back to a bare prefetch where it cannot run. */
      if (window.fetch && window.DOMParser) discover(href);
      else warm(href);
    });
  }

  function schedulePrewarm() {
    if (window.requestIdleCallback) window.requestIdleCallback(prewarm, { timeout: 3000 });
    else window.setTimeout(prewarm, 1200);
  }

  if (document.readyState === 'complete') schedulePrewarm();
  else window.addEventListener('load', schedulePrewarm);

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

  /* ---------------------------------------------------------------------
     Case study category tabs (Gameplay / Art Design / User Feedback).
     Standard roving-tabindex ARIA tabs pattern — click or Left/Right/Home/End
     to switch, only the active tab is in the tab order.
     --------------------------------------------------------------------- */

  var tablist = document.querySelector('.case-tabs');

  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('.case-tab'));

    function selectTab(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTab(tab, false); });

      tab.addEventListener('keydown', function (e) {
        var dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dir) {
          e.preventDefault();
          selectTab(tabs[(i + dir + tabs.length) % tabs.length], true);
        } else if (e.key === 'Home') {
          e.preventDefault();
          selectTab(tabs[0], true);
        } else if (e.key === 'End') {
          e.preventDefault();
          selectTab(tabs[tabs.length - 1], true);
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
     Before/after art slider. A single source of truth (--pos, a percentage)
     drives both the clip and the handle position — the range input is the
     only thing JS has to touch.
     --------------------------------------------------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.art-slider'), function (slider) {
    var range = slider.querySelector('.art-slider__range');
    if (!range) return;
    range.addEventListener('input', function () {
      slider.style.setProperty('--pos', range.value + '%');
    });
  });

  /* ---------------------------------------------------------------------
     Image lightbox. Content is read from the DOM (each trigger's image, plus
     its caption) rather than duplicated into a JS array here — the markup
     stays the single source of truth and this cannot drift from it.

     Prev/next walk only the group the opened image belongs to, a group being
     its tab panel. Yggdrasil has two galleries in two panels, and stepping
     out of the one you opened into a panel you cannot see is not navigation.

     Inside the panel the image is a small photo viewer: click a point to zoom
     in on it, drag to pan, click again to go back. Wheel and pinch scrub the
     scale continuously. Everything is clamped so the image can never be
     dragged off its own stage.
     --------------------------------------------------------------------- */

  var lightbox = document.querySelector('.lightbox');
  var triggers = Array.prototype.slice.call(
    document.querySelectorAll('.art-timeline__trigger, .ygr-shot--trigger, .bev-shot--trigger'));

  if (lightbox && triggers.length) {
    var lbStage   = lightbox.querySelector('.lightbox__stage');
    var lbImg     = lightbox.querySelector('.lightbox__img');
    var lbCaption = lightbox.querySelector('.lightbox__caption');
    var lbClose   = lightbox.querySelector('.lightbox__close');
    var lbPrev    = lightbox.querySelector('.lightbox__nav--prev');
    var lbNext    = lightbox.querySelector('.lightbox__nav--next');

    var group   = triggers;   /* the triggers prev/next currently walks */
    var current = 0;
    var opener  = null;

    lbImg.draggable = false;

    function groupOf(trigger) {
      var panel = trigger.closest('.case-panel');
      if (!panel) return triggers;
      return triggers.filter(function (t) { return t.closest('.case-panel') === panel; });
    }

    /* ---- Zoom state ---------------------------------------------------
       scale is a multiple of the fitted size; x and y move the image's own
       centre away from the stage's, in stage pixels.
       ------------------------------------------------------------------- */

    var MAX_ZOOM   = 5;
    var CLICK_ZOOM = 2.5;   /* what a single click on the image opens up to */

    var zoom = { scale: 1, x: 0, y: 0 };

    /* Panning is clamped to whatever slack the scaled image has over the
       stage. At fit scale there is none, so it re-centres itself. */
    function clampPan() {
      var slackX = (lbImg.offsetWidth  * zoom.scale - lbStage.clientWidth)  / 2;
      var slackY = (lbImg.offsetHeight * zoom.scale - lbStage.clientHeight) / 2;
      zoom.x = slackX <= 0 ? 0 : Math.max(-slackX, Math.min(slackX, zoom.x));
      zoom.y = slackY <= 0 ? 0 : Math.max(-slackY, Math.min(slackY, zoom.y));
    }

    function applyZoom() {
      clampPan();
      lbImg.style.transform =
        'translate(' + zoom.x + 'px, ' + zoom.y + 'px) scale(' + zoom.scale + ')';
      lbStage.classList.toggle('is-zoomed', zoom.scale > 1.01);
    }

    function resetZoom() {
      zoom.scale = 1;
      zoom.x = 0;
      zoom.y = 0;
      applyZoom();
    }

    /* Scales to `next` while holding the stage point (px, py) still — which is
       what makes clicking a detail bring that detail to you, rather than the
       middle of the picture. */
    function zoomAt(next, px, py) {
      next = Math.max(1, Math.min(MAX_ZOOM, next));
      var ratio = next / zoom.scale;
      var ox = px - lbStage.clientWidth  / 2;
      var oy = py - lbStage.clientHeight / 2;
      zoom.x = ox - (ox - zoom.x) * ratio;
      zoom.y = oy - (oy - zoom.y) * ratio;
      zoom.scale = next;
      applyZoom();
    }

    /* Returned in the stage's own layout pixels, which is what clientWidth and
       offsetWidth are measured in. The panel carries a scale transform while
       it opens, so a raw client offset is a different unit mid-animation. */
    function stagePoint(e) {
      var r = lbStage.getBoundingClientRect();
      var k = r.width ? lbStage.clientWidth / r.width : 1;
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    }

    /* ---- Pointers. One is a drag or a click, two are a pinch. --------- */

    var pointers  = {};
    var pinchDist = 0;
    var panning   = false;
    var moved     = 0;   /* drag distance so far, to tell a drag from a click */

    function pointerList() {
      return Object.keys(pointers).map(function (k) { return pointers[k]; });
    }

    lbStage.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = stagePoint(e);
      lbStage.setPointerCapture(e.pointerId);
      var pts = pointerList();
      if (pts.length === 2) {
        pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        panning = false;
      } else {
        panning = true;
        moved = 0;
        lbStage.classList.add('is-grabbing');
      }
    });

    lbStage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      var prev = pointers[e.pointerId];
      var now  = stagePoint(e);
      pointers[e.pointerId] = now;
      var pts = pointerList();

      if (pts.length === 2) {
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0) {
          zoomAt(zoom.scale * (dist / pinchDist),
                 (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        }
        pinchDist = dist;
        return;
      }

      moved += Math.hypot(now.x - prev.x, now.y - prev.y);
      if (panning && zoom.scale > 1.01) {
        zoom.x += now.x - prev.x;
        zoom.y += now.y - prev.y;
        applyZoom();
      }
    });

    function endPointer(e) {
      if (!pointers[e.pointerId]) return;
      var at = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (pointerList().length) return;

      lbStage.classList.remove('is-grabbing');
      pinchDist = 0;
      /* A press that never really travelled is a click, so it toggles zoom. */
      if (panning && moved < 5) {
        if (zoom.scale > 1.01) resetZoom();
        else zoomAt(CLICK_ZOOM, at.x, at.y);
      }
      panning = false;
    }

    lbStage.addEventListener('pointerup', endPointer);
    lbStage.addEventListener('pointercancel', endPointer);

    lbStage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = stagePoint(e);
      zoomAt(zoom.scale * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });

    /* ---- Open, close, step ------------------------------------------- */

    function show(i) {
      current = (i + group.length) % group.length;
      var trigger = group[current];
      var img = trigger.querySelector('img');
      resetZoom();
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt;
      /* The subtitle is either declared on the trigger, or read from whatever
         sits next to it — a <p> in the storm timeline, a <figcaption> in
         Yggdrasil's gallery. The Design-tab scenes have no caption of their
         own on the page, so they carry theirs on the trigger. */
      var declared = trigger.getAttribute('data-lightbox-caption');
      if (declared) lbCaption.textContent = declared;
      else {
        var beat = trigger.closest('.art-timeline__beat, figure');
        var caption = beat && beat.querySelector('figcaption, p');
        lbCaption.innerHTML = caption ? caption.innerHTML : '';
      }
      var many = group.length > 1;
      lbPrev.hidden = !many;
      lbNext.hidden = !many;
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(current + 1);
      else if (e.key === 'ArrowLeft') show(current - 1);
    }

    function open(trigger) {
      opener = trigger;
      group = groupOf(trigger);
      show(group.indexOf(trigger));
      lightbox.classList.add('is-open');
      lightbox.removeAttribute('aria-hidden');
      document.body.classList.add('lightbox-open');
      lbClose.focus();
      document.addEventListener('keydown', onKey);
    }

    function close() {
      resetZoom();
      lightbox.classList.remove('is-open');
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      document.removeEventListener('keydown', onKey);
      if (opener) opener.focus();
      opener = null;
    }

    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function () { open(trigger); });
    });

    lbPrev.addEventListener('click', function () { show(current - 1); });
    lbNext.addEventListener('click', function () { show(current + 1); });

    Array.prototype.forEach.call(lightbox.querySelectorAll('[data-lightbox-close]'), function (el) {
      el.addEventListener('click', close);
    });

    /* A resize can leave the image smaller than its current pan allows. */
    window.addEventListener('resize', function () {
      if (lightbox.classList.contains('is-open')) applyZoom();
    });
  }

  /* ---------------------------------------------------------------------
     Reveal on scroll. Elements start hidden in CSS and are unhidden once
     they cross into view; the observer drops each element after it fires,
     so nothing re-animates on scroll back up.

     Under reduced motion everything is marked in immediately, and if
     IntersectionObserver is missing the same fallback applies — the page
     must never be left with invisible content.
     --------------------------------------------------------------------- */

  var revealables = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));

  if (revealables.length) {
    if (reduced() || !('IntersectionObserver' in window)) {
      revealables.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

      revealables.forEach(function (el) { io.observe(el); });
    }
  }
})();

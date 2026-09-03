(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var STORAGE_KEY = "selection-wheel:v1";
  var STORAGE_VERSION = 1;
  var MAX_ENTRIES = 60;
  var MAX_LABEL_LENGTH = 48;
  var SPIN_DURATION = 4800;
  var SETTLE_DURATION = 260;
  var REVEAL_DURATION = 620;

  var TIER_COLORS = {
    ur: "#b97818",
    sr: "#087fae",
    r: "#8c32aa"
  };
  var CUSTOM_COLORS = ["#235fac", "#7440b5", "#0a8e87", "#b44770", "#4e68c4", "#9a5a2d"];

  var dom = {
    rotor: document.getElementById("wheel-rotor"),
    wheelDescription: document.getElementById("wheel-description"),
    winnerCallout: document.getElementById("winner-callout"),
    wheelPointer: document.getElementById("wheel-pointer"),
    spinButton: document.getElementById("spin-button"),
    spinCount: document.getElementById("spin-count"),
    entryTotal: document.getElementById("entry-total"),
    emptyWheel: document.getElementById("empty-wheel"),
    customForm: document.getElementById("custom-entry-form"),
    customLabel: document.getElementById("custom-label"),
    customQuantity: document.getElementById("custom-quantity"),
    sliceList: document.getElementById("slice-list"),
    savePresetForm: document.getElementById("save-preset-form"),
    presetName: document.getElementById("preset-name"),
    presetList: document.getElementById("preset-list"),
    editorStatus: document.getElementById("editor-status"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmMessage: document.getElementById("confirm-message"),
    confirmAction: document.getElementById("confirm-action"),
    resultAnnouncement: document.getElementById("result-announcement")
  };

  var soundEvents = new EventTarget();
  window.selectionWheelSoundEvents = soundEvents;

  var state = {
    entries: [],
    presets: [],
    phase: "setup",
    rotation: 0,
    spinSnapshot: null,
    winnerIndex: -1,
    storageEnabled: storageIsAvailable()
  };

  var pendingConfirmation = null;
  var statusTimer = 0;
  var initialNotice = "";
  var heldCinematicKeys = new Set();

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return (prefix || "item") + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function storageIsAvailable() {
    try {
      var testKey = STORAGE_KEY + ":test";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  function cleanText(value, maximum) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maximum);
  }

  function cloneEntries(entries, useFreshIds) {
    return entries.map(function (entry) {
      return {
        id: useFreshIds ? createId("entry") : entry.id,
        label: entry.label,
        presetKind: entry.presetKind
      };
    });
  }

  function sanitizeEntries(candidate) {
    if (!Array.isArray(candidate)) return [];
    var seenIds = new Set();
    var validKinds = new Set(["ur", "sr", "r"]);
    var entries = [];

    candidate.slice(0, MAX_ENTRIES).forEach(function (rawEntry) {
      if (!rawEntry || typeof rawEntry !== "object") return;
      var label = cleanText(rawEntry.label, MAX_LABEL_LENGTH);
      if (!label) return;

      var id = typeof rawEntry.id === "string" && rawEntry.id ? rawEntry.id : createId("entry");
      if (seenIds.has(id)) id = createId("entry");
      seenIds.add(id);

      entries.push({
        id: id,
        label: label,
        presetKind: validKinds.has(rawEntry.presetKind) ? rawEntry.presetKind : null
      });
    });

    return entries;
  }

  function hydrateState() {
    if (!state.storageEnabled) {
      initialNotice = "Browser storage is unavailable. Changes will last for this session only.";
      return;
    }

    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var envelope = JSON.parse(raw);
      if (!envelope || envelope.version !== STORAGE_VERSION) {
        initialNotice = "Saved wheel data could not be restored. A blank wheel was opened safely.";
        return;
      }

      state.entries = sanitizeEntries(envelope.draft && envelope.draft.entries);

      var usedNames = new Set();
      var usedPresetIds = new Set();
      if (Array.isArray(envelope.presets)) {
        state.presets = envelope.presets.slice(0, 100).reduce(function (presets, rawPreset) {
          if (!rawPreset || typeof rawPreset !== "object") return presets;
          var name = cleanText(rawPreset.name, MAX_LABEL_LENGTH);
          var normalized = normalizeName(name);
          if (!name || usedNames.has(normalized)) return presets;
          usedNames.add(normalized);
          var presetId = typeof rawPreset.id === "string" && rawPreset.id ? rawPreset.id : createId("preset");
          if (usedPresetIds.has(presetId)) presetId = createId("preset");
          usedPresetIds.add(presetId);
          presets.push({
            id: presetId,
            name: name,
            entries: sanitizeEntries(rawPreset.entries),
            updatedAt: typeof rawPreset.updatedAt === "number" ? rawPreset.updatedAt : Date.now()
          });
          return presets;
        }, []);
      }
    } catch (error) {
      state.entries = [];
      state.presets = [];
      initialNotice = "Saved wheel data was unreadable. A blank wheel was opened safely.";
    }
  }

  function persistState() {
    if (!state.storageEnabled) return;
    // Keep one versioned envelope so future releases can migrate draft and preset data together.
    var envelope = {
      version: STORAGE_VERSION,
      draft: { entries: cloneEntries(state.entries, false) },
      presets: state.presets.map(function (preset) {
        return {
          id: preset.id,
          name: preset.name,
          entries: cloneEntries(preset.entries, false),
          updatedAt: preset.updatedAt
        };
      })
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch (error) {
      state.storageEnabled = false;
      setStatus("Browser storage became unavailable. Current changes remain usable for this session.", "warning", 0);
    }
  }

  function normalizeName(name) {
    return name.toLocaleLowerCase();
  }

  function findPresetByName(name) {
    var normalized = normalizeName(name);
    return state.presets.find(function (preset) {
      return normalizeName(preset.name) === normalized;
    });
  }

  function makeUniquePresetName(baseName) {
    var root = cleanText(baseName, MAX_LABEL_LENGTH) || "Untitled";
    var candidate = root.slice(0, MAX_LABEL_LENGTH - 5) + " copy";
    var number = 2;
    while (findPresetByName(candidate)) {
      var suffix = " copy " + number;
      candidate = root.slice(0, MAX_LABEL_LENGTH - suffix.length) + suffix;
      number += 1;
    }
    return candidate;
  }

  function setStatus(message, tone, duration) {
    window.clearTimeout(statusTimer);
    dom.editorStatus.textContent = message;
    dom.editorStatus.dataset.tone = tone || "info";
    if (duration !== 0) {
      statusTimer = window.setTimeout(function () {
        dom.editorStatus.textContent = state.storageEnabled ? "" : "Changes will last for this session only.";
        dom.editorStatus.dataset.tone = state.storageEnabled ? "info" : "warning";
      }, duration || 3600);
    }
  }

  function emitSoundEvent(name, detail) {
    soundEvents.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function svgElement(name, attributes) {
    var element = document.createElementNS(SVG_NS, name);
    Object.keys(attributes || {}).forEach(function (key) {
      element.setAttribute(key, attributes[key]);
    });
    return element;
  }

  function polar(radius, angle) {
    var radians = angle * Math.PI / 180;
    return {
      x: 300 + radius * Math.cos(radians),
      y: 300 + radius * Math.sin(radians)
    };
  }

  function wedgePath(startAngle, endAngle, radius) {
    var start = polar(radius, startAngle);
    var end = polar(radius, endAngle);
    var largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return "M 300 300 L " + start.x + " " + start.y + " A " + radius + " " + radius + " 0 " + largeArc + " 1 " + end.x + " " + end.y + " Z";
  }

  function hashString(value) {
    var hash = 0;
    for (var index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  }

  function colorFor(entry) {
    if (entry.presetKind && TIER_COLORS[entry.presetKind]) return TIER_COLORS[entry.presetKind];
    return CUSTOM_COLORS[hashString(entry.id) % CUSTOM_COLORS.length];
  }

  function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function abbreviatedLabel(label, count) {
    var maximum = count <= 8 ? 22 : count <= 18 ? 16 : count <= 36 ? 11 : 8;
    return label.length > maximum ? label.slice(0, maximum - 1) + "…" : label;
  }

  function labelFontSize(count) {
    if (count <= 6) return 17;
    if (count <= 12) return 14;
    if (count <= 24) return 12;
    if (count <= 40) return 10;
    return 8.5;
  }

  function renderWinnerCallout(entry, expansion) {
    dom.winnerCallout.replaceChildren();
    if (!entry || expansion < 0.12) return;

    var color = colorFor(entry);
    var plate = svgElement("rect", {
      class: "winner-callout__plate",
      x: "62",
      y: "48",
      width: "476",
      height: "92",
      rx: "18",
      stroke: color
    });
    var kicker = svgElement("text", {
      class: "winner-callout__kicker",
      x: "300",
      y: "77",
      "text-anchor": "middle"
    });
    kicker.textContent = "SELECTED";

    var fontSize = entry.label.length <= 18 ? 29 : entry.label.length <= 32 ? 22 : 17;
    var label = svgElement("text", {
      class: "winner-callout__text",
      x: "300",
      y: "115",
      "font-size": String(fontSize),
      "text-anchor": "middle"
    });
    label.textContent = entry.label;

    dom.winnerCallout.append(plate, kicker, label);
    dom.winnerCallout.classList.add("is-visible");
  }

  function renderWheel(entries, winnerId, expansion) {
    dom.rotor.replaceChildren();
    dom.winnerCallout.replaceChildren();
    dom.winnerCallout.classList.remove("is-visible");

    var count = entries.length;
    if (!count) {
      dom.wheelDescription.textContent = "The wheel is empty. Add an entry to begin.";
      dom.rotor.style.transform = "rotate(" + state.rotation + "deg)";
      return;
    }

    var sliceAngle = 360 / count;
    entries.forEach(function (entry, index) {
      var isWinner = entry.id === winnerId;
      var winnerExpansion = isWinner ? expansion || 0 : 0;
      var radius = 276 + 24 * winnerExpansion;
      var startAngle = -90 + index * sliceAngle;
      var endAngle = -90 + (index + 1) * sliceAngle;
      var centerAngle = -90 + (index + 0.5) * sliceAngle;
      var groupClass = "wheel-slice";
      if (winnerId && isWinner) groupClass += " is-winner";
      if (winnerId && !isWinner) groupClass += " is-dimmed";

      var group = svgElement("g", {
        class: groupClass,
        role: "listitem",
        "aria-label": entry.label
      });
      var title = svgElement("title");
      title.textContent = entry.label;
      group.appendChild(title);

      if (count === 1) {
        group.appendChild(svgElement("circle", {
          class: "wheel-slice__shape",
          cx: "300",
          cy: "300",
          r: String(radius),
          fill: colorFor(entry)
        }));
      } else {
        group.appendChild(svgElement("path", {
          class: "wheel-slice__shape",
          d: wedgePath(startAngle, endAngle, radius),
          fill: colorFor(entry)
        }));
      }

      var labelRadius = 238 + 10 * winnerExpansion;
      var position = polar(labelRadius, centerAngle);
      var normalizedCenter = normalizeAngle(centerAngle);
      var rotation = centerAngle;
      var anchor = "end";
      if (normalizedCenter > 90 && normalizedCenter < 270) {
        rotation += 180;
        anchor = "start";
      }

      var text = svgElement("text", {
        class: "wheel-slice__label",
        x: String(position.x),
        y: String(position.y),
        "font-size": String(labelFontSize(count) + 2 * winnerExpansion),
        "text-anchor": anchor,
        "dominant-baseline": "middle",
        transform: "rotate(" + rotation + " " + position.x + " " + position.y + ")"
      });
      text.textContent = abbreviatedLabel(entry.label, count);
      group.appendChild(text);
      dom.rotor.appendChild(group);
    });

    dom.rotor.style.transform = "rotate(" + state.rotation + "deg)";
    var selected = winnerId && entries.find(function (entry) { return entry.id === winnerId; });
    dom.wheelDescription.textContent = selected
      ? "The selected entry is " + selected.label + "."
      : "A wheel with " + count + (count === 1 ? " equal entry." : " equal entries.");

    if (selected) renderWinnerCallout(selected, expansion || 0);
  }

  function tierName(kind) {
    if (kind === "ur") return "UR";
    if (kind === "sr") return "SR";
    if (kind === "r") return "R";
    return "";
  }

  function makeButton(className, text, label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.dataset.action = action;
    return button;
  }

  function renderSliceList() {
    dom.sliceList.replaceChildren();
    if (!state.entries.length) {
      var empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "No entries yet.";
      dom.sliceList.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    state.entries.forEach(function (entry, index) {
      var row = document.createElement("li");
      row.className = "slice-row";
      row.dataset.entryId = entry.id;

      var number = document.createElement("span");
      number.className = "slice-index";
      number.textContent = String(index + 1).padStart(2, "0");

      var identity = document.createElement("div");
      identity.className = "slice-label-wrap";
      var input = document.createElement("input");
      input.className = "slice-label-input";
      input.type = "text";
      input.maxLength = MAX_LABEL_LENGTH;
      input.value = entry.label;
      input.autocomplete = "off";
      input.setAttribute("aria-label", "Rename entry " + (index + 1));
      identity.appendChild(input);

      if (entry.presetKind) {
        var mark = document.createElement("span");
        mark.className = "tier-mark tier-mark--" + entry.presetKind;
        mark.textContent = tierName(entry.presetKind);
        mark.setAttribute("aria-label", tierName(entry.presetKind) + " visual tier");
        identity.appendChild(mark);
      }

      var actions = document.createElement("div");
      actions.className = "row-actions";
      var up = makeButton("icon-button", "↑", "Move " + entry.label + " up", "up");
      var down = makeButton("icon-button", "↓", "Move " + entry.label + " down", "down");
      var remove = makeButton("icon-button icon-button--remove", "×", "Remove " + entry.label, "remove");
      up.disabled = index === 0;
      down.disabled = index === state.entries.length - 1;
      actions.append(up, down, remove);

      row.append(number, identity, actions);
      fragment.appendChild(row);
    });
    dom.sliceList.appendChild(fragment);
  }

  function presetActionButton(text, action, name, extraClass) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "small-button" + (extraClass ? " " + extraClass : "");
    button.dataset.action = action;
    button.textContent = text;
    button.setAttribute("aria-label", text + " preset " + name);
    return button;
  }

  function renderPresetList() {
    dom.presetList.replaceChildren();
    if (!state.presets.length) {
      var empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "No saved wheels.";
      dom.presetList.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    state.presets.forEach(function (preset) {
      var row = document.createElement("li");
      row.className = "preset-row";
      row.dataset.presetId = preset.id;

      var top = document.createElement("div");
      top.className = "preset-row__top";
      var input = document.createElement("input");
      input.className = "preset-name-input";
      input.type = "text";
      input.maxLength = MAX_LABEL_LENGTH;
      input.value = preset.name;
      input.autocomplete = "off";
      input.setAttribute("aria-label", "Rename preset " + preset.name);
      var count = document.createElement("span");
      count.className = "preset-row__count";
      count.textContent = preset.entries.length + (preset.entries.length === 1 ? " entry" : " entries");
      top.append(input, count);

      var actions = document.createElement("div");
      actions.className = "preset-row__actions";
      actions.append(
        presetActionButton("Load", "load", preset.name),
        presetActionButton("Rename", "rename", preset.name),
        presetActionButton("Duplicate", "duplicate", preset.name),
        presetActionButton("Delete", "delete", preset.name, "small-button--delete")
      );
      row.append(top, actions);
      fragment.appendChild(row);
    });
    dom.presetList.appendChild(fragment);
  }

  function syncControls() {
    var count = state.entries.length;
    var atLimit = count >= MAX_ENTRIES;
    dom.spinButton.disabled = count === 0;
    dom.spinCount.textContent = count ? count + (count === 1 ? " entry" : " entries") : "No entries";
    dom.entryTotal.textContent = count + " / " + MAX_ENTRIES;
    dom.emptyWheel.hidden = count !== 0;
    document.querySelectorAll("[data-tier]").forEach(function (button) {
      button.disabled = atLimit;
    });
    dom.customForm.querySelector("button[type='submit']").disabled = atLimit;
  }

  function renderAll() {
    renderWheel(state.entries, null, 0);
    renderSliceList();
    renderPresetList();
    syncControls();
  }

  function commitChange(message) {
    persistState();
    renderAll();
    if (message) setStatus(message);
  }

  function addEntry(label, presetKind) {
    if (state.entries.length >= MAX_ENTRIES) {
      setStatus("The wheel is limited to " + MAX_ENTRIES + " entries.", "warning");
      return false;
    }
    state.entries.push({ id: createId("entry"), label: label, presetKind: presetKind || null });
    return true;
  }

  function focusRowAction(entryId, action) {
    window.requestAnimationFrame(function () {
      var row = Array.from(dom.sliceList.children).find(function (candidate) {
        return candidate.dataset.entryId === entryId;
      });
      var button = row && row.querySelector("[data-action='" + action + "']");
      if (button) button.focus();
    });
  }

  function requestConfirmation(options) {
    if (!dom.confirmDialog || typeof dom.confirmDialog.showModal !== "function") {
      return Promise.resolve(window.confirm(options.message));
    }

    dom.confirmTitle.textContent = options.title;
    dom.confirmMessage.textContent = options.message;
    dom.confirmAction.textContent = options.confirmLabel || "Confirm";
    dom.confirmDialog.returnValue = "";
    dom.confirmDialog.showModal();

    return new Promise(function (resolve) {
      pendingConfirmation = resolve;
    });
  }

  function handleDialogClose() {
    if (!pendingConfirmation) return;
    var resolve = pendingConfirmation;
    pendingConfirmation = null;
    resolve(dom.confirmDialog.returnValue === "confirm");
  }

  function randomIndex(maximum) {
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      // Rejection sampling avoids modulo bias when the entry count does not divide 2^32.
      var range = 0x100000000;
      var limit = range - (range % maximum);
      var values = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(values);
      } while (values[0] >= limit);
      return values[0] % maximum;
    }
    return Math.floor(Math.random() * maximum);
  }

  function setCinematic(active) {
    document.body.classList.toggle("is-cinematic", active);
    document.querySelectorAll(".setup-only").forEach(function (element) {
      if (active) {
        element.setAttribute("inert", "");
        element.setAttribute("aria-hidden", "true");
      } else {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      }
    });
  }

  function setRotation(value) {
    state.rotation = value;
    dom.rotor.style.transform = "rotate(" + value + "deg)";
  }

  function animateValue(from, to, duration, easing, onUpdate, tickAngle) {
    return new Promise(function (resolve) {
      var startTime = performance.now();
      var lastTick = tickAngle ? Math.floor(from / tickAngle) : 0;

      function frame(now) {
        var elapsed = now - startTime;
        var progress = Math.min(1, elapsed / duration);
        var value = from + (to - from) * easing(progress);
        onUpdate(value, progress);

        if (tickAngle) {
          var currentTick = Math.floor(value / tickAngle);
          if (currentTick !== lastTick) {
            lastTick = currentTick;
            tickPointer();
            emitSoundEvent("pointerTick", { rotation: value });
          }
        }

        if (progress < 1) {
          window.requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }

      window.requestAnimationFrame(frame);
    });
  }

  function spinEase(progress) {
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  }

  function easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3);
  }

  function easeOutBack(progress) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
  }

  function tickPointer() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof dom.wheelPointer.animate === "function") {
      dom.wheelPointer.animate([
        { transform: "translateX(-50%) rotate(0deg)" },
        { transform: "translateX(-50%) rotate(4.5deg)", offset: 0.42 },
        { transform: "translateX(-50%) rotate(0deg)" }
      ], { duration: 92, easing: "ease-out" });
    }
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function hexToRgba(hex, alpha) {
    var numeric = parseInt(hex.slice(1), 16);
    var red = (numeric >> 16) & 255;
    var green = (numeric >> 8) & 255;
    var blue = numeric & 255;
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  async function startSpin() {
    if (state.phase !== "setup" || !state.entries.length) return;

    var snapshot = cloneEntries(state.entries, false);
    var winnerIndex = randomIndex(snapshot.length);
    var winner = snapshot[winnerIndex];
    var sliceAngle = 360 / snapshot.length;
    var winnerCenter = -90 + (winnerIndex + 0.5) * sliceAngle;
    // Rotate the frozen winner's center to the fixed 12 o'clock pointer, then add full turns for weight.
    var desiredRotation = normalizeAngle(-90 - winnerCenter);
    var currentNormalized = normalizeAngle(state.rotation);
    var alignment = normalizeAngle(desiredRotation - currentNormalized);
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    state.phase = "spinning";
    state.spinSnapshot = snapshot;
    state.winnerIndex = winnerIndex;
    if (document.activeElement) document.activeElement.blur();
    setCinematic(true);
    renderWheel(snapshot, null, 0);
    emitSoundEvent("spinStart", { entryCount: snapshot.length });

    var finalRotation;
    if (reducedMotion) {
      finalRotation = state.rotation + alignment;
      await delay(90);
      setRotation(finalRotation);
      await delay(130);
    } else {
      var fullTurns = 6 + Math.min(2, Math.floor(snapshot.length / 24));
      finalRotation = state.rotation + fullTurns * 360 + alignment;
      var overshoot = Math.min(4, Math.max(1.2, sliceAngle * 0.08));
      var overshootRotation = finalRotation + overshoot;

      await animateValue(
        state.rotation,
        overshootRotation,
        SPIN_DURATION,
        spinEase,
        function (value) { setRotation(value); },
        sliceAngle
      );

      state.phase = "landing";
      await animateValue(
        overshootRotation,
        finalRotation,
        SETTLE_DURATION,
        easeOutCubic,
        function (value) { setRotation(value); }
      );
    }

    state.phase = "landing";
    setRotation(finalRotation);
    document.body.classList.add("has-winner");
    document.body.style.setProperty("--winner-glow", hexToRgba(colorFor(winner), 0.52));
    emitSoundEvent("winnerLand", { entry: cloneEntries([winner], false)[0], index: winnerIndex });

    await animateValue(
      0,
      1,
      reducedMotion ? 170 : REVEAL_DURATION,
      reducedMotion ? easeOutCubic : easeOutBack,
      function (value) { renderWheel(snapshot, winner.id, value); }
    );

    renderWheel(snapshot, winner.id, 1);
    state.phase = "result";
    document.body.classList.add("is-result");
    dom.resultAnnouncement.textContent = "Selected: " + winner.label + ". Click anywhere or press any key to return to setup.";
  }

  function exitResult() {
    if (state.phase !== "result") return;
    var winner = state.spinSnapshot && state.spinSnapshot[state.winnerIndex];
    state.phase = "setup";
    state.rotation = 0;
    state.spinSnapshot = null;
    state.winnerIndex = -1;
    document.body.classList.remove("is-result", "has-winner");
    document.body.style.removeProperty("--winner-glow");
    setCinematic(false);
    renderWheel(state.entries, null, 0);
    syncControls();
    dom.resultAnnouncement.textContent = "";
    emitSoundEvent("exitResult", { entry: winner ? cloneEntries([winner], false)[0] : null });
    setStatus("Returned to setup. Your wheel is unchanged.");
    window.requestAnimationFrame(function () { dom.spinButton.focus(); });
  }

  document.querySelectorAll("[data-tier]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (addEntry(button.dataset.label, button.dataset.tier)) {
        commitChange(button.dataset.label + " added.");
      }
    });
  });

  dom.customForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var label = cleanText(dom.customLabel.value, MAX_LABEL_LENGTH);
    var quantity = Number(dom.customQuantity.value);
    if (!label) {
      setStatus("Enter a custom label first.", "warning");
      dom.customLabel.focus();
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ENTRIES) {
      setStatus("Quantity must be a whole number from 1 to " + MAX_ENTRIES + ".", "warning");
      dom.customQuantity.focus();
      return;
    }
    if (state.entries.length + quantity > MAX_ENTRIES) {
      setStatus("Only " + (MAX_ENTRIES - state.entries.length) + " wheel slots remain.", "warning");
      dom.customQuantity.focus();
      return;
    }

    for (var index = 0; index < quantity; index += 1) addEntry(label, null);
    dom.customLabel.value = "";
    dom.customQuantity.value = "1";
    commitChange(quantity + " " + (quantity === 1 ? "entry" : "entries") + " added.");
    dom.customLabel.focus();
  });

  dom.sliceList.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.classList.contains("slice-label-input")) {
      event.preventDefault();
      event.target.blur();
    }
  });

  dom.sliceList.addEventListener("change", function (event) {
    if (!event.target.classList.contains("slice-label-input")) return;
    var row = event.target.closest("[data-entry-id]");
    var entry = state.entries.find(function (candidate) { return candidate.id === row.dataset.entryId; });
    if (!entry) return;
    var label = cleanText(event.target.value, MAX_LABEL_LENGTH);
    if (!label) {
      event.target.value = entry.label;
      setStatus("Entry labels cannot be blank.", "warning");
      return;
    }
    entry.label = label;
    commitChange("Entry renamed.");
  });

  dom.sliceList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var row = button.closest("[data-entry-id]");
    var index = state.entries.findIndex(function (entry) { return entry.id === row.dataset.entryId; });
    if (index < 0) return;
    var entry = state.entries[index];
    var action = button.dataset.action;

    if (action === "remove") {
      state.entries.splice(index, 1);
      commitChange(entry.label + " removed.");
      var next = state.entries[Math.min(index, state.entries.length - 1)];
      if (next) focusRowAction(next.id, "remove");
      else dom.customLabel.focus();
      return;
    }

    var targetIndex = action === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.entries.length) return;
    state.entries.splice(index, 1);
    state.entries.splice(targetIndex, 0, entry);
    commitChange(entry.label + " moved " + action + ".");
    focusRowAction(entry.id, action);
  });

  dom.savePresetForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var name = cleanText(dom.presetName.value, MAX_LABEL_LENGTH);
    if (!name) {
      setStatus("Enter a preset name first.", "warning");
      dom.presetName.focus();
      return;
    }

    var existing = findPresetByName(name);
    if (existing) {
      var shouldOverwrite = await requestConfirmation({
        title: "Replace saved wheel?",
        message: "“" + existing.name + "” already exists. Replace its saved entries with the current wheel?",
        confirmLabel: "Replace"
      });
      if (!shouldOverwrite) return;
      existing.entries = cloneEntries(state.entries, false);
      existing.updatedAt = Date.now();
      commitChange(existing.name + " updated.");
    } else {
      state.presets.push({
        id: createId("preset"),
        name: name,
        entries: cloneEntries(state.entries, false),
        updatedAt: Date.now()
      });
      commitChange(name + " saved.");
    }
    dom.presetName.value = "";
  });

  dom.presetList.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.classList.contains("preset-name-input")) {
      event.preventDefault();
      var row = event.target.closest("[data-preset-id]");
      row.querySelector("[data-action='rename']").click();
    }
  });

  dom.presetList.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var row = button.closest("[data-preset-id]");
    var preset = state.presets.find(function (candidate) { return candidate.id === row.dataset.presetId; });
    if (!preset) return;
    var action = button.dataset.action;

    if (action === "load") {
      var canLoad = !state.entries.length || await requestConfirmation({
        title: "Replace current wheel?",
        message: "Loading “" + preset.name + "” will replace the entries currently on the wheel.",
        confirmLabel: "Load preset"
      });
      if (!canLoad) return;
      state.entries = cloneEntries(preset.entries, false);
      commitChange(preset.name + " loaded.");
      return;
    }

    if (action === "rename") {
      var input = row.querySelector(".preset-name-input");
      var nextName = cleanText(input.value, MAX_LABEL_LENGTH);
      if (!nextName) {
        input.value = preset.name;
        setStatus("Preset names cannot be blank.", "warning");
        return;
      }
      var conflict = findPresetByName(nextName);
      if (conflict && conflict.id !== preset.id) {
        input.value = preset.name;
        setStatus("A preset with that name already exists.", "warning");
        return;
      }
      preset.name = nextName;
      preset.updatedAt = Date.now();
      commitChange("Preset renamed to " + nextName + ".");
      return;
    }

    if (action === "duplicate") {
      var copyName = makeUniquePresetName(preset.name);
      state.presets.push({
        id: createId("preset"),
        name: copyName,
        entries: cloneEntries(preset.entries, true),
        updatedAt: Date.now()
      });
      commitChange(copyName + " created.");
      return;
    }

    if (action === "delete") {
      var shouldDelete = await requestConfirmation({
        title: "Delete saved wheel?",
        message: "Delete “" + preset.name + "”? This cannot be undone.",
        confirmLabel: "Delete"
      });
      if (!shouldDelete) return;
      state.presets = state.presets.filter(function (candidate) { return candidate.id !== preset.id; });
      commitChange(preset.name + " deleted.");
    }
  });

  dom.spinButton.addEventListener("click", startSpin);
  dom.confirmDialog.addEventListener("close", handleDialogClose);

  window.addEventListener("click", function (event) {
    if (state.phase !== "result") return;
    // Consume the dismissal click before setup returns so it cannot click through into a newly visible control.
    event.preventDefault();
    event.stopImmediatePropagation();
    exitResult();
  }, true);

  window.addEventListener("keydown", function (event) {
    var keyId = event.code || event.key;
    if (state.phase === "spinning" || state.phase === "landing") {
      heldCinematicKeys.add(keyId);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (state.phase !== "result") return;
    if (heldCinematicKeys.has(keyId) || event.repeat) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exitResult();
  }, true);

  window.addEventListener("keyup", function (event) {
    heldCinematicKeys.delete(event.code || event.key);
  }, true);

  hydrateState();
  renderAll();
  if (initialNotice) setStatus(initialNotice, "warning", 0);
}());

(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var STORAGE_KEY = "selection-wheel:v1";
  var STORAGE_VERSION = 2;
  var DEFAULT_SEED_VERSION = 1;
  var MAX_ENTRIES = 60;
  var MAX_LABEL_LENGTH = 48;
  var BASE_COAST_DURATION = 4300;
  var MAX_COAST_DURATION = 9300;
  var SETTLE_DURATION = 700;
  var REVEAL_DURATION = 620;
  var BOOST_RECOVERY_MS = 1500;
  var BOOST_RESERVE_COST = 0.45;
  var BOOST_EXTENSION_MS = 1500;

  var REWARDS = {
    ur: { label: "UR", singular: "UR", plural: "UR", image: "UR_Craft_Asset.png", color: "#bd4fe2", precedence: 90 },
    gems: { label: "Gems", singular: "Gem", plural: "Gems", image: "Master_Duel_Gem.png", color: "#766cff", precedence: 85 },
    packs: { label: "Secret Packs", singular: "Secret Pack", plural: "Secret Packs", shortSingular: "Pack", shortPlural: "Packs", image: "The_Masters_Saga-Pack-Master_Duel.png", color: "#dfa735", precedence: 80, crop: "pack" },
    bans: { label: "Bans", singular: "Ban", plural: "Bans", image: "pot-of-greed-2.avif", color: "#4fc27a", precedence: 70, crop: "pot" },
    sr: { label: "SR", singular: "SR", plural: "SR", image: "SR_Craft_asset.png", color: "#e6bc3f", precedence: 60 },
    r: { label: "R", singular: "R", plural: "R", image: "R_Craft_asset.png", color: "#31bde8", precedence: 50 },
    n: { label: "N", singular: "N", plural: "N", image: "N_Craft_asset.png", color: "#aeb8c5", precedence: 40 },
    nr: { label: "N/R", singular: "N/R", plural: "N/R", image: "N_R_Craft_asset.png", color: "#6da8c4", precedence: 30 },
    custom: { label: "Custom text", singular: "", plural: "", image: null, color: "#a5afc0", precedence: 0 }
  };
  var CUSTOM_COLORS = ["#235fac", "#7440b5", "#0a8e87", "#b44770", "#4e68c4", "#9a5a2d"];

  var dom = {
    rotor: document.getElementById("wheel-rotor"),
    wheelDescription: document.getElementById("wheel-description"),
    winnerCallout: document.getElementById("winner-callout"),
    wheelPointer: document.getElementById("wheel-pointer"),
    spinButton: document.getElementById("spin-button"),
    sphealRotator: document.getElementById("spheal-rotator"),
    sphealReactor: document.getElementById("spheal-reactor"),
    sphealPulse: document.getElementById("spheal-pulse"),
    spinCount: document.getElementById("spin-count"),
    entryTotal: document.getElementById("entry-total"),
    emptyWheel: document.getElementById("empty-wheel"),
    customForm: document.getElementById("custom-entry-form"),
    customLabel: document.getElementById("custom-label"),
    sharedQuantity: document.getElementById("shared-quantity"),
    sliceList: document.getElementById("slice-list"),
    savePresetForm: document.getElementById("save-preset-form"),
    presetName: document.getElementById("preset-name"),
    presetList: document.getElementById("preset-list"),
    riggedToggle: document.getElementById("rigged-toggle"),
    riggedWinner: document.getElementById("rigged-winner"),
    editorStatus: document.getElementById("editor-status"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmMessage: document.getElementById("confirm-message"),
    confirmAction: document.getElementById("confirm-action"),
    resultAnnouncement: document.getElementById("result-announcement"),
    resultCard: document.getElementById("result-card"),
    resultPrimary: document.getElementById("result-primary"),
    resultAlternatives: document.getElementById("result-alternatives"),
    composerToggle: document.getElementById("composer-toggle"),
    composer: document.getElementById("entry-composer"),
    composerClose: document.getElementById("composer-close"),
    componentType: document.getElementById("component-type"),
    componentTarget: document.getElementById("component-target"),
    componentCustomField: document.getElementById("component-custom-field"),
    componentCustomText: document.getElementById("component-custom-text"),
    componentAdd: document.getElementById("component-add"),
    alwaysComponents: document.getElementById("always-components"),
    alternativeList: document.getElementById("alternative-list"),
    addAlternative: document.getElementById("add-alternative"),
    composerPreview: document.getElementById("composer-preview"),
    composerValidation: document.getElementById("composer-validation"),
    composerReset: document.getElementById("composer-reset"),
    composerSubmit: document.getElementById("composer-submit")
  };

  var soundEvents = new EventTarget();
  window.selectionWheelSoundEvents = soundEvents;

  var state = {
    entries: [],
    presets: [],
    quantity: 1,
    riggedEnabled: false,
    riggedTargetId: null,
    phase: "setup",
    rotation: 0,
    spinSnapshot: null,
    winnerIndex: -1,
    spinMotion: null,
    storageEnabled: storageIsAvailable(),
    composer: { always: [], options: [] },
    editingEntryId: null
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

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneEntries(entries, useFreshIds) {
    return entries.map(function (entry) {
      var copy = deepClone(entry);
      if (useFreshIds) copy.id = createId("entry");
      return copy;
    });
  }

  function sanitizeComponent(raw) {
    if (!raw || typeof raw !== "object") return null;
    var type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
    if (!REWARDS[type]) return null;
    var amount = Number(raw.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 999) return null;
    if (type === "custom") {
      var text = cleanText(raw.text, MAX_LABEL_LENGTH);
      return text ? { type: "custom", amount: amount, text: text } : null;
    }
    return { type: type, amount: amount };
  }

  function sanitizeReward(raw) {
    if (!raw || typeof raw !== "object") return null;
    var always = Array.isArray(raw.always) ? raw.always.map(sanitizeComponent).filter(Boolean).slice(0, 12) : [];
    var options = Array.isArray(raw.options) ? raw.options.map(function (branch) {
      return Array.isArray(branch) ? branch.map(sanitizeComponent).filter(Boolean).slice(0, 12) : [];
    }).filter(function (branch) { return branch.length; }).slice(0, 12) : [];
    return always.length || options.length ? { schema: 1, always: always, options: options } : null;
  }

  function sanitizeEntries(candidate) {
    if (!Array.isArray(candidate)) return [];
    var seenIds = new Set();
    var entries = [];

    candidate.slice(0, MAX_ENTRIES).forEach(function (rawEntry) {
      if (!rawEntry || typeof rawEntry !== "object") return;
      var reward = rawEntry.kind === "structured" ? sanitizeReward(rawEntry.reward) : null;
      var label = reward ? rewardDescription(reward) : cleanText(rawEntry.label, MAX_LABEL_LENGTH);
      if (!label) return;

      var id = typeof rawEntry.id === "string" && rawEntry.id ? rawEntry.id : createId("entry");
      if (seenIds.has(id)) id = createId("entry");
      seenIds.add(id);

      if (reward) entries.push({ id: id, kind: "structured", reward: reward });
      else entries.push({ id: id, kind: "custom", label: label, presetKind: typeof rawEntry.presetKind === "string" ? rawEntry.presetKind : null });
    });

    return entries;
  }

  function hydrateState() {
    if (!state.storageEnabled) {
      initialNotice = "Browser storage is unavailable. Changes will last for this session only.";
      seedDefaultPresets(0);
      return;
    }

    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        seedDefaultPresets(0);
        persistState();
        return;
      }
      var envelope = JSON.parse(raw);
      if (!envelope || (envelope.version !== 1 && envelope.version !== STORAGE_VERSION)) {
        seedDefaultPresets(0);
        initialNotice = "Saved wheel data could not be restored. A blank wheel was opened safely.";
        return;
      }

      state.entries = sanitizeEntries(envelope.draft && envelope.draft.entries);
      var storedQuantity = Number(envelope.draft && envelope.draft.quantity);
      state.quantity = Number.isInteger(storedQuantity) && storedQuantity >= 1 && storedQuantity <= MAX_ENTRIES
        ? storedQuantity
        : 1;

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
      seedDefaultPresets(Number(envelope.defaultSeedVersion) || 0);
      persistState();
    } catch (error) {
      state.entries = [];
      state.presets = [];
      seedDefaultPresets(0);
      initialNotice = "Saved wheel data was unreadable. A blank wheel was opened safely.";
    }
  }

  function persistState() {
    if (!state.storageEnabled) return;
    // Keep one versioned envelope so future releases can migrate draft and preset data together.
    var envelope = {
      version: STORAGE_VERSION,
      defaultSeedVersion: DEFAULT_SEED_VERSION,
      draft: {
        entries: cloneEntries(state.entries, false),
        quantity: state.quantity
      },
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

  function component(type, amount, text) {
    var value = { type: type, amount: amount };
    if (type === "custom") value.text = text;
    return value;
  }

  function structuredEntry(always, options) {
    return { id: createId("entry"), kind: "structured", reward: { schema: 1, always: always || [], options: options || [] } };
  }

  function componentWords(item, short) {
    if (item.type === "custom") return (item.amount > 1 ? item.amount + " × " : "") + item.text;
    var definition = REWARDS[item.type];
    var singular = short && definition.shortSingular ? definition.shortSingular : definition.singular;
    var plural = short && definition.shortPlural ? definition.shortPlural : definition.plural;
    return item.amount + " " + (item.amount === 1 ? singular : plural);
  }

  function branchDescription(branch, short) {
    return branch.map(function (item) { return componentWords(item, short); }).join(" + ");
  }

  function rewardDescription(reward) {
    var always = branchDescription(reward.always || [], false);
    var options = (reward.options || []).map(function (branch) { return branchDescription(branch, false); });
    if (!options.length) return always;
    var choice = options.join(" or ");
    return always ? always + " + (" + choice + ")" : choice;
  }

  function entryLabel(entry) {
    return entry.kind === "structured" ? rewardDescription(entry.reward) : entry.label;
  }

  function componentPrecedence(item) {
    return REWARDS[item.type] ? REWARDS[item.type].precedence : 0;
  }

  function sortedComponents(items) {
    return items.map(function (item, index) { return { item: item, index: index }; })
      .sort(function (a, b) { return componentPrecedence(b.item) - componentPrecedence(a.item) || a.index - b.index; })
      .map(function (pair) { return pair.item; });
  }

  function branchPrecedence(branch) {
    return branch.reduce(function (highest, item) { return Math.max(highest, componentPrecedence(item)); }, -1);
  }

  function primaryOptionIndex(reward) {
    var bestIndex = -1;
    var bestPrecedence = -1;
    (reward.options || []).forEach(function (branch, index) {
      var precedence = branchPrecedence(branch);
      if (precedence > bestPrecedence) {
        bestPrecedence = precedence;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function primaryComponents(reward) {
    var components = (reward.always || []).slice();
    var primaryIndex = primaryOptionIndex(reward);
    if (primaryIndex >= 0) components = components.concat(reward.options[primaryIndex]);
    return sortedComponents(components);
  }

  function presetEntry(always, options) {
    return structuredEntry(always, options);
  }

  function defaultPresets() {
    var srNr = function (sr, nr) { return presetEntry([], [[component("sr", sr)], [component("nr", nr)]]); };
    var urSrNr = function (ur, sr, nr) { return presetEntry([], [[component("ur", ur)], [component("sr", sr)], [component("nr", nr)]]); };
    var farfaPack = function () { return presetEntry([component("packs", 5)], [[component("sr", 1)], [component("nr", 3)]]); };
    return [
      { name: "1-1 Wheel", entries: [srNr(1, 2), srNr(1, 3), srNr(2, 4), srNr(1, 2), srNr(1, 3), srNr(2, 4)] },
      { name: "Winner's Wheel", entries: [srNr(1, 3), urSrNr(1, 1, 3), srNr(1, 3), srNr(2, 3), srNr(1, 3), urSrNr(1, 1, 3)] },
      { name: "Farfa Wheel", entries: [
        farfaPack(),
        presetEntry([component("bans", 2)], []),
        srNr(3, 3),
        farfaPack(),
        urSrNr(1, 2, 4),
        presetEntry([component("sr", 2), component("nr", 4)], [])
      ] }
    ];
  }

  function seedDefaultPresets(previousVersion) {
    if (previousVersion >= DEFAULT_SEED_VERSION) return;
    defaultPresets().forEach(function (approved) {
      var existing = findPresetByName(approved.name);
      var seeded = { id: existing ? existing.id : createId("preset"), name: approved.name, entries: approved.entries, updatedAt: Date.now() };
      if (existing) state.presets[state.presets.indexOf(existing)] = seeded;
      else state.presets.push(seeded);
    });
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
    if (entry.kind === "structured") {
      var primary = primaryComponents(entry.reward);
      if (primary.length && REWARDS[primary[0].type]) return REWARDS[primary[0].type].color;
    }
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

  function appendSvgShorthand(group, entry, position, rotation, count, expansion) {
    if (entry.kind !== "structured") {
      var legacy = svgElement("text", {
        class: "wheel-slice__label", x: "0", y: "0",
        "font-size": String(labelFontSize(count) + 2 * expansion),
        "text-anchor": "middle", "dominant-baseline": "middle"
      });
      legacy.textContent = abbreviatedLabel(entryLabel(entry), count);
      var legacyGroup = svgElement("g", { transform: "translate(" + position.x + " " + position.y + ") rotate(" + rotation + ")" });
      legacyGroup.appendChild(legacy);
      group.appendChild(legacyGroup);
      return;
    }

    var items = primaryComponents(entry.reward);
    var iconSize = count <= 8 ? 38 : count <= 18 ? 30 : count <= 36 ? 23 : 18;
    var fontSize = count <= 8 ? 17 : count <= 18 ? 14 : count <= 36 ? 11 : 9;
    if (items.length === 3) {
      iconSize *= 0.78;
      fontSize *= 0.82;
    }
    var pairWidth = iconSize + fontSize * 1.8;
    var plusWidth = items.length > 1 ? fontSize * 1.45 : 0;
    var totalWidth = items.length * pairWidth + (items.length - 1) * plusWidth;
    var shorthand = svgElement("g", {
      class: "wheel-slice__shorthand wheel-slice__shorthand--" + items.length,
      transform: "translate(" + position.x + " " + position.y + ") rotate(" + rotation + ") translate(" + (-totalWidth / 2) + " 0)"
    });
    var cursor = 0;
    items.forEach(function (item, index) {
      if (index) {
        var plus = svgElement("text", { class: "wheel-slice__plus", x: String(cursor + plusWidth / 2), y: "1", "font-size": String(fontSize), "text-anchor": "middle", "dominant-baseline": "middle" });
        plus.textContent = "+";
        shorthand.appendChild(plus);
        cursor += plusWidth;
      }
      var amount = svgElement("text", { class: "wheel-slice__amount", x: String(cursor + fontSize * 0.72), y: "1", "font-size": String(fontSize), "text-anchor": "middle", "dominant-baseline": "middle" });
      amount.textContent = String(item.amount);
      shorthand.appendChild(amount);
      if (item.type === "custom") {
        var custom = svgElement("text", { class: "wheel-slice__custom", x: String(cursor + fontSize * 1.6), y: "1", "font-size": String(fontSize * 0.76), "dominant-baseline": "middle" });
        custom.textContent = abbreviatedLabel(item.text, count);
        shorthand.appendChild(custom);
      } else {
        var definition = REWARDS[item.type];
        shorthand.appendChild(svgElement("image", {
          class: "wheel-slice__icon wheel-slice__icon--" + (definition.crop || item.type),
          href: definition.image,
          x: String(cursor + fontSize * 1.45), y: String(-iconSize / 2), width: String(iconSize), height: String(iconSize),
          preserveAspectRatio: "xMidYMid slice"
        }));
      }
      cursor += pairWidth;
    });
    group.appendChild(shorthand);
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
        "aria-label": entryLabel(entry)
      });
      var title = svgElement("title");
      title.textContent = entryLabel(entry);
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

      var primaryCount = entry.kind === "structured" ? primaryComponents(entry.reward).length : 0;
      var baseLabelRadius = primaryCount >= 3 ? 170 : primaryCount === 2 ? 180 : primaryCount === 1 ? 220 : 238;
      var labelRadius = baseLabelRadius + 8 * winnerExpansion;
      var position = polar(labelRadius, centerAngle);
      var rotation = centerAngle;
      if (normalizeAngle(centerAngle) > 90 && normalizeAngle(centerAngle) < 270) {
        rotation += 180;
      }
      appendSvgShorthand(group, entry, position, rotation, count, winnerExpansion);
      dom.rotor.appendChild(group);
    });

    dom.rotor.style.transform = "rotate(" + state.rotation + "deg)";
    var selected = winnerId && entries.find(function (entry) { return entry.id === winnerId; });
    dom.wheelDescription.textContent = selected
      ? "The selected entry is " + entryLabel(selected) + "."
      : "A wheel with " + count + (count === 1 ? " equal entry." : " equal entries.");
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

  function clearRigging() {
    state.riggedEnabled = false;
    state.riggedTargetId = null;
    dom.riggedToggle.checked = false;
    dom.riggedWinner.value = "";
  }

  function renderRiggedControls() {
    var targetExists = state.entries.some(function (entry) {
      return entry.id === state.riggedTargetId;
    });
    if (!targetExists) clearRigging();

    dom.riggedWinner.replaceChildren();
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.entries.length ? "Choose an entry" : "Add entries first";
    dom.riggedWinner.appendChild(placeholder);

    state.entries.forEach(function (entry, index) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entryLabel(entry) + " — entry " + (index + 1);
      dom.riggedWinner.appendChild(option);
    });

    dom.riggedWinner.value = state.riggedTargetId || "";
    dom.riggedWinner.disabled = !state.entries.length;
    dom.riggedToggle.checked = state.riggedEnabled;
    dom.riggedToggle.disabled = !targetExists;
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
      if (entry.id === state.riggedTargetId) row.classList.add("is-rigged-target");

      var number = document.createElement("span");
      number.className = "slice-index";
      number.textContent = String(index + 1).padStart(2, "0");

      var identity = document.createElement("div");
      identity.className = "slice-label-wrap";
      if (entry.kind === "structured") {
        var description = document.createElement("span");
        description.className = "slice-structured-label";
        description.textContent = entryLabel(entry);
        identity.appendChild(description);
      } else {
        var input = document.createElement("input");
        input.className = "slice-label-input";
        input.type = "text";
        input.maxLength = MAX_LABEL_LENGTH;
        input.value = entry.label;
        input.autocomplete = "off";
        input.setAttribute("aria-label", "Rename entry " + (index + 1));
        identity.appendChild(input);
      }

      if (entry.id === state.riggedTargetId) {
        var targetMark = document.createElement("span");
        targetMark.className = "rigged-target-mark";
        targetMark.textContent = "Target";
        identity.appendChild(targetMark);
      }

      var actions = document.createElement("div");
      actions.className = "row-actions";
      var label = entryLabel(entry);
      var up = makeButton("icon-button", "↑", "Move " + label + " up", "up");
      var down = makeButton("icon-button", "↓", "Move " + label + " down", "down");
      if (entry.kind === "structured") actions.appendChild(makeButton("icon-button", "✎", "Edit " + label, "edit"));
      var remove = makeButton("icon-button icon-button--remove", "×", "Remove " + label, "remove");
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
    var quantity = state.quantity;
    dom.sharedQuantity.value = String(quantity);
    document.querySelectorAll("[data-reward]").forEach(function (button) {
      var definition = REWARDS[button.dataset.reward];
      var name = quantity === 1 ? (definition.shortSingular || definition.singular) : (definition.shortPlural || definition.plural);
      button.disabled = atLimit;
      button.querySelector("span").textContent = quantity + " " + name;
      button.setAttribute("aria-label", "Add one " + quantity + " " + name + " wheel entry");
    });
    var customAddButton = dom.customForm.querySelector("button[type='submit']");
    customAddButton.disabled = atLimit;
    dom.composerSubmit.disabled = atLimit && !state.editingEntryId;
    renderRiggedControls();
  }

  function composerReward() {
    return { schema: 1, always: deepClone(state.composer.always), options: deepClone(state.composer.options) };
  }

  function composerValidationMessage() {
    var reward = composerReward();
    var components = reward.always.concat.apply(reward.always, reward.options);
    if (!reward.always.length && !reward.options.length) return "Add at least one component.";
    if (reward.options.length === 1) return "Choose one needs at least two alternatives, or remove that alternative.";
    if (reward.options.some(function (branch) { return !branch.length; })) return "Every alternative needs at least one component.";
    if (components.some(function (item) { return item.type === "custom" && !cleanText(item.text, MAX_LABEL_LENGTH); })) return "Custom components need readable text.";
    if (primaryComponents(reward).length > 3) return "The primary wheel shorthand can show at most three components.";
    if (!state.editingEntryId && state.entries.length >= MAX_ENTRIES) return "The wheel is limited to " + MAX_ENTRIES + " entries.";
    return "";
  }

  function createComponentRow(item, zone, branchIndex, itemIndex) {
    var row = document.createElement("div");
    row.className = "component-row";
    row.dataset.zone = zone;
    row.dataset.branchIndex = String(branchIndex);
    row.dataset.itemIndex = String(itemIndex);

    var amount = document.createElement("input");
    amount.type = "number";
    amount.min = "1";
    amount.max = "999";
    amount.value = String(item.amount);
    amount.className = "component-row__amount";
    amount.dataset.field = "amount";
    amount.setAttribute("aria-label", "Component amount");

    var type = document.createElement("select");
    type.className = "component-row__type";
    type.dataset.field = "type";
    type.setAttribute("aria-label", "Component type");
    Object.keys(REWARDS).forEach(function (key) {
      var option = document.createElement("option");
      option.value = key;
      option.textContent = REWARDS[key].label;
      option.selected = key === item.type;
      type.appendChild(option);
    });

    row.append(amount, type);
    if (item.type === "custom") {
      var text = document.createElement("input");
      text.type = "text";
      text.maxLength = MAX_LABEL_LENGTH;
      text.value = item.text || "";
      text.className = "component-row__text";
      text.dataset.field = "text";
      text.setAttribute("aria-label", "Custom component text");
      row.appendChild(text);
    }
    var controls = document.createElement("span");
    controls.className = "component-row__actions";
    controls.append(
      makeButton("mini-icon", "↑", "Move component up", "component-up"),
      makeButton("mini-icon", "↓", "Move component down", "component-down"),
      makeButton("mini-icon mini-icon--remove", "×", "Remove component", "component-remove")
    );
    controls.children[0].disabled = itemIndex === 0;
    var source = zone === "always" ? state.composer.always : state.composer.options[branchIndex];
    controls.children[1].disabled = itemIndex === source.length - 1;
    row.appendChild(controls);
    return row;
  }

  function renderComposer() {
    dom.alwaysComponents.replaceChildren();
    if (!state.composer.always.length) dom.alwaysComponents.appendChild(emptyComposerNote("No always-received components."));
    state.composer.always.forEach(function (item, index) { dom.alwaysComponents.appendChild(createComponentRow(item, "always", -1, index)); });

    dom.alternativeList.replaceChildren();
    state.composer.options.forEach(function (branch, branchIndex) {
      var card = document.createElement("section");
      card.className = "alternative-card";
      card.dataset.branchIndex = String(branchIndex);
      var heading = document.createElement("div");
      heading.className = "alternative-card__heading";
      var label = document.createElement("b");
      label.textContent = "Option " + (branchIndex + 1);
      var actions = document.createElement("span");
      actions.append(
        makeButton("mini-icon", "↑", "Move option up", "branch-up"),
        makeButton("mini-icon", "↓", "Move option down", "branch-down"),
        makeButton("mini-icon mini-icon--remove", "×", "Remove option", "branch-remove")
      );
      actions.children[0].disabled = branchIndex === 0;
      actions.children[1].disabled = branchIndex === state.composer.options.length - 1;
      heading.append(label, actions);
      card.appendChild(heading);
      if (!branch.length) card.appendChild(emptyComposerNote("Add a component to this option."));
      branch.forEach(function (item, itemIndex) { card.appendChild(createComponentRow(item, "option", branchIndex, itemIndex)); });
      dom.alternativeList.appendChild(card);
    });
    if (!state.composer.options.length) dom.alternativeList.appendChild(emptyComposerNote("No alternatives. Add two or more to create an OR choice."));

    dom.componentTarget.replaceChildren();
    var alwaysOption = document.createElement("option");
    alwaysOption.value = "always";
    alwaysOption.textContent = "Always receive";
    dom.componentTarget.appendChild(alwaysOption);
    state.composer.options.forEach(function (_branch, index) {
      var option = document.createElement("option");
      option.value = "option:" + index;
      option.textContent = "Option " + (index + 1);
      dom.componentTarget.appendChild(option);
    });

    var reward = composerReward();
    dom.composerPreview.textContent = reward.always.length || reward.options.length ? rewardDescription(reward) : "Add a component to begin.";
    var validation = composerValidationMessage();
    dom.composerValidation.textContent = validation;
    dom.composerSubmit.disabled = Boolean(validation);
    dom.composerSubmit.textContent = state.editingEntryId ? "Update wheel entry" : "Add entry to wheel";
  }

  function emptyComposerNote(text) {
    var note = document.createElement("p");
    note.className = "composer-empty";
    note.textContent = text;
    return note;
  }

  function resetComposer(close) {
    state.composer = { always: [], options: [] };
    state.editingEntryId = null;
    dom.componentCustomText.value = "";
    renderComposer();
    if (close) {
      dom.composer.hidden = true;
      dom.composerToggle.setAttribute("aria-expanded", "false");
    }
  }

  function openComposer(entry) {
    if (entry) {
      state.composer = deepClone(entry.reward);
      state.editingEntryId = entry.id;
    } else if (dom.composer.hidden) {
      state.editingEntryId = null;
    }
    dom.composer.hidden = false;
    dom.composerToggle.setAttribute("aria-expanded", "true");
    renderComposer();
    dom.componentType.focus();
  }

  function renderAll() {
    renderWheel(state.entries, null, 0);
    renderSliceList();
    renderPresetList();
    syncControls();
    renderComposer();
  }

  function commitChange(message) {
    persistState();
    renderAll();
    if (message) setStatus(message);
  }

  function addEntry(entry) {
    if (state.entries.length >= MAX_ENTRIES) {
      setStatus("The wheel is limited to " + MAX_ENTRIES + " entries.", "warning");
      return false;
    }
    state.entries.push(entry);
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
    dom.sphealRotator.style.transform = "rotate(" + value + "deg)";
  }

  function triggerSphealFeedback(strength) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var visualStrength = Math.max(0.12, Math.min(1, strength));
    if (typeof dom.sphealReactor.animate === "function") {
      dom.sphealReactor.getAnimations().forEach(function (animation) { animation.cancel(); });
      dom.sphealReactor.animate([
        { transform: "scale(1, 1)" },
        { transform: "scale(" + (1 + 0.16 * visualStrength) + ", " + (1 - 0.28 * visualStrength) + ")", offset: 0.34 },
        { transform: "scale(" + (1 - 0.05 * visualStrength) + ", " + (1 + 0.1 * visualStrength) + ")", offset: 0.7 },
        { transform: "scale(1, 1)" }
      ], { duration: 270 + 150 * visualStrength, easing: "cubic-bezier(.2,.9,.3,1)" });
    }
    if (typeof dom.sphealPulse.animate === "function") {
      dom.sphealPulse.getAnimations().forEach(function (animation) { animation.cancel(); });
      dom.sphealPulse.animate([
        { opacity: 0.25 + 0.65 * visualStrength, transform: "scale(.92)" },
        { opacity: 0, transform: "scale(" + (1.12 + 0.38 * visualStrength) + ")" }
      ], { duration: 300 + 260 * visualStrength, easing: "ease-out" });
    }
  }

  function boostSpin() {
    if (state.phase !== "spinning" || !state.spinMotion) return;
    var motion = state.spinMotion;
    var now = performance.now();
    var quietTime = Math.max(0, now - motion.lastBoostAt);
    motion.reserve = 1 - (1 - motion.reserve) * Math.exp(-quietTime / BOOST_RECOVERY_MS);
    var strength = motion.reserve;
    motion.reserve *= 1 - BOOST_RESERVE_COST;
    motion.lastBoostAt = now;

    var available = Math.max(0, motion.maximumDeadline - motion.coastDeadline);
    var fullWindow = MAX_COAST_DURATION - BASE_COAST_DURATION;
    var ceilingScale = fullWindow ? available / fullWindow : 0;
    var extension = BOOST_EXTENSION_MS * strength * ceilingScale;
    motion.coastDeadline = Math.min(motion.maximumDeadline, motion.coastDeadline + extension);
    motion.velocity = Math.min(1.85, motion.velocity + 0.5 * strength);
    triggerSphealFeedback(strength);
    emitSoundEvent("spinBoost", { strength: strength, addedDuration: extension });
  }

  function runMomentumCoast(sliceAngle) {
    return new Promise(function (resolve) {
      var startedAt = performance.now();
      var motion = {
        coastDeadline: startedAt + BASE_COAST_DURATION,
        maximumDeadline: startedAt + MAX_COAST_DURATION,
        lastFrameAt: startedAt,
        lastBoostAt: startedAt,
        reserve: 1,
        velocity: 1.28,
        lastTick: Math.floor(state.rotation / sliceAngle)
      };
      state.spinMotion = motion;

      function frame(now) {
        var elapsed = Math.min(40, Math.max(0, now - motion.lastFrameAt));
        motion.lastFrameAt = now;
        motion.velocity = Math.max(0.16, motion.velocity * Math.exp(-elapsed / 3200));
        setRotation(state.rotation + motion.velocity * elapsed);

        var currentTick = Math.floor(state.rotation / sliceAngle);
        if (currentTick !== motion.lastTick) {
          motion.lastTick = currentTick;
          tickPointer();
          emitSoundEvent("pointerTick", { rotation: state.rotation });
        }

        if (now < motion.coastDeadline) {
          window.requestAnimationFrame(frame);
        } else {
          state.spinMotion = null;
          resolve();
        }
      }

      window.requestAnimationFrame(frame);
    });
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

  function htmlComponent(item, size) {
    var wrapper = document.createElement("span");
    wrapper.className = "reward-token reward-token--" + (size || "result");
    var amount = document.createElement("b");
    amount.textContent = String(item.amount);
    wrapper.appendChild(amount);
    if (item.type === "custom") {
      var custom = document.createElement("span");
      custom.textContent = item.text;
      wrapper.appendChild(custom);
    } else {
      var definition = REWARDS[item.type];
      var image = document.createElement("img");
      image.src = definition.image;
      image.alt = "";
      image.className = "reward-token__image reward-token__image--" + (definition.crop || item.type);
      var words = document.createElement("span");
      words.textContent = item.amount === 1 ? definition.singular : definition.plural;
      wrapper.append(image, words);
    }
    wrapper.setAttribute("aria-label", componentWords(item, false));
    return wrapper;
  }

  function appendHtmlBranch(container, branch, size) {
    sortedComponents(branch).forEach(function (item, index) {
      if (index) {
        var plus = document.createElement("span");
        plus.className = "reward-plus";
        plus.textContent = "+";
        container.appendChild(plus);
      }
      container.appendChild(htmlComponent(item, size));
    });
  }

  function renderResultCard(entry) {
    dom.resultPrimary.replaceChildren();
    dom.resultAlternatives.replaceChildren();
    dom.resultCard.setAttribute("aria-label", "Selected: " + entryLabel(entry));
    if (entry.kind !== "structured") {
      var legacy = document.createElement("strong");
      legacy.className = "result-card__legacy";
      legacy.textContent = entry.label;
      dom.resultPrimary.appendChild(legacy);
    } else {
      appendHtmlBranch(dom.resultPrimary, primaryComponents(entry.reward), "result");
      var primaryIndex = primaryOptionIndex(entry.reward);
      (entry.reward.options || []).forEach(function (branch, index) {
        if (index === primaryIndex) return;
        var line = document.createElement("p");
        line.className = "result-alternative";
        var prefix = document.createElement("span");
        prefix.textContent = "Alternative: Craft ";
        line.appendChild(prefix);
        appendHtmlBranch(line, branch, "alternative");
        if (primaryIndex >= 0) {
          var instead = document.createElement("span");
          instead.textContent = " instead of ";
          line.appendChild(instead);
          appendHtmlBranch(line, entry.reward.options[primaryIndex], "alternative");
        }
        line.appendChild(document.createTextNode("."));
        dom.resultAlternatives.appendChild(line);
      });
    }
    dom.resultCard.setAttribute("aria-hidden", "false");
  }

  async function startSpin() {
    if (state.phase !== "setup" || !state.entries.length) return;

    var snapshot = cloneEntries(state.entries, false);
    var forcedIndex = state.riggedEnabled
      ? snapshot.findIndex(function (entry) { return entry.id === state.riggedTargetId; })
      : -1;
    var winnerIndex = forcedIndex >= 0 ? forcedIndex : randomIndex(snapshot.length);
    var winner = snapshot[winnerIndex];
    var sliceAngle = 360 / snapshot.length;
    var winnerCenter = -90 + (winnerIndex + 0.5) * sliceAngle;
    var desiredRotation = normalizeAngle(-90 - winnerCenter);
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    state.phase = "spinning";
    state.spinSnapshot = snapshot;
    state.winnerIndex = winnerIndex;
    setCinematic(true);
    document.body.classList.add("is-spinning");
    dom.spinButton.disabled = false;
    dom.spinButton.setAttribute("aria-label", "Boost the spinning wheel");
    dom.spinButton.focus();
    renderWheel(snapshot, null, 0);
    emitSoundEvent("spinStart", { entryCount: snapshot.length, rigged: forcedIndex >= 0 });

    var finalRotation;
    if (reducedMotion) {
      finalRotation = state.rotation + normalizeAngle(desiredRotation - normalizeAngle(state.rotation));
      await delay(90);
      setRotation(finalRotation);
      await delay(130);
    } else {
      await runMomentumCoast(sliceAngle);
      state.phase = "landing";
      document.body.classList.remove("is-spinning");
      dom.spinButton.setAttribute("aria-label", "Wheel landing");
      var currentNormalized = normalizeAngle(state.rotation);
      var alignment = normalizeAngle(desiredRotation - currentNormalized);
      finalRotation = state.rotation + alignment;
      await animateValue(
        state.rotation,
        finalRotation,
        SETTLE_DURATION,
        easeOutCubic,
        function (value) { setRotation(value); },
        sliceAngle
      );
    }

    state.phase = "landing";
    document.body.classList.remove("is-spinning");
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
    renderResultCard(winner);
    clearRigging();
    state.phase = "result";
    document.body.classList.add("is-result");
    dom.spinButton.setAttribute("aria-label", "Dismiss result");
    dom.resultAnnouncement.textContent = "Selected: " + entryLabel(winner) + ". Click anywhere or press any key to return to setup.";
  }

  function exitResult() {
    if (state.phase !== "result") return;
    var winner = state.spinSnapshot && state.spinSnapshot[state.winnerIndex];
    state.phase = "setup";
    state.rotation = 0;
    state.spinSnapshot = null;
    state.winnerIndex = -1;
    state.spinMotion = null;
    document.body.classList.remove("is-result", "has-winner", "is-spinning");
    document.body.style.removeProperty("--winner-glow");
    setCinematic(false);
    renderWheel(state.entries, null, 0);
    syncControls();
    dom.spinButton.setAttribute("aria-label", "Spin the wheel");
    dom.resultAnnouncement.textContent = "";
    dom.resultCard.setAttribute("aria-hidden", "true");
    emitSoundEvent("exitResult", { entry: winner ? cloneEntries([winner], false)[0] : null });
    setStatus("Returned to setup. Your wheel is unchanged.");
    window.requestAnimationFrame(function () { dom.spinButton.focus(); });
  }

  Object.keys(REWARDS).filter(function (key) { return key !== "custom"; }).forEach(function (key) {
    var option = document.createElement("option");
    option.value = key;
    option.textContent = REWARDS[key].label;
    dom.componentType.appendChild(option);
  });
  var customTypeOption = document.createElement("option");
  customTypeOption.value = "custom";
  customTypeOption.textContent = REWARDS.custom.label;
  dom.componentType.appendChild(customTypeOption);

  document.querySelectorAll("[data-reward]").forEach(function (button) {
    button.addEventListener("click", function () {
      var type = button.dataset.reward;
      var entry = structuredEntry([component(type, state.quantity)], []);
      if (addEntry(entry)) {
        commitChange(entryLabel(entry) + " added as one wheel entry.");
      }
    });
  });

  dom.sharedQuantity.addEventListener("input", function () {
    var quantity = Number(dom.sharedQuantity.value);
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_ENTRIES) {
      state.quantity = quantity;
      persistState();
      syncControls();
    }
  });

  dom.sharedQuantity.addEventListener("change", function () {
    var quantity = Number(dom.sharedQuantity.value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ENTRIES) {
      state.quantity = 1;
      setStatus("Quantity reset to 1. Use a whole number from 1 to " + MAX_ENTRIES + ".", "warning");
      persistState();
      syncControls();
    }
  });

  dom.customForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var label = cleanText(dom.customLabel.value, MAX_LABEL_LENGTH);
    if (!label) {
      setStatus("Enter a custom label first.", "warning");
      dom.customLabel.focus();
      return;
    }
    if (!addEntry({ id: createId("entry"), kind: "custom", label: label, presetKind: null })) return;
    dom.customLabel.value = "";
    commitChange(label + " added as one wheel entry.");
    dom.customLabel.focus();
  });

  dom.composerToggle.addEventListener("click", function () {
    if (dom.composer.hidden) openComposer(null);
    else resetComposer(true);
  });
  dom.composerClose.addEventListener("click", function () { resetComposer(true); });
  dom.composerReset.addEventListener("click", function () { resetComposer(false); });
  dom.componentType.addEventListener("change", function () {
    dom.componentCustomField.hidden = dom.componentType.value !== "custom";
    if (!dom.componentCustomField.hidden) dom.componentCustomText.focus();
  });
  dom.addAlternative.addEventListener("click", function () {
    state.composer.options.push([]);
    renderComposer();
    dom.componentTarget.value = "option:" + (state.composer.options.length - 1);
  });
  dom.componentAdd.addEventListener("click", function () {
    var type = dom.componentType.value;
    var text = type === "custom" ? cleanText(dom.componentCustomText.value, MAX_LABEL_LENGTH) : "";
    if (type === "custom" && !text) {
      setStatus("Enter custom component text first.", "warning");
      dom.componentCustomText.focus();
      return;
    }
    var item = component(type, state.quantity, text);
    if (dom.componentTarget.value === "always") state.composer.always.push(item);
    else {
      var branchIndex = Number(dom.componentTarget.value.split(":")[1]);
      if (state.composer.options[branchIndex]) state.composer.options[branchIndex].push(item);
    }
    if (type === "custom") dom.componentCustomText.value = "";
    renderComposer();
  });

  dom.composer.addEventListener("input", function (event) {
    var row = event.target.closest(".component-row");
    if (!row || !event.target.dataset.field) return;
    var source = row.dataset.zone === "always" ? state.composer.always : state.composer.options[Number(row.dataset.branchIndex)];
    var item = source && source[Number(row.dataset.itemIndex)];
    if (!item) return;
    if (event.target.dataset.field === "amount") {
      var amount = Number(event.target.value);
      if (Number.isInteger(amount) && amount >= 1 && amount <= 999) item.amount = amount;
    } else if (event.target.dataset.field === "text") {
      item.text = cleanText(event.target.value, MAX_LABEL_LENGTH);
    }
    var reward = composerReward();
    dom.composerPreview.textContent = rewardDescription(reward) || "Add a component to begin.";
    var validation = composerValidationMessage();
    dom.composerValidation.textContent = validation;
    dom.composerSubmit.disabled = Boolean(validation);
  });

  dom.composer.addEventListener("change", function (event) {
    var row = event.target.closest(".component-row");
    if (!row || event.target.dataset.field !== "type") return;
    var source = row.dataset.zone === "always" ? state.composer.always : state.composer.options[Number(row.dataset.branchIndex)];
    var item = source && source[Number(row.dataset.itemIndex)];
    if (!item) return;
    item.type = event.target.value;
    if (item.type === "custom" && !item.text) item.text = "Custom reward";
    else if (item.type !== "custom") delete item.text;
    renderComposer();
  });

  dom.composer.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.dataset.action;
    var branchCard = button.closest(".alternative-card");
    if (action.indexOf("branch-") === 0 && branchCard) {
      var branchIndex = Number(branchCard.dataset.branchIndex);
      if (action === "branch-remove") state.composer.options.splice(branchIndex, 1);
      else {
        var branchTarget = action === "branch-up" ? branchIndex - 1 : branchIndex + 1;
        if (branchTarget >= 0 && branchTarget < state.composer.options.length) {
          var branch = state.composer.options.splice(branchIndex, 1)[0];
          state.composer.options.splice(branchTarget, 0, branch);
        }
      }
      renderComposer();
      return;
    }
    var row = button.closest(".component-row");
    if (!row || action.indexOf("component-") !== 0) return;
    var source = row.dataset.zone === "always" ? state.composer.always : state.composer.options[Number(row.dataset.branchIndex)];
    var index = Number(row.dataset.itemIndex);
    if (action === "component-remove") source.splice(index, 1);
    else {
      var target = action === "component-up" ? index - 1 : index + 1;
      if (target >= 0 && target < source.length) {
        var item = source.splice(index, 1)[0];
        source.splice(target, 0, item);
      }
    }
    renderComposer();
  });

  dom.composerSubmit.addEventListener("click", function () {
    var validation = composerValidationMessage();
    if (validation) {
      dom.composerValidation.textContent = validation;
      return;
    }
    var reward = composerReward();
    if (state.editingEntryId) {
      var index = state.entries.findIndex(function (entry) { return entry.id === state.editingEntryId; });
      if (index >= 0) state.entries[index] = { id: state.editingEntryId, kind: "structured", reward: reward };
      commitChange("Structured entry updated.");
    } else {
      var entry = structuredEntry(reward.always, reward.options);
      if (!addEntry(entry)) return;
      commitChange(entryLabel(entry) + " added as one wheel entry.");
    }
    resetComposer(true);
  });

  dom.riggedWinner.addEventListener("change", function () {
    state.riggedTargetId = dom.riggedWinner.value || null;
    if (!state.riggedTargetId) state.riggedEnabled = false;
    renderSliceList();
    syncControls();
  });

  dom.riggedToggle.addEventListener("change", function () {
    state.riggedEnabled = dom.riggedToggle.checked && Boolean(state.riggedTargetId);
    syncControls();
    setStatus(state.riggedEnabled ? "Rigged target enabled for the next spin." : "Rigged mode disabled.");
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

    if (action === "edit" && entry.kind === "structured") {
      openComposer(entry);
      return;
    }

    if (action === "remove") {
      state.entries.splice(index, 1);
      if (entry.id === state.riggedTargetId) clearRigging();
      commitChange(entryLabel(entry) + " removed.");
      var next = state.entries[Math.min(index, state.entries.length - 1)];
      if (next) focusRowAction(next.id, "remove");
      else dom.customLabel.focus();
      return;
    }

    var targetIndex = action === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.entries.length) return;
    state.entries.splice(index, 1);
    state.entries.splice(targetIndex, 0, entry);
    commitChange(entryLabel(entry) + " moved " + action + ".");
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
      clearRigging();
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

  dom.spinButton.addEventListener("click", function () {
    if (state.phase === "spinning") boostSpin();
    else startSpin();
  });
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
      if (state.phase === "spinning" && event.target === dom.spinButton && !event.repeat && (event.key === " " || event.key === "Enter")) {
        boostSpin();
      }
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

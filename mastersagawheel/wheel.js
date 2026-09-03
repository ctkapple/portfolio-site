(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var STORAGE_KEY = "selection-wheel:v1";
  var STORAGE_VERSION = 5;
  var DEFAULT_SEED_VERSION = 2;
  var MAX_ENTRIES = 60;
  var MAX_LABEL_LENGTH = 48;
  var REVEAL_DURATION = 620;
  // The spin is one continuous exponential decay from SPIN_VELOCITY to a stop, aimed at an
  // exact target angle from the first frame — see runSpinMotion. It always arrives already
  // slow, so there is never a separate "settle" tween that could snap or speed up at the end.
  var SPIN_VELOCITY = 5.6;       // deg/ms initial angular speed for a fresh, unboosted spin
  var SPIN_STOP_RATIO = 0.0006;  // motion is considered landed once velocity decays to this fraction of its start
  var BASE_EXTRA_TURNS = 8;      // full extra rotations for an unboosted spin (~4s to land)
  var MAX_SPIN_MS = 30000;       // hard ceiling on total spin time, however much boosting occurs
  var BOOST_TAPER_MS = 5000;     // boosts fade out over this final stretch of the time budget, so even
                                  // sustained rapid-clicking always decays into a smooth stop, not a cutoff
  var BOOST_TURNS = 3.5;         // full extra rotations added per full-strength boost click
  var BOOST_RECOVERY_MS = 1500;
  var BOOST_RESERVE_COST = 0.45;

  var REWARDS = {
    ur: { label: "UR", singular: "UR", plural: "UR", image: "UR_Craft_Asset.png", color: "#bd4fe2", precedence: 90 },
    gems: { label: "Gems", singular: "Gem", plural: "Gems", image: "Master_Duel_Gem.png", color: "#766cff", precedence: 85 },
    packs: { label: "Secret Packs", singular: "Secret Pack", plural: "Secret Packs", shortSingular: "Pack", shortPlural: "Packs", image: "The_Masters_Saga-Pack-Master_Duel.png", color: "#dfa735", precedence: 80, crop: "pack" },
    bans: { label: "Bans", singular: "Ban", plural: "Bans", image: "pot-of-greed-2.avif", color: "#dd453e", precedence: 70, crop: "pot" },
    sr: { label: "SR", singular: "SR", plural: "SR", image: "SR_Craft_asset.png", color: "#e6bc3f", precedence: 60 },
    r: { label: "R", singular: "R", plural: "R", image: "R_Craft_asset.png", color: "#31bde8", precedence: 50 },
    n: { label: "N", singular: "N", plural: "N", image: "N_Craft_asset.png", color: "#aeb8c5", precedence: 40 },
    nr: { label: "N/R", singular: "N/R", plural: "N/R", image: "N_R_Craft_asset.png", color: "#6da8c4", precedence: 30 },
    custom: { label: "Custom text", singular: "", plural: "", image: null, color: "#a5afc0", precedence: 0 }
  };
  // Reward-tier color families: background comes from an entry's highest-tier reward,
  // text from its next-highest. Packs and N/R are nudged off SR-gold and R-blue so two
  // different reward types never read as the same slice color.
  var COLOR_FAMILIES = {
    ur: "#bd4fe2",
    gems: "#766cff",
    packs: "#d9781f",
    bans: "#dd453e",
    sr: "#e6bc3f",
    r: "#31bde8",
    n: "#aeb8c5",
    nr: "#7a95a3",
    custom: "#a5afc0"
  };
  var TEXT_ACCENTS = {
    ur: "#e9a6ff",
    gems: "#b3aeff",
    packs: "#ffb15c",
    bans: "#ff8f86",
    sr: "#ffe27a",
    r: "#7fe0ff",
    n: "#d7dee8",
    nr: "#a9c3cc",
    custom: "#d8d2c9"
  };
  var SHADE_RAMP = [
    { toward: "#000000", amount: .42 }, // deep
    { toward: "#000000", amount: .15 }, // medium
    { toward: "#ffffff", amount: .22 }, // light
    { toward: "#6b7280", amount: .45 }  // muted
  ];
  var GENERIC_ICON_KEYS = ["condemned", "eldlich", "genex"];
  var PRESET_THEMES = {
    winner: { image: "Winner_Icon.png", primary: "#f3c758", secondary: "#d87538", deep: "#422716" },
    oneOne: { image: "1-1 icon.png", primary: "#72dfff", secondary: "#5587c8", deep: "#132d43" },
    farfa: { image: "Farfa_Icon.jpg", primary: "#bc54e6", secondary: "#e29a48", deep: "#3a174f" },
    condemned: { image: "Condemned_Darklord-Icon-Master_Duel.png", primary: "#ee729a", secondary: "#b8324d", deep: "#3b1728" },
    eldlich: { image: "Eldlich_the_Golden_Lord-Icon-Master_Duel.png", primary: "#edbd43", secondary: "#7442a8", deep: "#34230f" },
    genex: { image: "Genex_Controller-Icon-Master_Duel.png", primary: "#64c996", secondary: "#66527e", deep: "#17201e" }
  };
  var BUILTIN_PRESETS = {
    winner: { rank: 0, name: "Winner's Wheel", iconKey: "winner" },
    oneOne: { rank: 1, name: "1-1 Wheel", iconKey: "oneOne" },
    farfa: { rank: 2, name: "Farfa Wheel", iconKey: "farfa" }
  };

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
    newWheelButton: document.getElementById("new-wheel-button"),
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
    composerSubmit: document.getElementById("composer-submit"),
    composerSimple: document.getElementById("composer-simple"),
    composerSimpleCustom: document.getElementById("composer-simple-custom"),
    composerSimpleCustomAdd: document.getElementById("composer-simple-custom-add"),
    composerSimpleNote: document.getElementById("composer-simple-note"),
    simpleExpression: document.getElementById("simple-expression"),
    composerAdvanced: document.getElementById("composer-advanced"),
    wheelIdentityIcon: document.getElementById("wheel-identity-icon"),
    wheelIdentityName: document.getElementById("wheel-identity-name")
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
    simpleComposer: { tokens: [], relations: [null, null] },
    editingEntryId: null,
    draftIdentity: { presetId: null, name: "Custom Wheel", iconKey: "genex" }
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

      var colorFamily = typeof rawEntry.colorFamily === "string" && COLOR_FAMILIES[rawEntry.colorFamily] ? rawEntry.colorFamily : null;
      var colorShade = Number(rawEntry.colorShade);
      var visualSignature = typeof rawEntry.visualSignature === "string" ? rawEntry.visualSignature : null;
      var entry = reward
        ? { id: id, kind: "structured", reward: reward }
        : { id: id, kind: "custom", label: label, presetKind: typeof rawEntry.presetKind === "string" ? rawEntry.presetKind : null };
      if (colorFamily) entry.colorFamily = colorFamily;
      if (Number.isInteger(colorShade) && colorShade >= 0 && colorShade < 240) entry.colorShade = colorShade;
      if (visualSignature) entry.visualSignature = visualSignature;
      entries.push(entry);
    });

    return entries;
  }

  function validIconKey(value) {
    return typeof value === "string" && Boolean(PRESET_THEMES[value]) ? value : null;
  }

  function builtinKeyForName(name) {
    var normalized = normalizeName(name);
    return Object.keys(BUILTIN_PRESETS).find(function (key) {
      return normalizeName(BUILTIN_PRESETS[key].name) === normalized;
    }) || null;
  }

  function genericIconForId(id) {
    return GENERIC_ICON_KEYS[hashString(id || "custom") % GENERIC_ICON_KEYS.length];
  }

  function presetIconKey(preset) {
    if (preset && preset.builtinKey && BUILTIN_PRESETS[preset.builtinKey]) return BUILTIN_PRESETS[preset.builtinKey].iconKey;
    return validIconKey(preset && preset.iconKey) || genericIconForId(preset && preset.id);
  }

  function sanitizeDraftIdentity(raw, presets) {
    var presetId = raw && typeof raw.presetId === "string" ? raw.presetId : null;
    var matchingPreset = presetId && presets.find(function (preset) { return preset.id === presetId; });
    if (matchingPreset) {
      return { presetId: matchingPreset.id, name: matchingPreset.name, iconKey: presetIconKey(matchingPreset) };
    }
    return {
      presetId: null,
      name: cleanText(raw && raw.name, MAX_LABEL_LENGTH) || "Custom Wheel",
      iconKey: validIconKey(raw && raw.iconKey) || "genex"
    };
  }

  function hydrateState() {
    if (!state.storageEnabled) {
      initialNotice = "Browser storage is unavailable. Changes will last for this session only.";
      seedDefaultPresets(0);
      ensureAllVisualAssignments();
      return;
    }

    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        seedDefaultPresets(0);
        ensureAllVisualAssignments();
        persistState();
        return;
      }
      var envelope = JSON.parse(raw);
      if (!envelope || [1, 2, 3, 4, STORAGE_VERSION].indexOf(envelope.version) < 0) {
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
          var builtinKey = typeof rawPreset.builtinKey === "string" && BUILTIN_PRESETS[rawPreset.builtinKey]
            ? rawPreset.builtinKey
            : builtinKeyForName(name);
          presets.push({
            id: presetId,
            name: name,
            entries: sanitizeEntries(rawPreset.entries),
            updatedAt: typeof rawPreset.updatedAt === "number" ? rawPreset.updatedAt : Date.now(),
            builtinKey: builtinKey,
            iconKey: builtinKey ? BUILTIN_PRESETS[builtinKey].iconKey : (validIconKey(rawPreset.iconKey) || genericIconForId(presetId))
          });
          return presets;
        }, []);
      }
      seedDefaultPresets(Number(envelope.defaultSeedVersion) || 0);
      state.draftIdentity = sanitizeDraftIdentity(envelope.draft && envelope.draft.identity, state.presets);
      ensureAllVisualAssignments();
      persistState();
    } catch (error) {
      state.entries = [];
      state.presets = [];
      seedDefaultPresets(0);
      ensureAllVisualAssignments();
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
        quantity: state.quantity,
        identity: deepClone(state.draftIdentity)
      },
      presets: state.presets.map(function (preset) {
        return {
          id: preset.id,
          name: preset.name,
          entries: cloneEntries(preset.entries, false),
          updatedAt: preset.updatedAt,
          builtinKey: preset.builtinKey || null,
          iconKey: presetIconKey(preset)
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

  // Full display sequence for a reward: every always-component and every OR branch,
  // in original order, with "and"/"or" separators marking how they combine. Used
  // wherever the wheel must show the complete recipe instead of just the best outcome.
  function entryDisplayTokens(reward) {
    var tokens = [];
    var always = sortedComponents(reward.always || []);
    var options = (reward.options || []).map(sortedComponents);
    always.forEach(function (item, index) {
      if (index) tokens.push({ kind: "and" });
      tokens.push({ kind: "item", item: item });
    });
    options.forEach(function (branch, branchIndex) {
      if (branchIndex === 0) {
        if (always.length) tokens.push({ kind: "and" });
      } else {
        tokens.push({ kind: "or" });
      }
      branch.forEach(function (item, itemIndex) {
        if (itemIndex) tokens.push({ kind: "and" });
        tokens.push({ kind: "item", item: item });
      });
    });
    return tokens;
  }

  function entryDisplayItemCount(reward) {
    var count = (reward.always || []).length;
    (reward.options || []).forEach(function (branch) { count += branch.length; });
    return count;
  }

  function presetEntry(always, options) {
    return structuredEntry(always, options);
  }

  function defaultPresets() {
    var srNr = function (sr, nr) { return presetEntry([], [[component("sr", sr)], [component("nr", nr)]]); };
    var urSrNr = function (ur, sr, nr) { return presetEntry([], [[component("ur", ur)], [component("sr", sr)], [component("nr", nr)]]); };
    var farfaPack = function () { return presetEntry([component("packs", 5)], [[component("sr", 1)], [component("nr", 3)]]); };
    return [
      { builtinKey: "winner", name: "Winner's Wheel", entries: [srNr(1, 3), urSrNr(1, 1, 3), srNr(1, 3), srNr(2, 3), srNr(1, 3), urSrNr(1, 1, 3)] },
      { builtinKey: "oneOne", name: "1-1 Wheel", entries: [srNr(1, 2), srNr(1, 3), srNr(2, 4), srNr(1, 2), srNr(1, 3), srNr(2, 4)] },
      { builtinKey: "farfa", name: "Farfa Wheel", entries: [
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
      var existing = state.presets.find(function (preset) { return preset.builtinKey === approved.builtinKey; }) || findPresetByName(approved.name);
      if (existing) {
        // Add stable identity metadata without replacing a user's edited built-in contents or name.
        existing.builtinKey = approved.builtinKey;
        existing.iconKey = BUILTIN_PRESETS[approved.builtinKey].iconKey;
      } else {
        state.presets.push({
          id: createId("preset"),
          name: approved.name,
          entries: approved.entries,
          updatedAt: Date.now(),
          builtinKey: approved.builtinKey,
          iconKey: BUILTIN_PRESETS[approved.builtinKey].iconKey
        });
      }
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

  function isDraftDirty() {
    if (!state.draftIdentity.presetId) return state.entries.length > 0;
    var preset = state.presets.find(function (candidate) { return candidate.id === state.draftIdentity.presetId; });
    if (!preset) return state.entries.length > 0;
    return JSON.stringify(state.entries) !== JSON.stringify(preset.entries);
  }

  var newWheelCounter = 0;

  function nextNewWheelName() {
    var name = newWheelCounter === 0 ? "Custom Wheel" : "Custom Wheel " + newWheelCounter;
    newWheelCounter += 1;
    return name;
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

  function componentSignature(item) {
    return item.type + ":" + item.amount + (item.type === "custom" ? ":" + normalizeName(cleanText(item.text, MAX_LABEL_LENGTH)) : "");
  }

  function branchSignature(branch) {
    return branch.map(componentSignature).sort().join("+");
  }

  function entrySignature(entry) {
    if (entry.kind !== "structured") return "custom|" + normalizeName(cleanText(entry.label, MAX_LABEL_LENGTH));
    var always = (entry.reward.always || []).map(componentSignature).sort().join("+");
    var options = (entry.reward.options || []).map(branchSignature).sort().join("|");
    return "structured|always:" + always + "|options:" + options;
  }

  function mixHex(first, second, amount) {
    var left = parseInt(first.slice(1), 16);
    var right = parseInt(second.slice(1), 16);
    var channels = [16, 8, 0].map(function (shift) {
      var value = Math.round(((left >> shift) & 255) * (1 - amount) + ((right >> shift) & 255) * amount);
      return value.toString(16).padStart(2, "0");
    });
    return "#" + channels.join("");
  }

  function componentVisualColors(item) {
    if (item.type === "nr") {
      return [
        { color: COLOR_FAMILIES.r, weight: 1 },
        { color: COLOR_FAMILIES.n, weight: 1 }
      ];
    }
    return [{ color: COLOR_FAMILIES[item.type] || COLOR_FAMILIES.custom, weight: 1 }];
  }

  // The distinct reward types an entry displays, in the same highest-to-lowest precedence
  // order as its icons (always + the best-precedence option branch), deduplicated.
  function entryTopTypes(entry) {
    if (entry.kind !== "structured") return [];
    var seen = [];
    primaryComponents(entry.reward).forEach(function (item) {
      if (seen.indexOf(item.type) < 0) seen.push(item.type);
    });
    return seen;
  }

  function entryColorFamily(entry) {
    var types = entryTopTypes(entry);
    return types.length && COLOR_FAMILIES[types[0]] ? types[0] : "custom";
  }

  function entryTextFamily(entry) {
    var types = entryTopTypes(entry);
    return types.length > 1 && COLOR_FAMILIES[types[1]] ? types[1] : null;
  }

  function familyShadeColor(anchor, index) {
    var cycle = ((index % SHADE_RAMP.length) + SHADE_RAMP.length) % SHADE_RAMP.length;
    var lap = Math.floor(index / SHADE_RAMP.length);
    var step = SHADE_RAMP[cycle];
    var color = mixHex(anchor, step.toward, step.amount);
    if (lap > 0) {
      // Rare case: more unique recipes share a family than the ramp has steps.
      // Nudge further along the same axis each extra lap so they stay distinguishable.
      var counter = step.toward === "#ffffff" ? "#000000" : "#ffffff";
      color = mixHex(color, counter, Math.min(.35, .09 * lap));
    }
    return color;
  }

  function ensureVisualAssignments(entries) {
    var groups = [];
    var bySignature = new Map();
    entries.forEach(function (entry) {
      var signature = entrySignature(entry);
      if (!bySignature.has(signature)) {
        var group = { signature: signature, family: entryColorFamily(entry), entries: [] };
        bySignature.set(signature, group);
        groups.push(group);
      }
      bySignature.get(signature).entries.push(entry);
    });

    var usedShadesByFamily = new Map();
    groups.forEach(function (group) {
      var used = usedShadesByFamily.get(group.family);
      if (!used) {
        used = new Set();
        usedShadesByFamily.set(group.family, used);
      }
      var retained = group.entries.find(function (entry) {
        return entry.visualSignature === group.signature && entry.colorFamily === group.family
          && Number.isInteger(entry.colorShade) && entry.colorShade >= 0 && !used.has(entry.colorShade);
      });
      var shade = retained ? retained.colorShade : -1;
      if (shade < 0) {
        for (var candidate = 0; candidate < 240; candidate += 1) {
          if (!used.has(candidate)) {
            shade = candidate;
            break;
          }
        }
      }
      if (shade < 0) shade = hashString(group.signature) % 240;
      used.add(shade);
      group.entries.forEach(function (entry) {
        entry.colorFamily = group.family;
        entry.colorShade = shade;
        entry.visualSignature = group.signature;
      });
    });
  }

  function ensureAllVisualAssignments() {
    var allEntries = state.entries.slice();
    state.presets.forEach(function (preset) { allEntries = allEntries.concat(preset.entries); });
    // One shared pass keeps identical content visually identical across the draft and every saved wheel.
    ensureVisualAssignments(allEntries);
  }

  function entryVisual(entry) {
    var signature = entrySignature(entry);
    var retained = entry.visualSignature === signature && COLOR_FAMILIES[entry.colorFamily]
      && Number.isInteger(entry.colorShade) && entry.colorShade >= 0;
    var family = retained ? entry.colorFamily : entryColorFamily(entry);
    var shade = retained ? entry.colorShade : hashString(signature) % SHADE_RAMP.length;
    var anchor = COLOR_FAMILIES[family] || COLOR_FAMILIES.custom;
    var base = familyShadeColor(anchor, shade);
    var textFamily = entryTextFamily(entry);
    var textColor = textFamily ? (TEXT_ACCENTS[textFamily] || "#ffffff") : "#ffffff";
    var baseStops = [
      { offset: 0, color: mixHex(base, "#ffffff", .06) },
      { offset: 58, color: base },
      { offset: 100, color: mixHex(base, "#000000", .12) }
    ];
    var baseCss = baseStops.map(function (stop) { return stop.color + " " + stop.offset + "%"; }).join(", ");
    return {
      signature: signature,
      family: family,
      shade: shade,
      base: base,
      textColor: textColor,
      angle: 135,
      stops: baseStops,
      css: "linear-gradient(135deg, " + baseCss + ")",
      accent: base
    };
  }

  function colorFor(entry) {
    return entryVisual(entry).base;
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

  function appendSvgShorthand(group, entry, position, rotation, count, expansion, sliceAngle, labelRadius) {
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

    var tokens = entryDisplayTokens(entry.reward);
    var itemCount = tokens.filter(function (token) { return token.kind === "item"; }).length;
    var scale = itemCount <= 2 ? 1 : itemCount === 3 ? 0.95 : itemCount === 4 ? 0.8 : itemCount === 5 ? 0.68 : 0.58;
    var iconSize = (count <= 8 ? 38 : count <= 18 ? 30 : count <= 36 ? 23 : 18) * scale;
    var fontSize = (count <= 8 ? 17 : count <= 18 ? 14 : count <= 36 ? 11 : 9) * scale;

    function tokenWidths(iconSize, fontSize) {
      // Zen Dots renders noticeably wider than the legacy sans stack (~1.5x on digits), so the
      // amount-digit-before-icon gap needs extra headroom or the two visually collide.
      return { pair: iconSize + fontSize * 2.1, iconOnly: iconSize * 1.15, and: fontSize * 1.25, or: fontSize * 1.7 };
    }
    // A quantity-1 icon has no amount digit next to it, so it only needs its own width, not the full pair width.
    function tokenWidth(token, w) {
      if (token.kind === "and") return w.and;
      if (token.kind === "or") return w.or;
      return (token.item.amount === 1 && token.item.type !== "custom") ? w.iconOnly : w.pair;
    }

    var w = tokenWidths(iconSize, fontSize);
    var totalWidth = tokens.reduce(function (sum, token) { return sum + tokenWidth(token, w); }, 0);

    // Clamp the whole shorthand to the wedge's actual chord width at its label radius so it
    // never bleeds into neighboring slices or past the rim, however many OR alternatives it lists.
    if (sliceAngle && labelRadius) {
      var wedgeChord = 2 * labelRadius * Math.sin((sliceAngle / 2) * Math.PI / 180) * 0.92;
      if (totalWidth > wedgeChord) {
        var fitScale = Math.max(0.45, wedgeChord / totalWidth);
        iconSize *= fitScale;
        fontSize *= fitScale;
        w = tokenWidths(iconSize, fontSize);
        totalWidth = tokens.reduce(function (sum, token) { return sum + tokenWidth(token, w); }, 0);
      }
    }

    var shorthand = svgElement("g", {
      class: "wheel-slice__shorthand wheel-slice__shorthand--" + itemCount,
      transform: "translate(" + position.x + " " + position.y + ") rotate(" + rotation + ") translate(" + (-totalWidth / 2) + " 0)"
    });
    var cursor = 0;
    tokens.forEach(function (token) {
      var width = tokenWidth(token, w);
      if (token.kind === "and") {
        var plus = svgElement("text", { class: "wheel-slice__plus", x: String(cursor + width / 2), y: "1", "font-size": String(fontSize), "text-anchor": "middle", "dominant-baseline": "middle" });
        plus.textContent = "+";
        shorthand.appendChild(plus);
        cursor += width;
        return;
      }
      if (token.kind === "or") {
        var or = svgElement("text", { class: "wheel-slice__or", x: String(cursor + width / 2), y: "1", "font-size": String(fontSize * 0.72), "text-anchor": "middle", "dominant-baseline": "middle" });
        or.textContent = "OR";
        shorthand.appendChild(or);
        cursor += width;
        return;
      }
      var item = token.item;
      var showAmount = item.amount !== 1;
      if (showAmount) {
        var amount = svgElement("text", { class: "wheel-slice__amount", x: String(cursor + fontSize * 0.62), y: "1", "font-size": String(fontSize), "text-anchor": "middle", "dominant-baseline": "middle" });
        amount.textContent = String(item.amount);
        shorthand.appendChild(amount);
      }
      if (item.type === "custom") {
        var custom = svgElement("text", { class: "wheel-slice__custom", x: String(cursor + (showAmount ? fontSize * 2.0 : fontSize * 0.3)), y: "1", "font-size": String(fontSize * 0.76), "dominant-baseline": "middle" });
        custom.textContent = abbreviatedLabel(item.text, count);
        shorthand.appendChild(custom);
      } else {
        var definition = REWARDS[item.type];
        var iconX = showAmount ? cursor + fontSize * 1.8 : cursor + (width - iconSize) / 2;
        shorthand.appendChild(svgElement("image", {
          class: "wheel-slice__icon wheel-slice__icon--" + (definition.crop || item.type),
          href: definition.image,
          x: String(iconX), y: String(-iconSize / 2), width: String(iconSize), height: String(iconSize),
          preserveAspectRatio: "xMidYMid slice"
        }));
      }
      cursor += width;
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

    var gradientDefinitions = svgElement("defs");
    dom.rotor.appendChild(gradientDefinitions);
    var sliceAngle = 360 / count;
    entries.forEach(function (entry, index) {
      var visual = entryVisual(entry);
      var gradientId = "entry-gradient-" + index;
      var gradient = svgElement("linearGradient", {
        id: gradientId,
        x1: "0%",
        y1: "0%",
        x2: "100%",
        y2: "100%",
        gradientTransform: "rotate(" + visual.angle + " .5 .5)"
      });
      visual.stops.forEach(function (stop) {
        gradient.appendChild(svgElement("stop", { offset: stop.offset + "%", "stop-color": stop.color }));
      });
      gradientDefinitions.appendChild(gradient);
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
      group.style.setProperty("--slice-text", visual.textColor);
      var title = svgElement("title");
      title.textContent = entryLabel(entry);
      group.appendChild(title);

      if (count === 1) {
        group.appendChild(svgElement("circle", {
          class: "wheel-slice__shape",
          cx: "300",
          cy: "300",
          r: String(radius),
          fill: "url(#" + gradientId + ")"
        }));
      } else {
        group.appendChild(svgElement("path", {
          class: "wheel-slice__shape",
          d: wedgePath(startAngle, endAngle, radius),
          fill: "url(#" + gradientId + ")"
        }));
      }

      var displayItemCount = entry.kind === "structured" ? entryDisplayItemCount(entry.reward) : 0;
      var baseLabelRadius = displayItemCount >= 5 ? 150 : displayItemCount === 4 ? 160 : displayItemCount === 3 ? 170
        : displayItemCount === 2 ? 180 : displayItemCount === 1 ? 220 : 238;
      var labelRadius = baseLabelRadius + 8 * winnerExpansion;
      var position = polar(labelRadius, centerAngle);
      var rotation = centerAngle;
      if (normalizeAngle(centerAngle) > 90 && normalizeAngle(centerAngle) < 270) {
        rotation += 180;
      }
      appendSvgShorthand(group, entry, position, rotation, count, winnerExpansion, sliceAngle, labelRadius);
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

    // Identical entries collapse into one option, keyed by the first entry with that
    // label. The actual rigged target may be a different (identical) entry — see the
    // change handler, which rolls a random match — so the select's displayed value is
    // resolved back through this map rather than compared directly to riggedTargetId.
    var representativeByLabel = {};
    state.entries.forEach(function (entry) {
      var label = entryLabel(entry);
      if (Object.prototype.hasOwnProperty.call(representativeByLabel, label)) return;
      representativeByLabel[label] = entry.id;
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = label;
      dom.riggedWinner.appendChild(option);
    });

    var riggedEntry = state.entries.find(function (entry) { return entry.id === state.riggedTargetId; });
    dom.riggedWinner.value = riggedEntry ? representativeByLabel[entryLabel(riggedEntry)] : "";
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
      var visual = entryVisual(entry);
      var row = document.createElement("li");
      row.className = "slice-row";
      row.dataset.entryId = entry.id;
      row.style.setProperty("--entry-gradient", visual.css);
      row.style.setProperty("--entry-trim", visual.textColor);
      if (entry.id === state.riggedTargetId) row.classList.add("is-rigged-target");

      var number = document.createElement("span");
      number.className = "slice-index";
      number.textContent = String(index + 1).padStart(2, "0");

      var identity = document.createElement("div");
      identity.className = "slice-label-wrap";
      if (entry.kind === "structured") {
        var structuredVisual = document.createElement("span");
        structuredVisual.className = "slice-structured-visual";
        appendCompactReward(structuredVisual, entry.reward);
        structuredVisual.setAttribute("aria-label", entryLabel(entry));
        structuredVisual.title = entryLabel(entry);
        identity.appendChild(structuredVisual);
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

  function appendCompactReward(container, reward) {
    var always = sortedComponents(reward.always || []);
    var options = (reward.options || []).map(sortedComponents);
    appendHtmlBranch(container, always, "compact");
    if (always.length && options.length) {
      var and = document.createElement("span");
      and.className = "reward-plus";
      and.textContent = "+";
      container.appendChild(and);
    }
    options.forEach(function (branch, index) {
      if (index) {
        var or = document.createElement("span");
        or.className = "reward-or";
        or.textContent = "OR";
        container.appendChild(or);
      }
      appendHtmlBranch(container, branch, "compact");
    });
  }

  function renderWheelIdentity() {
    var theme = PRESET_THEMES[validIconKey(state.draftIdentity.iconKey) || "genex"];
    dom.wheelIdentityName.textContent = state.draftIdentity.name || "Custom Wheel";
    dom.wheelIdentityIcon.src = theme.image;
    dom.wheelIdentityIcon.alt = "";
    document.body.style.setProperty("--preset-primary", theme.primary);
    document.body.style.setProperty("--preset-secondary", theme.secondary);
    document.body.style.setProperty("--preset-deep", theme.deep);
  }

  function presetDisplayOrder() {
    return state.presets.map(function (preset, index) { return { preset: preset, index: index }; })
      .sort(function (left, right) {
        var leftRank = left.preset.builtinKey && BUILTIN_PRESETS[left.preset.builtinKey]
          ? BUILTIN_PRESETS[left.preset.builtinKey].rank
          : 1000 + left.index;
        var rightRank = right.preset.builtinKey && BUILTIN_PRESETS[right.preset.builtinKey]
          ? BUILTIN_PRESETS[right.preset.builtinKey].rank
          : 1000 + right.index;
        return leftRank - rightRank;
      })
      .map(function (item) { return item.preset; });
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
    presetDisplayOrder().forEach(function (preset) {
      var theme = PRESET_THEMES[presetIconKey(preset)];
      var row = document.createElement("li");
      row.className = "preset-row";
      row.dataset.presetId = preset.id;
      row.style.setProperty("--preset-card-primary", theme.primary);
      row.style.setProperty("--preset-card-secondary", theme.secondary);

      var top = document.createElement("div");
      top.className = "preset-row__top";
      var icon = document.createElement("img");
      icon.className = "preset-row__icon";
      icon.src = theme.image;
      icon.alt = "";
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
      top.append(icon, input, count);

      var actions = document.createElement("div");
      actions.className = "preset-row__actions";
      var deleteButton = presetActionButton("Delete", "delete", preset.name, "small-button--delete");
      if (preset.builtinKey) {
        deleteButton.disabled = true;
        deleteButton.title = "Pinned wheels cannot be deleted";
      }
      actions.append(
        presetActionButton("Load", "load", preset.name),
        presetActionButton("Rename", "rename", preset.name),
        presetActionButton("Duplicate", "duplicate", preset.name),
        deleteButton
      );
      row.append(top);
      if (preset.builtinKey) {
        var pin = document.createElement("span");
        pin.className = "preset-row__pin";
        pin.textContent = "Pinned";
        row.appendChild(pin);
      } else {
        var iconOptions = document.createElement("div");
        iconOptions.className = "preset-row__icon-options";
        GENERIC_ICON_KEYS.forEach(function (iconKey) {
          var choice = document.createElement("button");
          choice.type = "button";
          choice.className = "preset-row__icon-choice" + (presetIconKey(preset) === iconKey ? " is-selected" : "");
          choice.dataset.action = "icon";
          choice.dataset.iconKey = iconKey;
          choice.setAttribute("aria-label", "Use " + iconKey + " icon for " + preset.name);
          var choiceImage = document.createElement("img");
          choiceImage.src = PRESET_THEMES[iconKey].image;
          choiceImage.alt = "";
          choice.appendChild(choiceImage);
          iconOptions.appendChild(choice);
        });
        row.appendChild(iconOptions);
      }
      row.appendChild(actions);
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
    document.querySelectorAll("[data-composer-reward]").forEach(function (button) {
      var definition = REWARDS[button.dataset.composerReward];
      var name = quantity === 1 ? (definition.shortSingular || definition.singular) : (definition.shortPlural || definition.plural);
      button.querySelector("span").textContent = quantity + " " + name;
      button.setAttribute("aria-label", "Use " + quantity + " " + name + " in the combined entry");
    });
    var customAddButton = dom.customForm.querySelector("button[type='submit']");
    customAddButton.disabled = atLimit;
    dom.composerSubmit.disabled = atLimit && !state.editingEntryId;
    renderRiggedControls();
  }

  function blankSimpleComposer() {
    return { tokens: [], relations: [null, null] };
  }

  function rewardToSimple(reward) {
    var always = deepClone(reward.always || []);
    var options = deepClone(reward.options || []);
    if (!options.length && always.length >= 1 && always.length <= 3) {
      return { tokens: always, relations: always.slice(1).map(function () { return "and"; }).concat([null, null]).slice(0, 2) };
    }
    if (!always.length && options.length >= 2 && options.length <= 3 && options.every(function (branch) { return branch.length === 1; })) {
      return { tokens: options.map(function (branch) { return branch[0]; }), relations: options.slice(1).map(function () { return "or"; }).concat([null, null]).slice(0, 2) };
    }
    if (always.length === 1 && options.length === 2 && options.every(function (branch) { return branch.length === 1; })) {
      return { tokens: [always[0], options[0][0], options[1][0]], relations: ["and", "or"] };
    }
    return null;
  }

  function simpleToReward(simple) {
    var tokens = deepClone(simple.tokens);
    if (!tokens.length) return { schema: 1, always: [], options: [] };
    if (tokens.length === 1) return { schema: 1, always: tokens, options: [] };
    if (!simple.relations[0]) return null;
    if (tokens.length === 2) {
      return simple.relations[0] === "or"
        ? { schema: 1, always: [], options: [[tokens[0]], [tokens[1]]] }
        : { schema: 1, always: tokens, options: [] };
    }
    if (!simple.relations[1]) return null;
    if (simple.relations[0] === "and" && simple.relations[1] === "and") return { schema: 1, always: tokens, options: [] };
    if (simple.relations[0] === "or" && simple.relations[1] === "or") return { schema: 1, always: [], options: tokens.map(function (item) { return [item]; }) };
    if (simple.relations[0] === "and" && simple.relations[1] === "or") return { schema: 1, always: [tokens[0]], options: [[tokens[1]], [tokens[2]]] };
    return { schema: 1, always: [tokens[2]], options: [[tokens[0]], [tokens[1]]] };
  }

  function updateComposerFromSimple() {
    var reward = state.simpleComposer && simpleToReward(state.simpleComposer);
    if (reward) state.composer = reward;
  }

  function syncSimpleFromAdvanced() {
    state.simpleComposer = rewardToSimple(composerReward());
    if (!state.simpleComposer) dom.composerAdvanced.open = true;
  }

  function simpleRewardNode(item) {
    var wrapper = document.createElement("span");
    wrapper.className = "simple-slot__reward";
    if (item.type !== "custom") {
      var image = document.createElement("img");
      image.src = REWARDS[item.type].image;
      image.alt = "";
      image.dataset.crop = REWARDS[item.type].crop || item.type;
      wrapper.appendChild(image);
    }
    var label = document.createElement("b");
    label.textContent = item.type === "custom" ? item.text : REWARDS[item.type].label;
    wrapper.appendChild(label);
    return wrapper;
  }

  function renderSimpleComposer() {
    dom.simpleExpression.replaceChildren();
    var simple = state.simpleComposer;
    var compatible = Boolean(simple);
    dom.composerSimple.classList.toggle("is-incompatible", !compatible);
    document.querySelectorAll("[data-composer-reward]").forEach(function (button) {
      button.disabled = !compatible || simple.tokens.length >= 3;
    });
    dom.composerSimpleCustom.disabled = !compatible || simple.tokens.length >= 3;
    dom.composerSimpleCustomAdd.disabled = !compatible || simple.tokens.length >= 3;

    if (!compatible) {
      dom.composerSimpleNote.textContent = "This entry uses a more complex saved structure. Edit it under Advanced structure without losing any rewards.";
    } else if (!simple.tokens.length) {
      dom.composerSimpleNote.textContent = "Choose the first reward above.";
    } else if (simple.tokens.length >= 3) {
      dom.composerSimpleNote.textContent = "All three reward slots are filled.";
    } else if (!simple.relations[simple.tokens.length - 1]) {
      dom.composerSimpleNote.textContent = "Choose AND or OR before adding the next reward.";
    } else {
      dom.composerSimpleNote.textContent = "Choose the next reward above.";
    }

    for (let index = 0; index < 3; index += 1) {
      var item = compatible ? simple.tokens[index] : null;
      var slot = document.createElement("div");
      slot.className = "simple-slot";
      if (item) slot.classList.add("is-filled");
      else if (compatible && (index === 0 || Boolean(simple.tokens[index - 1]))) slot.classList.add("is-active");
      var number = document.createElement("span");
      number.className = "simple-slot__number";
      number.textContent = String(index + 1).padStart(2, "0");
      slot.appendChild(number);
      if (item) {
        slot.style.setProperty("--token-color", componentVisualColors(item)[0].color);
        slot.appendChild(simpleRewardNode(item));
        var controls = document.createElement("span");
        controls.className = "simple-slot__controls";
        var amount = document.createElement("input");
        amount.type = "number";
        amount.min = "1";
        amount.max = "999";
        amount.value = String(item.amount);
        amount.className = "simple-slot__amount";
        amount.dataset.simpleAmount = String(index);
        amount.setAttribute("aria-label", "Quantity for " + componentWords(item, false));
        controls.append(amount, makeButton("mini-icon mini-icon--remove", "×", "Remove " + componentWords(item, false), "simple-remove"));
        controls.lastChild.dataset.simpleIndex = String(index);
        slot.appendChild(controls);
      } else {
        var empty = document.createElement("span");
        empty.className = "simple-slot__empty";
        empty.textContent = compatible && (index === 0 || simple.tokens[index - 1]) ? "Choose a reward" : "Next reward";
        slot.appendChild(empty);
      }
      dom.simpleExpression.appendChild(slot);

      if (index < 2) {
        var relation = document.createElement("div");
        relation.className = "simple-relation";
        relation.hidden = !compatible || !simple.tokens[index];
        var prompt = document.createElement("span");
        prompt.textContent = "Combine with";
        relation.appendChild(prompt);
        ["and", "or"].forEach(function (kind) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "relation-button" + (simple && simple.relations[index] === kind ? " is-selected" : "");
          button.dataset.relationIndex = String(index);
          button.dataset.relation = kind;
          button.textContent = kind.toUpperCase();
          relation.appendChild(button);
        });
        dom.simpleExpression.appendChild(relation);
      }
    }
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
    renderSimpleComposer();
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
    state.simpleComposer = blankSimpleComposer();
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
      state.simpleComposer = rewardToSimple(entry.reward);
      state.editingEntryId = entry.id;
      dom.composerAdvanced.open = !state.simpleComposer;
    } else if (dom.composer.hidden) {
      state.editingEntryId = null;
      state.simpleComposer = blankSimpleComposer();
      dom.composerAdvanced.open = false;
    }
    dom.composer.hidden = false;
    dom.composerToggle.setAttribute("aria-expanded", "true");
    renderComposer();
    dom.componentType.focus();
  }

  function renderAll() {
    renderWheel(state.entries, null, 0);
    renderWheelIdentity();
    renderSliceList();
    renderPresetList();
    syncControls();
    renderComposer();
  }

  function commitChange(message) {
    ensureAllVisualAssignments();
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

    // Boosting only ever adds distance (whole extra turns), never velocity: adding distance
    // without touching velocity always raises tau (= remaining / velocity), so every boost is
    // guaranteed to extend the remaining time, never shorten it. It fades out over the final
    // BOOST_TAPER_MS of the time budget so even nonstop rapid-clicking decays into a smooth
    // stop at MAX_SPIN_MS rather than being cut off mid-motion.
    var budgetRemaining = Math.max(0, MAX_SPIN_MS - (now - motion.startedAt));
    var taper = Math.min(1, budgetRemaining / BOOST_TAPER_MS);
    var addedTurns = BOOST_TURNS * strength * taper;
    if (addedTurns > 0) motion.target += addedTurns * 360;

    triggerSphealFeedback(strength);
    emitSoundEvent("spinBoost", { strength: strength, addedTurns: addedTurns });
  }

  // A single continuous decay from SPIN_VELOCITY toward zero, aimed at the exact winning
  // angle from the very first frame. Because the target and current position determine a
  // consistent decay rate every frame (tau = remaining distance / current velocity), the
  // motion always slows continuously into the landing with no separate re-align step that
  // could snap or speed up. Boosting only ever adds distance (whole 360s, so the landing
  // angle is unaffected), which the same per-frame math absorbs without any discontinuity.
  function runSpinMotion(sliceAngle, targetRotation) {
    return new Promise(function (resolve) {
      var startedAt = performance.now();
      var motion = {
        target: targetRotation,
        velocity: SPIN_VELOCITY,
        startedAt: startedAt,
        lastFrameAt: startedAt,
        lastBoostAt: startedAt,
        reserve: 1,
        lastTick: Math.floor(state.rotation / sliceAngle)
      };
      state.spinMotion = motion;
      var stopVelocity = SPIN_VELOCITY * SPIN_STOP_RATIO;

      function finish() {
        setRotation(motion.target);
        state.spinMotion = null;
        resolve();
      }

      function frame(now) {
        var elapsed = Math.min(40, Math.max(0, now - motion.lastFrameAt));
        motion.lastFrameAt = now;

        var remaining = motion.target - state.rotation;
        if (remaining <= 0.05 || motion.velocity <= stopVelocity || now - startedAt >= MAX_SPIN_MS) {
          finish();
          return;
        }

        var tau = remaining / motion.velocity;
        var decay = Math.exp(-elapsed / tau);
        setRotation(state.rotation + remaining * (1 - decay));
        motion.velocity *= decay;

        var currentTick = Math.floor(state.rotation / sliceAngle);
        if (currentTick !== motion.lastTick) {
          motion.lastTick = currentTick;
          tickPointer();
          emitSoundEvent("pointerTick", { rotation: state.rotation });
        }

        window.requestAnimationFrame(frame);
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
      wrapper.appendChild(image);
      if (size !== "compact") wrapper.appendChild(words);
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

  function armSpin() {
    if (state.phase !== "setup" || !state.entries.length) return;
    state.phase = "armed";
    setCinematic(true);
    dom.spinButton.setAttribute("aria-label", "Start the spin");
    dom.spinButton.focus();
  }

  function cancelArmed() {
    if (state.phase !== "armed") return;
    state.phase = "setup";
    setCinematic(false);
    dom.spinButton.setAttribute("aria-label", "Spin the wheel");
    window.requestAnimationFrame(function () { dom.spinButton.focus(); });
  }

  async function startSpin() {
    if (state.phase !== "armed" || !state.entries.length) return;

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
    dom.spinButton.setAttribute("aria-label", "Wheel spinning");
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
      var targetRotation = state.rotation + BASE_EXTRA_TURNS * 360
        + normalizeAngle(desiredRotation - normalizeAngle(state.rotation));
      await runSpinMotion(sliceAngle, targetRotation);
      state.phase = "landing";
      document.body.classList.remove("is-spinning");
      dom.spinButton.setAttribute("aria-label", "Wheel landing");
      finalRotation = state.rotation;
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
  document.querySelectorAll("[data-composer-reward]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (!state.simpleComposer || state.simpleComposer.tokens.length >= 3) return;
      var nextIndex = state.simpleComposer.tokens.length;
      if (nextIndex > 0 && !state.simpleComposer.relations[nextIndex - 1]) {
        setStatus("Choose AND or OR before adding the next reward.", "warning");
        return;
      }
      state.simpleComposer.tokens.push(component(button.dataset.composerReward, state.quantity));
      updateComposerFromSimple();
      renderComposer();
    });
  });
  dom.composerSimpleCustomAdd.addEventListener("click", function () {
    if (!state.simpleComposer || state.simpleComposer.tokens.length >= 3) return;
    var text = cleanText(dom.composerSimpleCustom.value, MAX_LABEL_LENGTH);
    if (!text) {
      setStatus("Enter custom reward text first.", "warning");
      dom.composerSimpleCustom.focus();
      return;
    }
    var nextIndex = state.simpleComposer.tokens.length;
    if (nextIndex > 0 && !state.simpleComposer.relations[nextIndex - 1]) {
      setStatus("Choose AND or OR before adding the next reward.", "warning");
      return;
    }
    state.simpleComposer.tokens.push(component("custom", state.quantity, text));
    dom.composerSimpleCustom.value = "";
    updateComposerFromSimple();
    renderComposer();
  });
  dom.composerSimpleCustom.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      dom.composerSimpleCustomAdd.click();
    }
  });
  dom.simpleExpression.addEventListener("click", function (event) {
    var relationButton = event.target.closest("[data-relation-index]");
    if (relationButton && state.simpleComposer) {
      state.simpleComposer.relations[Number(relationButton.dataset.relationIndex)] = relationButton.dataset.relation;
      updateComposerFromSimple();
      renderComposer();
      return;
    }
    var removeButton = event.target.closest("[data-action='simple-remove']");
    if (!removeButton || !state.simpleComposer) return;
    var removeIndex = Number(removeButton.dataset.simpleIndex);
    state.simpleComposer.tokens.splice(removeIndex, 1);
    if (removeIndex === 0) state.simpleComposer.relations.shift();
    else state.simpleComposer.relations.splice(removeIndex - 1, 1);
    while (state.simpleComposer.relations.length < 2) state.simpleComposer.relations.push(null);
    updateComposerFromSimple();
    renderComposer();
  });
  dom.simpleExpression.addEventListener("input", function (event) {
    if (!event.target.dataset.simpleAmount || !state.simpleComposer) return;
    var item = state.simpleComposer.tokens[Number(event.target.dataset.simpleAmount)];
    var amount = Number(event.target.value);
    if (!item || !Number.isInteger(amount) || amount < 1 || amount > 999) return;
    item.amount = amount;
    updateComposerFromSimple();
    var reward = composerReward();
    dom.composerPreview.textContent = rewardDescription(reward) || "Add a component to begin.";
    var validation = composerValidationMessage();
    dom.composerValidation.textContent = validation;
    dom.composerSubmit.disabled = Boolean(validation);
  });
  dom.simpleExpression.addEventListener("change", function (event) {
    if (!event.target.dataset.simpleAmount || !state.simpleComposer) return;
    var item = state.simpleComposer.tokens[Number(event.target.dataset.simpleAmount)];
    var amount = Number(event.target.value);
    if (item && Number.isInteger(amount) && amount >= 1 && amount <= 999) return;
    if (item) event.target.value = String(item.amount);
    setStatus("Combined reward quantities must be whole numbers from 1 to 999.", "warning");
  });
  dom.componentType.addEventListener("change", function () {
    dom.componentCustomField.hidden = dom.componentType.value !== "custom";
    if (!dom.componentCustomField.hidden) dom.componentCustomText.focus();
  });
  dom.addAlternative.addEventListener("click", function () {
    state.composer.options.push([]);
    syncSimpleFromAdvanced();
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
    syncSimpleFromAdvanced();
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
    syncSimpleFromAdvanced();
    renderSimpleComposer();
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
    syncSimpleFromAdvanced();
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
      syncSimpleFromAdvanced();
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
    syncSimpleFromAdvanced();
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
    var chosenId = dom.riggedWinner.value || null;
    var chosenEntry = chosenId && state.entries.find(function (entry) { return entry.id === chosenId; });
    if (chosenEntry) {
      var label = entryLabel(chosenEntry);
      var matches = state.entries.filter(function (entry) { return entryLabel(entry) === label; });
      state.riggedTargetId = matches[randomIndex(matches.length)].id;
    } else {
      state.riggedTargetId = null;
    }
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
    var selectedIcon = dom.savePresetForm.querySelector("input[name='presetIcon']:checked").value;
    if (existing) {
      var shouldOverwrite = await requestConfirmation({
        title: "Replace saved wheel?",
        message: "“" + existing.name + "” already exists. Replace its saved entries with the current wheel?",
        confirmLabel: "Replace"
      });
      if (!shouldOverwrite) return;
      existing.entries = cloneEntries(state.entries, false);
      if (!existing.builtinKey) existing.iconKey = selectedIcon;
      existing.updatedAt = Date.now();
      state.draftIdentity = { presetId: existing.id, name: existing.name, iconKey: presetIconKey(existing) };
      commitChange(existing.name + " updated.");
    } else {
      var presetId = createId("preset");
      var created = {
        id: presetId,
        name: name,
        entries: cloneEntries(state.entries, false),
        updatedAt: Date.now(),
        builtinKey: null,
        iconKey: selectedIcon
      };
      state.presets.push(created);
      state.draftIdentity = { presetId: presetId, name: name, iconKey: selectedIcon };
      commitChange(name + " saved.");
    }
    dom.presetName.value = "";
  });

  dom.newWheelButton.addEventListener("click", async function (event) {
    // Lives inside <summary>; stop the click from also toggling the details disclosure.
    event.preventDefault();
    event.stopPropagation();
    var canReplace = !isDraftDirty() || await requestConfirmation({
      title: "Start a new wheel?",
      message: "Starting a new wheel will replace the entries currently on the wheel.",
      confirmLabel: "New wheel"
    });
    if (!canReplace) return;
    var name = cleanText(dom.presetName.value, MAX_LABEL_LENGTH) || nextNewWheelName();
    state.entries = [];
    state.draftIdentity = { presetId: null, name: name, iconKey: "genex" };
    clearRigging();
    commitChange(name + " ready to build.");
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

    if (action === "icon") {
      if (preset.builtinKey) return;
      preset.iconKey = validIconKey(button.dataset.iconKey) || preset.iconKey;
      preset.updatedAt = Date.now();
      if (state.draftIdentity.presetId === preset.id) state.draftIdentity.iconKey = preset.iconKey;
      commitChange(preset.name + " icon updated.");
      return;
    }

    if (action === "load") {
      var canLoad = !isDraftDirty() || await requestConfirmation({
        title: "Replace current wheel?",
        message: "Loading “" + preset.name + "” will replace the entries currently on the wheel.",
        confirmLabel: "Load preset"
      });
      if (!canLoad) return;
      state.entries = cloneEntries(preset.entries, false);
      state.draftIdentity = { presetId: preset.id, name: preset.name, iconKey: presetIconKey(preset) };
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
      if (state.draftIdentity.presetId === preset.id) state.draftIdentity.name = nextName;
      commitChange("Preset renamed to " + nextName + ".");
      return;
    }

    if (action === "duplicate") {
      var copyName = makeUniquePresetName(preset.name);
      var copyId = createId("preset");
      state.presets.push({
        id: copyId,
        name: copyName,
        entries: cloneEntries(preset.entries, true),
        updatedAt: Date.now(),
        builtinKey: null,
        iconKey: preset.builtinKey ? genericIconForId(copyId) : presetIconKey(preset)
      });
      commitChange(copyName + " created.");
      return;
    }

    if (action === "delete") {
      if (preset.builtinKey) {
        setStatus("Pinned wheels cannot be deleted.", "warning");
        return;
      }
      var shouldDelete = !preset.entries.length || await requestConfirmation({
        title: "Delete saved wheel?",
        message: "Delete “" + preset.name + "”? This cannot be undone.",
        confirmLabel: "Delete"
      });
      if (!shouldDelete) return;
      state.presets = state.presets.filter(function (candidate) { return candidate.id !== preset.id; });
      if (state.draftIdentity.presetId === preset.id) {
        state.draftIdentity = { presetId: null, name: "Custom Wheel", iconKey: presetIconKey(preset) };
      }
      commitChange(preset.name + " deleted.");
    }
  });

  dom.spinButton.addEventListener("click", function () {
    // Boosting is disabled for now: a spin always runs once, start to finish, with no
    // rapid-click extension. Re-wire a "spinning" branch to boostSpin() to bring it back.
    if (state.phase === "armed") startSpin();
    else if (state.phase === "setup") armSpin();
  });
  dom.confirmDialog.addEventListener("close", handleDialogClose);

  window.addEventListener("click", function (event) {
    if (state.phase === "result") {
      // Consume the dismissal click before setup returns so it cannot click through into a newly visible control.
      event.preventDefault();
      event.stopImmediatePropagation();
      exitResult();
      return;
    }
    if (state.phase === "armed" && !dom.spinButton.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelArmed();
    }
  }, true);

  window.addEventListener("keydown", function (event) {
    var keyId = event.code || event.key;
    if (state.phase === "armed") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelArmed();
        return;
      }
      if (event.target === dom.spinButton && !event.repeat && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        startSpin();
      }
      return;
    }
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

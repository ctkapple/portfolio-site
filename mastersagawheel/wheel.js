(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var STORAGE_KEY = "selection-wheel:v1";
  var AUDIO_PREFERENCE_KEY = "selection-wheel:audio:v1";
  var STORAGE_VERSION = 6;
  var DEFAULT_SEED_VERSION = 2;
  var MAX_ENTRIES = 60;
  var MAX_LABEL_LENGTH = 48;
  // Just long enough to register that the wheel has stopped before the reveal takes over.
  var LANDING_HOLD_MS = 120;
  // The reveal resolves on its own cadence and then rests indefinitely: the burst fires from
  // the landed wedge, the plate unfurls out of it, and snow keeps falling until dismissal.
  var PLATE_UNFURL_DELAY_MS = 180;
  var PARTICLE_COUNT = 20;
  var PARTICLE_STAGGER_MS = 700;
  var SNOW_START_MS = 700;
  var SNOW_COUNT = 28;
  var SNOW_FADE_MS = 900;
  // Finish.mp3 runs ~24.9s. The snow is tied to the music, so the muted path — where there
  // is no track to report a duration — falls back to the same length.
  var MUSIC_FALLBACK_MS = 24900;
  var EXIT_PLATE_MS = 260;
  var EXIT_SETTLE_MS = 520;
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
    packs: { label: "Secret Packs", singular: "Secret Pack", plural: "Secret Packs", shortSingular: "Pack", shortPlural: "Packs", image: "The_Masters_Saga-Pack-Master_Duel.png", color: "#dfa735", precedence: 80, crop: "pack" },
    bans: { label: "Bans", singular: "Ban", plural: "Bans", image: "Ban_Asset.png", color: "#dd453e", precedence: 70 },
    sr: { label: "SR", singular: "SR", plural: "SR", image: "SR_Craft_asset.png", color: "#e6bc3f", precedence: 60 },
    r: { label: "R", singular: "R", plural: "R", image: "R_Craft_asset.png", color: "#31bde8", precedence: 50 },
    n: { label: "N", singular: "N", plural: "N", image: "N_Craft_asset.png", color: "#aeb8c5", precedence: 40 },
    nr: { label: "N/R", singular: "N/R", plural: "N/R", image: "N_R_Craft_asset.png", color: "#6da8c4", precedence: 30 },
    custom: { label: "Custom reward", singular: "", plural: "", image: "Master_Duel_Gem.png", color: "#766cff", precedence: 85 }
  };
  // Reward-tier color families: background comes from an entry's highest-tier reward,
  // text from its next-highest. Packs and N/R are nudged off SR-gold and R-blue so two
  // different reward types never read as the same slice color.
  var COLOR_FAMILIES = {
    ur: "#bd4fe2",
    packs: "#d9781f",
    bans: "#dd453e",
    sr: "#e6bc3f",
    r: "#31bde8",
    n: "#aeb8c5",
    nr: "#7a95a3",
    custom: "#766cff"
  };
  var TEXT_ACCENTS = {
    ur: "#e9a6ff",
    packs: "#ffb15c",
    bans: "#ff8f86",
    sr: "#ffe27a",
    r: "#7fe0ff",
    n: "#d7dee8",
    nr: "#a9c3cc",
    custom: "#d8d2ff"
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
    wheelShell: document.getElementById("wheel-shell"),
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
    customGemSubmit: document.getElementById("custom-gem-submit"),
    sharedQuantity: document.getElementById("shared-quantity"),
    rewardSource: document.getElementById("reward-source"),
    rewardSourceRail: document.getElementById("reward-source-rail"),
    sliceList: document.getElementById("slice-list"),
    newWheelButton: document.getElementById("new-wheel-button"),
    presetList: document.getElementById("preset-list"),
    newWheelDialog: document.getElementById("new-wheel-dialog"),
    newWheelForm: document.getElementById("new-wheel-form"),
    newWheelName: document.getElementById("new-wheel-name"),
    newWheelValidation: document.getElementById("new-wheel-validation"),
    newWheelCancel: document.getElementById("new-wheel-cancel"),
    riggedToggle: document.getElementById("rigged-toggle"),
    riggedWinner: document.getElementById("rigged-winner"),
    adminToggle: document.getElementById("admin-toggle"),
    adminPopover: document.getElementById("admin-popover"),
    editorStatus: document.getElementById("editor-status"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmMessage: document.getElementById("confirm-message"),
    confirmAction: document.getElementById("confirm-action"),
    resultAnnouncement: document.getElementById("result-announcement"),
    resultCard: document.getElementById("result-card"),
    resultPrimary: document.getElementById("result-primary"),
    resultAlternatives: document.getElementById("result-alternatives"),
    winnerParticles: document.getElementById("winner-particles"),
    snowField: document.getElementById("snow-field"),
    composerToggle: document.getElementById("composer-toggle"),
    composer: document.getElementById("entry-composer"),
    rewardDialog: document.getElementById("reward-dialog"),
    composerHeading: document.getElementById("composer-heading"),
    composerClose: document.getElementById("composer-close"),
    composerValidation: document.getElementById("composer-validation"),
    composerReset: document.getElementById("composer-reset"),
    composerSubmit: document.getElementById("composer-submit"),
    composerSimple: document.getElementById("composer-simple"),
    composerSourceMount: document.getElementById("composer-source-mount"),
    simpleExpression: document.getElementById("simple-expression"),
    wheelIdentityIcon: document.getElementById("wheel-identity-icon"),
    wheelIdentityIconEnd: document.getElementById("wheel-identity-icon-end"),
    wheelIdentityName: document.getElementById("wheel-identity-name"),
    soundToggle: document.getElementById("sound-toggle")
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
    snowTimer: 0,
    snowStopTimer: 0,
    storageEnabled: storageIsAvailable(),
    soundEnabled: true,
    composer: { always: [], options: [] },
    simpleComposer: { tokens: [], relations: [null, null] },
    composerEditIndex: null,
    editingEntryId: null,
    composerUnsupported: false,
    draftIdentity: { presetId: null, name: "Custom Wheel", iconKey: "genex" }
  };

  var pendingConfirmation = null;
  var statusTimer = 0;
  var initialNotice = "";
  var heldCinematicKeys = new Set();
  var SOUND_ASSETS = {
    arm: "sounds/forceField_002.ogg",
    launch: "sounds/laserRetro_003.ogg",
    ticks: [
      "sounds/laserSmall_000.ogg",
      "sounds/laserSmall_001.ogg",
      "sounds/laserSmall_002.ogg",
      "sounds/laserSmall_003.ogg",
      "sounds/laserSmall_004.ogg"
    ],
    landImpact: "sounds/lowFrequency_explosion_001.ogg",
    landChime: "sounds/laserLarge_002.ogg",
    editorAdd: "sounds/laserLarge_003.ogg",
    editorMove: "sounds/laserSmall_003.ogg",
    editorLoad: "sounds/laserLarge_004.ogg",
    music: "sounds/Finish.mp3"
  };
  var audioController = new SoundController();

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

  // Audio is deliberately isolated from wheel state: browser audio unlocks only after a
  // wheel interaction, while mute preference lives under its own storage key.
  function SoundController() {
    this.context = null;
    this.masterGain = null;
    this.buffers = {};
    this.loading = {};
    this.activeSources = [];
    this.music = null;
    this.musicToken = 0;
    this.generation = 0;
    this.lastTickAt = 0;
    this.tickCount = 0;
  }

  SoundController.prototype.ensureContext = function () {
    if (this.context) return this.context;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = state.soundEnabled ? 0.72 : 0;
    this.masterGain.connect(this.context.destination);
    return this.context;
  };

  SoundController.prototype.unlock = function () {
    if (!state.soundEnabled) return;
    var context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") {
      var resume = context.resume();
      if (resume && typeof resume.catch === "function") resume.catch(function () {});
    }
    this.warm();
  };

  SoundController.prototype.warm = function () {
    var self = this;
    if (!this.ensureContext()) return;
    [SOUND_ASSETS.arm, SOUND_ASSETS.launch, SOUND_ASSETS.landImpact, SOUND_ASSETS.landChime,
      SOUND_ASSETS.editorAdd, SOUND_ASSETS.editorMove, SOUND_ASSETS.editorLoad, SOUND_ASSETS.music]
      .concat(SOUND_ASSETS.ticks)
      .forEach(function (url) { self.load(url).catch(function () {}); });
  };

  SoundController.prototype.load = function (url) {
    var self = this;
    if (this.buffers[url]) return Promise.resolve(this.buffers[url]);
    if (this.loading[url]) return this.loading[url];
    var context = this.ensureContext();
    if (!context) return Promise.reject(new Error("Web Audio is unavailable."));
    this.loading[url] = window.fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load sound: " + url);
        return response.arrayBuffer();
      })
      .then(function (data) { return context.decodeAudioData(data); })
      .then(function (buffer) {
        self.buffers[url] = buffer;
        delete self.loading[url];
        return buffer;
      })
      .catch(function (error) {
        delete self.loading[url];
        throw error;
      });
    return this.loading[url];
  };

  SoundController.prototype.trackSource = function (source) {
    var self = this;
    this.activeSources.push(source);
    source.addEventListener("ended", function () {
      self.activeSources = self.activeSources.filter(function (candidate) { return candidate !== source; });
    });
  };

  SoundController.prototype.play = function (url, options) {
    if (!state.soundEnabled) return;
    var context = this.ensureContext();
    if (!context) return;
    var self = this;
    var generation = this.generation;
    var settings = options || {};
    this.load(url).then(function (buffer) {
      if (!state.soundEnabled || generation !== self.generation || !self.context) return;
      var source = self.context.createBufferSource();
      var gain = self.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = settings.rate || 1;
      gain.gain.value = settings.gain || 0.16;
      source.connect(gain);
      gain.connect(self.masterGain);
      self.trackSource(source);
      source.start(self.context.currentTime + (settings.delay || 0));
    }).catch(function () {});
  };

  SoundController.prototype.playTick = function (velocity, initialVelocity) {
    if (!state.soundEnabled) return;
    var ratio = initialVelocity ? Math.max(0, Math.min(1, velocity / initialVelocity)) : 0;
    var cadence = ratio > 0.62 ? 3 : (ratio > 0.22 ? 2 : 1);
    var now = performance.now();
    this.tickCount += 1;
    if (this.tickCount % cadence || now - this.lastTickAt < 42) return;
    this.lastTickAt = now;
    var index = this.tickCount % SOUND_ASSETS.ticks.length;
    this.play(SOUND_ASSETS.ticks[index], {
      gain: 0.075 + (1 - ratio) * 0.075,
      rate: 0.9 + (1 - ratio) * 0.16
    });
  };

  SoundController.prototype.playMusic = function (delay) {
    if (!state.soundEnabled) return Promise.resolve(0);
    var context = this.ensureContext();
    if (!context) return Promise.resolve(0);
    this.stopMusic(0);
    var self = this;
    var token = ++this.musicToken;
    var generation = this.generation;
    return this.load(SOUND_ASSETS.music).then(function (buffer) {
      if (!state.soundEnabled || token !== self.musicToken || generation !== self.generation || !self.context) return;
      var source = self.context.createBufferSource();
      var gain = self.context.createGain();
      var startAt = self.context.currentTime + (delay || 0);
      // Keep the win cue present, then clear it before the next setup interaction.
      var fadeStart = Math.max(1, buffer.duration - 8);
      var finishAt = Math.max(fadeStart + 0.2, buffer.duration - 0.15);
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(self.masterGain);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.linearRampToValueAtTime(0.36, startAt + 0.16);
      gain.gain.setValueAtTime(0.36, startAt + fadeStart);
      gain.gain.linearRampToValueAtTime(0.0001, startAt + finishAt);
      self.music = { source: source, gain: gain };
      source.addEventListener("ended", function () {
        if (self.music && self.music.source === source) self.music = null;
      });
      source.start(startAt);
      source.stop(startAt + finishAt);
      return (delay || 0) * 1000 + finishAt * 1000;
    }).catch(function () { return 0; });
  };

  SoundController.prototype.stopMusic = function (fadeDuration) {
    this.musicToken += 1;
    if (!this.music || !this.context) return;
    var music = this.music;
    this.music = null;
    var now = this.context.currentTime;
    var duration = Math.max(0, fadeDuration || 0);
    try {
      music.gain.gain.cancelScheduledValues(now);
      music.gain.gain.setValueAtTime(Math.max(0.0001, music.gain.gain.value), now);
      music.gain.gain.linearRampToValueAtTime(0.0001, now + duration);
      music.source.stop(now + duration + 0.02);
    } catch (error) {}
  };

  SoundController.prototype.stopAll = function (fadeDuration) {
    var self = this;
    var duration = Math.max(0, fadeDuration || 0);
    this.generation += 1;
    this.stopMusic(duration);
    this.activeSources.slice().forEach(function (source) {
      try { source.stop(self.context.currentTime + duration); } catch (error) {}
    });
  };

  SoundController.prototype.setEnabled = function (enabled) {
    if (enabled) {
      this.unlock();
      if (this.masterGain && this.context) {
        this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
        this.masterGain.gain.setValueAtTime(0.72, this.context.currentTime);
      }
      return;
    }
    if (!this.masterGain || !this.context) return;
    var now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(Math.max(0.0001, this.masterGain.gain.value), now);
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
    this.stopAll(0.12);
  };

  function hydrateSoundPreference() {
    if (!state.storageEnabled) return;
    try {
      state.soundEnabled = window.localStorage.getItem(AUDIO_PREFERENCE_KEY) !== "muted";
    } catch (error) {}
  }

  function persistSoundPreference() {
    if (!state.storageEnabled) return;
    try {
      window.localStorage.setItem(AUDIO_PREFERENCE_KEY, state.soundEnabled ? "enabled" : "muted");
    } catch (error) {}
  }

  function syncSoundToggle() {
    dom.soundToggle.textContent = state.soundEnabled ? "Sound on" : "Muted";
    dom.soundToggle.setAttribute("aria-pressed", String(state.soundEnabled));
    dom.soundToggle.setAttribute("aria-label", state.soundEnabled ? "Mute sound" : "Enable sound");
  }

  function isUtilityControl(target) {
    return Boolean(target && typeof target.closest === "function" && target.closest(".utility-chips"));
  }

  function bindSoundEvents() {
    soundEvents.addEventListener("spinArm", function () {
      audioController.play(SOUND_ASSETS.arm, { gain: 0.15 });
    });
    soundEvents.addEventListener("spinStart", function () {
      audioController.play(SOUND_ASSETS.launch, { gain: 0.18, rate: 0.92 });
    });
    soundEvents.addEventListener("spinBoost", function () {
      audioController.play(SOUND_ASSETS.launch, { gain: 0.16, rate: 1.12 });
    });
    soundEvents.addEventListener("pointerTick", function (event) {
      var detail = event.detail || {};
      audioController.playTick(detail.velocity, detail.initialVelocity);
    });
    soundEvents.addEventListener("winnerReveal", function () {
      audioController.play(SOUND_ASSETS.landImpact, { gain: 0.28 });
      audioController.play(SOUND_ASSETS.landChime, { gain: 0.2, delay: 0.04, rate: 1.06 });
    });
    soundEvents.addEventListener("rewardAdded", function () {
      audioController.play(SOUND_ASSETS.editorAdd, { gain: 0.13, rate: 0.98 });
    });
    soundEvents.addEventListener("rewardRemoved", function () {
      audioController.play(SOUND_ASSETS.landImpact, { gain: 0.12, rate: 0.9 });
    });
    soundEvents.addEventListener("rewardMoved", function () {
      audioController.play(SOUND_ASSETS.editorMove, { gain: 0.1 });
    });
    soundEvents.addEventListener("presetLoaded", function () {
      audioController.play(SOUND_ASSETS.editorLoad, { gain: 0.18 });
    });
    soundEvents.addEventListener("exitResult", function () {
      audioController.stopAll(0.12);
    });
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
      if (!envelope || [1, 2, 3, 4, 5, STORAGE_VERSION].indexOf(envelope.version) < 0) {
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

  // The wheel treats OR branches as descending visual tiers. Their original order and
  // full wording remain in the reward data and accessibility labels; this only changes
  // the compact slice presentation.
  function rewardDisplayRows(reward) {
    var rows = [];
    function appendComponents(components, isSecondaryOption) {
      components.forEach(function (item, index) {
        if (index && rows.length) rows[rows.length - 1].dividerAfter = "and";
        rows.push({ components: [item], isSecondaryOption: Boolean(isSecondaryOption), dividerAfter: null });
      });
    }

    var always = sortedComponents(reward.always || []);
    appendComponents(always, false);
    (reward.options || []).map(function (branch, index) {
      return { components: sortedComponents(branch), index: index, precedence: branchPrecedence(branch) };
    }).sort(function (a, b) {
      return b.precedence - a.precedence || a.index - b.index;
    }).forEach(function (branch, optionIndex) {
      if (optionIndex === 0 && always.length && rows.length) rows[rows.length - 1].dividerAfter = "and";
      appendComponents(branch.components, optionIndex > 0);
    });
    return rows;
  }

  function rewardTierScale(item) {
    var scales = { ur: 1, packs: .84, bans: .81, sr: .78, r: .67, n: .58, nr: .5, custom: .94 };
    return scales[item.type] || .66;
  }

  // Only the pack art stays a count-plus-icon: it is a wide card that does not tile. Every
  // other reward, bans included, repeats its icon up to four before falling back to a count.
  function usesNumericRewardDisplay(item) {
    return item.type === "packs" || item.amount > 4;
  }

  function rewardVisualSpec(item, baseIconSize) {
    var unit = baseIconSize * rewardTierScale(item);
    if (item.type === "custom") {
      var customIconSize = unit * .84;
      return { kind: "custom-icon", item: item, width: customIconSize, height: customIconSize, iconSize: customIconSize };
    }

    var iconSize = unit * .84;
    var fontSize = Math.max(8, unit * .54);
    var numberWidth = fontSize * (String(item.amount).length * .74 + .45);
    if (usesNumericRewardDisplay(item)) {
      return { kind: "number", item: item, width: numberWidth + iconSize + 4, height: Math.max(iconSize, fontSize), iconSize: iconSize, fontSize: fontSize, numberWidth: numberWidth };
    }

    var clusterCount = item.amount;
    var clusterScale = { 1: 1, 2: .72, 3: .6, 4: .54 }[clusterCount];
    var clusterIconSize = unit * clusterScale;
    var gap = clusterCount === 1 ? 0 : Math.max(1.5, clusterIconSize * .08);
    var positions;
    if (clusterCount === 1) positions = [{ x: 0, y: 0 }];
    else if (clusterCount === 2) positions = [{ x: 0, y: 0 }, { x: clusterIconSize + gap, y: 0 }];
    else if (clusterCount === 3) positions = [
      { x: 0, y: 0 }, { x: clusterIconSize + gap, y: 0 },
      { x: (clusterIconSize + gap) / 2, y: clusterIconSize + gap }
    ];
    else positions = [
      { x: 0, y: 0 }, { x: clusterIconSize + gap, y: 0 },
      { x: 0, y: clusterIconSize + gap }, { x: clusterIconSize + gap, y: clusterIconSize + gap }
    ];
    var clusterWidth = clusterCount === 1 ? clusterIconSize : clusterIconSize * 2 + gap;
    var clusterHeight = clusterCount <= 2 ? clusterIconSize : clusterIconSize * 2 + gap;
    return { kind: "cluster", item: item, width: clusterWidth, height: clusterHeight, iconSize: clusterIconSize, positions: positions };
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

  function nextNewWheelName() {
    if (!findPresetByName("Custom Wheel")) return "Custom Wheel";
    var number = 2;
    var name = "Custom Wheel " + number;
    while (findPresetByName(name)) {
      number += 1;
      name = "Custom Wheel " + number;
    }
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

  // The slice gradient is a deliberately shaded, low-chroma family color — good for a wheel
  // face, far too muted to carry a win on its own. The reveal borrows the reward's vivid
  // catalogue color for rims, glows and the burst, and leaves the plate's fill neutral so
  // the full-color reward art stays readable on top of it.
  function accentFor(entry) {
    var type = "custom";
    if (entry.kind === "structured") {
      var leading = primaryComponents(entry.reward)[0];
      if (leading) type = leading.type;
    }
    return (REWARDS[type] || REWARDS.custom).color;
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
      var legacyGroup = svgElement("g", { transform: "translate(" + position.x + " " + position.y + ") rotate(" + rotation + ")" });
      var legacyIconSize = (count <= 8 ? 72 : count <= 18 ? 54 : count <= 36 ? 40 : 30) + 4 * expansion;
      legacyGroup.appendChild(svgElement("image", {
        class: "wheel-slice__icon wheel-slice__icon--custom", href: REWARDS.custom.image,
        x: String(-legacyIconSize / 2), y: String(-legacyIconSize / 2), width: String(legacyIconSize), height: String(legacyIconSize),
        preserveAspectRatio: "xMidYMid slice"
      }));
      group.appendChild(legacyGroup);
      return { node: legacyGroup, fitScale: 1 };
    }

    var rows = rewardDisplayRows(entry.reward);
    var baseIconSize = (count <= 8 ? 96 : count <= 18 ? 70 : count <= 36 ? 52 : 36) + 6 * expansion;
    var blocks = [];
    rows.forEach(function (row, index) {
      if (index && rows[index - 1].dividerAfter === "and") blocks.push({ kind: "divider", height: 16, width: 16, isSecondaryOption: row.isSecondaryOption });
      var specs = row.components.map(function (item) { return rewardVisualSpec(item, baseIconSize); });
      var gap = specs.length > 1 ? 7 : 0;
      var plusWidth = specs.length > 1 ? 11 : 0;
      var width = specs.reduce(function (sum, spec) { return sum + spec.width; }, 0) + (specs.length - 1) * (gap + plusWidth);
      var height = specs.reduce(function (largest, spec) { return Math.max(largest, spec.height); }, 0);
      blocks.push({ kind: "row", specs: specs, width: width, height: height, gap: gap, plusWidth: plusWidth, isSecondaryOption: row.isSecondaryOption });
    });

    var rowGap = 7;
    var totalHeight = blocks.reduce(function (sum, block) { return sum + block.height; }, 0) + Math.max(0, blocks.length - 1) * rowGap;
    var widest = blocks.reduce(function (largest, block) { return Math.max(largest, block.width); }, 0);
    var wedgeChord = sliceAngle && labelRadius ? 2 * labelRadius * Math.sin((sliceAngle / 2) * Math.PI / 180) * .9 : widest;
    // Fill the safe radial band between Spheal and the rim before shrinking a reward.
    var availableHeight = Math.max(40, 2 * Math.min(labelRadius - 100, 268 - labelRadius));
    var fitScale = Math.min(1, wedgeChord / Math.max(widest, 1), availableHeight / Math.max(totalHeight, 1));
    fitScale = Math.max(.25, fitScale);

    var shorthand = svgElement("g", {
      class: "wheel-slice__shorthand wheel-slice__reward-stack",
      transform: "translate(" + position.x + " " + position.y + ") rotate(" + rotation + ") scale(" + fitScale + ")"
    });
    var cursorY = -totalHeight / 2;
    blocks.forEach(function (block) {
      if (block.kind === "divider") {
        var divider = svgElement("text", { class: "wheel-slice__plus wheel-slice__always-divider" + (block.isSecondaryOption ? " is-secondary-option" : ""), x: "0", y: String(cursorY + block.height / 2), "font-size": "16", "text-anchor": "middle", "dominant-baseline": "middle" });
        divider.textContent = "+";
        shorthand.appendChild(divider);
        cursorY += block.height + rowGap;
        return;
      }

      var cursorX = -block.width / 2;
      var rowGroup = svgElement("g", { class: block.isSecondaryOption ? "wheel-slice__option--secondary" : "" });
      block.specs.forEach(function (spec, index) {
        var itemY = cursorY + (block.height - spec.height) / 2;
        if (index) {
          var plus = svgElement("text", { class: "wheel-slice__plus", x: String(cursorX + block.plusWidth / 2), y: String(cursorY + block.height / 2), "font-size": "13", "text-anchor": "middle", "dominant-baseline": "middle" });
          plus.textContent = "+";
          rowGroup.appendChild(plus);
          cursorX += block.plusWidth + block.gap;
        }
        if (spec.kind === "custom-icon") {
          rowGroup.appendChild(svgElement("image", {
            class: "wheel-slice__icon wheel-slice__icon--custom", href: REWARDS.custom.image,
            x: String(cursorX), y: String(itemY), width: String(spec.iconSize), height: String(spec.iconSize), preserveAspectRatio: "xMidYMid slice"
          }));
        } else if (spec.kind === "number") {
          var amount = svgElement("text", { class: "wheel-slice__amount", x: String(cursorX + spec.numberWidth / 2), y: String(itemY + spec.height / 2), "font-size": String(spec.fontSize), "text-anchor": "middle", "dominant-baseline": "middle" });
          amount.textContent = String(spec.item.amount);
          rowGroup.appendChild(amount);
          var numericDefinition = REWARDS[spec.item.type];
          rowGroup.appendChild(svgElement("image", {
            class: "wheel-slice__icon wheel-slice__icon--" + (numericDefinition.crop || spec.item.type), href: numericDefinition.image,
            x: String(cursorX + spec.numberWidth + 4), y: String(itemY + (spec.height - spec.iconSize) / 2), width: String(spec.iconSize), height: String(spec.iconSize), preserveAspectRatio: "xMidYMid slice"
          }));
        } else {
          var definition = REWARDS[spec.item.type];
          spec.positions.forEach(function (iconPosition) {
            rowGroup.appendChild(svgElement("image", {
              class: "wheel-slice__icon wheel-slice__icon--" + (definition.crop || spec.item.type), href: definition.image,
              x: String(cursorX + iconPosition.x), y: String(itemY + iconPosition.y), width: String(spec.iconSize), height: String(spec.iconSize), preserveAspectRatio: "xMidYMid slice"
            }));
          });
        }
        cursorX += spec.width;
      });
      shorthand.appendChild(rowGroup);
      cursorY += block.height + rowGap;
    });
    group.appendChild(shorthand);
    return { node: shorthand, fitScale: fitScale };
  }

  function renderWheel(entries, winnerId) {
    dom.rotor.replaceChildren();

    var count = entries.length;
    if (!count) {
      dom.wheelDescription.textContent = "The wheel is empty. Add a reward to begin.";
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
      var radius = 276;
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

      var shape;
      if (count === 1) {
        shape = svgElement("circle", {
          class: "wheel-slice__shape",
          cx: "300",
          cy: "300",
          r: String(radius),
          fill: "url(#" + gradientId + ")"
        });
      } else {
        shape = svgElement("path", {
          class: "wheel-slice__shape",
          d: wedgePath(startAngle, endAngle, radius),
          fill: "url(#" + gradientId + ")"
        });
      }
      group.appendChild(shape);

      var displayRowCount = entry.kind === "structured" ? rewardDisplayRows(entry.reward).length : 0;
      var baseLabelRadius = displayRowCount >= 2 ? 184 : displayRowCount === 1 ? 220 : 238;
      var labelRadius = baseLabelRadius;
      var position = polar(labelRadius, centerAngle);
      // Local positive Y points toward the center button, making the lowest tier
      // rest against the wheel's visual floor on every wedge.
      var rotation = centerAngle + 90;
      // The winning wedge keeps its glow and accent rim but no longer grows: the size change
      // read as a distortion of the wheel rather than as emphasis.
      appendSvgShorthand(group, entry, position, rotation, count, 0, sliceAngle, labelRadius);
      dom.rotor.appendChild(group);
    });

    dom.rotor.style.transform = "rotate(" + state.rotation + "deg)";
    var selected = winnerId && entries.find(function (entry) { return entry.id === winnerId; });
    dom.wheelDescription.textContent = selected
      ? "The winning reward is " + entryLabel(selected) + "."
      : "A wheel with " + count + (count === 1 ? " equal reward." : " equal rewards.");
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
    placeholder.textContent = state.entries.length ? "Choose a reward" : "Add rewards first";
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
      empty.textContent = "No rewards yet.";
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
      row.style.setProperty("--entry-trim", visual.base);
      if (entry.id === state.riggedTargetId) row.classList.add("is-rigged-target");

      var number = document.createElement("span");
      number.className = "slice-index";
      number.textContent = String(index + 1).padStart(2, "0");

      var identity = document.createElement("div");
      identity.className = "slice-label-wrap";
      if (entry.kind === "structured") {
        appendRewardExpression(identity, entry.reward);
      } else {
        appendRewardExpressionItem(identity, component("custom", 1, entry.label));
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
      var edit = makeButton("icon-button", "✎", "Edit " + label, "edit");
      var down = makeButton("icon-button", "↓", "Move " + label + " down", "down");
      var remove = makeButton("icon-button icon-button--remove", "×", "Remove " + label, "remove");
      up.disabled = index === 0;
      down.disabled = index === state.entries.length - 1;
      // Grid auto-placement fills row-major, so this DOM order lays out as
      // up/edit on the top row and down/remove on the bottom row.
      actions.append(up, edit, down, remove);

      row.append(number, identity, actions);
      fragment.appendChild(row);
    });
    dom.sliceList.appendChild(fragment);
  }

  // This expression is deliberately separate from slice art: order rows stay readable
  // at normal text size while the wheel can keep its compact visual shorthand.
  function appendRewardExpression(container, reward) {
    var always = reward.always || [];
    var options = reward.options || [];
    if (always.length) appendRewardExpressionBranch(container, always);
    if (always.length && options.length) appendExpressionOperator(container, "+");
    if (options.length > 1 && always.length) appendExpressionOperator(container, "(");
    options.forEach(function (branch, index) {
      if (index) appendExpressionOperator(container, "OR");
      appendRewardExpressionBranch(container, branch);
    });
    if (options.length > 1 && always.length) appendExpressionOperator(container, ")");
  }

  function appendRewardExpressionBranch(container, branch) {
    branch.forEach(function (item, index) {
      if (index) appendExpressionOperator(container, "+");
      appendRewardExpressionItem(container, item);
    });
  }

  function appendExpressionOperator(container, text) {
    var operator = document.createElement("span");
    operator.className = "reward-expression__operator" + (text === "OR" ? " reward-expression__operator--or" : "");
    operator.textContent = text;
    container.appendChild(operator);
  }

  function appendRewardExpressionItem(container, item) {
    var token = document.createElement("span");
    token.className = "reward-expression__item";
    var amount = document.createElement("b");
    amount.textContent = String(item.amount);
    var image = document.createElement("img");
    image.src = REWARDS[item.type].image;
    image.alt = "";
    image.className = "reward-expression__icon reward-expression__icon--" + (REWARDS[item.type].crop || item.type);
    token.append(amount, image);
    if (item.type === "custom") {
      var customText = document.createElement("span");
      customText.textContent = item.text;
      token.appendChild(customText);
    }
    token.setAttribute("aria-label", componentWords(item, false));
    container.appendChild(token);
  }

  function presetActionButton(text, action, name, extraClass) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "small-button" + (extraClass ? " " + extraClass : "");
    button.dataset.action = action;
    button.textContent = text;
    button.setAttribute("aria-label", text + " saved wheel " + name);
    return button;
  }

  function renderWheelIdentity() {
    var theme = PRESET_THEMES[validIconKey(state.draftIdentity.iconKey) || "genex"];
    dom.wheelIdentityName.textContent = state.draftIdentity.name || "Custom Wheel";
    [dom.wheelIdentityIcon, dom.wheelIdentityIconEnd].forEach(function (icon) {
      icon.src = theme.image;
      icon.alt = "";
    });
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
    var fragment = document.createDocumentFragment();
    presetDisplayOrder().forEach(function (preset) {
      var theme = PRESET_THEMES[presetIconKey(preset)];
      var row = document.createElement("div");
      row.className = "saved-wheel-dock__item";
      row.setAttribute("role", "listitem");
      row.dataset.presetId = preset.id;
      row.style.setProperty("--preset-card-primary", theme.primary);
      var load = document.createElement("button");
      load.type = "button";
      load.className = "saved-wheel-dock__icon" + (state.draftIdentity.presetId === preset.id ? " is-active" : "");
      load.dataset.action = "load";
      load.setAttribute("aria-label", "Load " + preset.name);
      load.title = preset.name;
      var icon = document.createElement("img");
      icon.src = theme.image;
      icon.alt = "";
      load.appendChild(icon);
      var surface = document.createElement("div");
      surface.className = "saved-wheel-dock__surface";
      surface.setAttribute("role", "group");
      surface.setAttribute("aria-label", "Manage " + preset.name);
      var name = document.createElement("strong");
      name.textContent = preset.name;
      var input = document.createElement("input");
      input.className = "preset-name-input";
      input.type = "text";
      input.maxLength = MAX_LABEL_LENGTH;
      input.value = preset.name;
      input.autocomplete = "off";
      input.setAttribute("aria-label", "Rename preset " + preset.name);
      var count = document.createElement("span");
      count.className = "saved-wheel-dock__count";
      count.textContent = preset.entries.length + (preset.entries.length === 1 ? " reward" : " rewards");
      var actions = document.createElement("div");
      actions.className = "saved-wheel-dock__actions";
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
      if (state.draftIdentity.presetId === preset.id) actions.appendChild(presetActionButton("Save", "save", preset.name));
      surface.append(name, input, count, actions);
      row.append(load, surface);
      if (preset.builtinKey) {
        var pin = document.createElement("span");
        pin.className = "saved-wheel-dock__pin";
        pin.textContent = "Pinned";
        surface.appendChild(pin);
      }
      fragment.appendChild(row);
    });
    dom.presetList.appendChild(fragment);
  }

  function syncControls() {
    var count = state.entries.length;
    var atLimit = count >= MAX_ENTRIES;
    var builderOpen = Boolean(dom.rewardDialog && dom.rewardDialog.open);
    var composerTarget = builderOpen ? composerTargetInfo() : null;
    var sourceDisabled = builderOpen
      ? state.composerUnsupported || (!state.editingEntryId && atLimit) || !composerTarget.accepts
      : atLimit;
    dom.spinButton.disabled = count === 0;
    dom.spinCount.textContent = count ? count + (count === 1 ? " reward" : " rewards") : "No rewards";
    dom.entryTotal.textContent = count + " / " + MAX_ENTRIES;
    dom.emptyWheel.hidden = count !== 0;
    var quantity = state.quantity;
    dom.sharedQuantity.value = String(quantity);
    document.querySelectorAll("[data-reward]").forEach(function (button) {
      var definition = REWARDS[button.dataset.reward];
      var name = quantity === 1 ? (definition.shortSingular || definition.singular) : (definition.shortPlural || definition.plural);
      var action = rewardSourceActionLabel(quantity + " " + name, composerTarget, builderOpen);
      button.disabled = sourceDisabled;
      button.querySelector("span").textContent = String(quantity);
      button.setAttribute("aria-label", action);
      button.title = action;
    });
    var customTextReady = Boolean(cleanText(dom.customLabel.value, MAX_LABEL_LENGTH));
    var customAction = rewardSourceActionLabel("named custom reward", composerTarget, builderOpen);
    dom.customGemSubmit.disabled = sourceDisabled || !customTextReady;
    dom.customGemSubmit.querySelector("span").textContent = String(quantity);
    dom.customGemSubmit.setAttribute("aria-label", customTextReady ? customAction : "Enter custom reward text first");
    dom.customGemSubmit.title = customTextReady ? customAction : "Enter custom reward text first";
    dom.composerSubmit.disabled = state.composerUnsupported || (atLimit && !state.editingEntryId);
    renderRiggedControls();
  }

  function rewardSourceActionLabel(reward, target, builderOpen) {
    if (!builderOpen) return "Add one " + reward + " wheel reward";
    if (!target || !target.accepts) return target && target.message ? target.message : "Choose a component first";
    return target.mode === "edit"
      ? "Replace component " + (target.index + 1) + " with " + reward
      : "Add " + reward + " to component " + (target.index + 1);
  }

  function blankSimpleComposer() {
    return { tokens: [], relations: [null, null] };
  }

  function composerTargetInfo() {
    var simple = state.simpleComposer;
    if (!simple || state.composerUnsupported) return { accepts: false, message: "This reward cannot be edited here" };
    if (Number.isInteger(state.composerEditIndex) && simple.tokens[state.composerEditIndex]) {
      return { accepts: true, mode: "edit", index: state.composerEditIndex };
    }
    var nextIndex = simple.tokens.length;
    if (nextIndex >= 3) return { accepts: false, message: "Three components maximum" };
    if (nextIndex > 0 && !simple.relations[nextIndex - 1]) {
      return { accepts: false, message: "Choose AND or OR to continue" };
    }
    return { accepts: true, mode: "append", index: nextIndex };
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

  function simpleRewardButton(item, index) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "simple-slot__select";
    button.dataset.simpleSelect = String(index);
    button.setAttribute("aria-label", "Edit component " + (index + 1) + ": " + componentWords(item, false));
    button.title = "Edit " + componentWords(item, false);
    var image = document.createElement("img");
    image.src = REWARDS[item.type].image;
    image.alt = "";
    image.dataset.crop = REWARDS[item.type].crop || item.type;
    var amount = document.createElement("b");
    amount.className = "simple-slot__quantity";
    amount.textContent = String(item.amount);
    button.append(amount, image);
    return button;
  }

  function renderSimpleComposer() {
    dom.simpleExpression.replaceChildren();
    var simple = state.simpleComposer;
    var compatible = Boolean(simple);
    var target = composerTargetInfo();
    dom.composerSimple.classList.toggle("is-incompatible", !compatible);
    dom.composerSimple.classList.toggle("has-editing", Number.isInteger(state.composerEditIndex));

    for (let index = 0; index < 3; index += 1) {
      var item = compatible ? simple.tokens[index] : null;
      var slot = document.createElement("div");
      slot.className = "simple-slot";
      slot.dataset.slotIndex = String(index);
      if (item) slot.classList.add("is-filled");
      else if (compatible && target.accepts && target.mode === "append" && target.index === index) slot.classList.add("is-active");
      else slot.classList.add("is-locked");
      if (item) {
        slot.style.setProperty("--token-color", componentVisualColors(item)[0].color);
        if (state.composerEditIndex === index) slot.classList.add("is-editing");
        slot.appendChild(simpleRewardButton(item, index));
        var remove = makeButton("mini-icon mini-icon--remove simple-slot__remove", "×", "Remove " + componentWords(item, false), "simple-remove");
        remove.dataset.simpleIndex = String(index);
        slot.appendChild(remove);
      } else {
        var number = document.createElement("span");
        number.className = "simple-slot__number";
        number.textContent = String(index + 1).padStart(2, "0");
        slot.appendChild(number);
        var empty = document.createElement("span");
        empty.className = "simple-slot__empty";
        empty.textContent = slot.classList.contains("is-active") ? "+" : "×";
        slot.setAttribute("aria-label", slot.classList.contains("is-active")
          ? "Component " + (index + 1) + " is ready for a reward"
          : "Component " + (index + 1) + " is locked");
        slot.appendChild(empty);
      }
      dom.simpleExpression.appendChild(slot);

      if (index < 2) {
        var relation = document.createElement("div");
        relation.className = "simple-relation";
        relation.hidden = !compatible || !simple.tokens[index];
        relation.setAttribute("aria-label", "Connector after component " + (index + 1));
        ["and", "or"].forEach(function (kind) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "relation-button" + (simple && simple.relations[index] === kind ? " is-selected" : "");
          button.dataset.relationIndex = String(index);
          button.dataset.relation = kind;
          button.textContent = kind.toUpperCase();
          button.setAttribute("aria-label", kind === "and"
            ? "Make the next component guaranteed"
            : "Make the next component an alternative");
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
    if (primaryComponents(reward).length > 3) return "The primary wheel reward display can show at most three components.";
    if (!state.editingEntryId && state.entries.length >= MAX_ENTRIES) return "The wheel is limited to " + MAX_ENTRIES + " rewards.";
    return "";
  }

  function applyComposerComponent(item) {
    var target = composerTargetInfo();
    if (!target.accepts) return false;
    if (target.mode === "edit") state.simpleComposer.tokens[target.index] = item;
    else state.simpleComposer.tokens.push(item);
    state.composerEditIndex = target.mode === "edit" ? target.index : null;
    updateComposerFromSimple();
    renderComposer();
    return true;
  }

  function selectComposerComponent(index) {
    var item = state.simpleComposer && state.simpleComposer.tokens[index];
    if (!item) return;
    state.composerEditIndex = index;
    state.quantity = item.amount;
    dom.customLabel.value = item.type === "custom" ? item.text : "";
    persistState();
    renderComposer();
    window.requestAnimationFrame(function () { dom.sharedQuantity.focus(); });
  }

  function moveRewardSourceTo(target) {
    if (dom.rewardSource && target && dom.rewardSource.parentElement !== target) target.appendChild(dom.rewardSource);
  }

  function restoreRewardSource() {
    moveRewardSourceTo(dom.rewardSourceRail);
  }

  function renderComposer() {
    renderSimpleComposer();
    var validation = state.composerUnsupported
      ? "This saved reward uses more than the three visible components this builder supports."
      : composerValidationMessage();
    dom.composerValidation.textContent = validation;
    dom.composerSubmit.disabled = Boolean(validation);
    dom.composerReset.disabled = state.composerUnsupported;
    dom.composerSubmit.textContent = state.editingEntryId ? "Update wheel reward" : "Add reward to wheel";
    syncControls();
  }

  function resetComposer(close) {
    state.composer = { always: [], options: [] };
    state.simpleComposer = blankSimpleComposer();
    state.composerEditIndex = null;
    state.editingEntryId = null;
    state.composerUnsupported = false;
    renderComposer();
    if (close) {
      if (dom.rewardDialog && dom.rewardDialog.open) dom.rewardDialog.close();
      else dom.composer.hidden = true;
      dom.composerToggle.setAttribute("aria-expanded", "false");
    }
  }

  function handleRewardDialogClose() {
    // Closing by Escape or the × button must leave the saved entry untouched.
    restoreRewardSource();
    resetComposer(false);
    dom.composerToggle.setAttribute("aria-expanded", "false");
    window.requestAnimationFrame(function () { dom.composerToggle.focus(); });
  }

  function openComposer(entry) {
    if (entry) {
      state.composer = entry.kind === "structured"
        ? deepClone(entry.reward)
        : { always: [component("custom", 1, entry.label)], options: [] };
      state.simpleComposer = rewardToSimple(state.composer);
      state.editingEntryId = entry.id;
      state.composerUnsupported = !state.simpleComposer;
    } else {
      state.editingEntryId = null;
      state.simpleComposer = blankSimpleComposer();
      state.composer = { always: [], options: [] };
      state.composerUnsupported = false;
    }
    state.composerEditIndex = null;
    moveRewardSourceTo(dom.composerSourceMount);
    dom.composer.hidden = false;
    dom.composerToggle.setAttribute("aria-expanded", "true");
    renderComposer();
    if (dom.rewardDialog && typeof dom.rewardDialog.showModal === "function") dom.rewardDialog.showModal();
    syncControls();
    window.requestAnimationFrame(function () {
      dom.sharedQuantity.focus();
    });
  }

  function renderAll() {
    renderWheel(state.entries, null);
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
      setStatus("The wheel is limited to " + MAX_ENTRIES + " rewards.", "warning");
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
    if (active) setAdminPopoverOpen(false, false);
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

  function setAdminPopoverOpen(open, returnFocus) {
    if (!dom.adminPopover || !dom.adminToggle) return;
    var shouldOpen = Boolean(open) && state.phase === "setup";
    dom.adminPopover.hidden = !shouldOpen;
    dom.adminToggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      window.requestAnimationFrame(function () {
        var focusTarget = !dom.riggedWinner.disabled
          ? dom.riggedWinner
          : (!dom.riggedToggle.disabled ? dom.riggedToggle : dom.adminPopover);
        focusTarget.focus();
      });
    } else if (returnFocus) {
      window.requestAnimationFrame(function () { dom.adminToggle.focus(); });
    }
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
          emitSoundEvent("pointerTick", {
            rotation: state.rotation,
            velocity: motion.velocity,
            initialVelocity: SPIN_VELOCITY
          });
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

  // The spin button is invisible during the reveal, so leaving focus on it would strand the
  // focus ring on nothing. The plate takes focus instead and hands it back on exit.
  function focusResult() {
    if (typeof dom.resultCard.focus === "function") dom.resultCard.focus({ preventScroll: true });
  }

  function clearSnowTimers() {
    if (state.snowTimer) {
      window.clearTimeout(state.snowTimer);
      state.snowTimer = 0;
    }
    if (state.snowStopTimer) {
      window.clearTimeout(state.snowStopTimer);
      state.snowStopTimer = 0;
    }
  }

  function clearSnow() {
    clearSnowTimers();
    dom.snowField.classList.remove("is-active");
    dom.snowField.replaceChildren();
  }

  // Fades the field out and only then drops the flakes, so the loop never cuts mid-fall.
  function stopSnow() {
    clearSnowTimers();
    if (!dom.snowField.classList.contains("is-active")) {
      dom.snowField.replaceChildren();
      return;
    }
    dom.snowField.classList.remove("is-active");
    state.snowStopTimer = window.setTimeout(function () {
      state.snowStopTimer = 0;
      dom.snowField.replaceChildren();
    }, SNOW_FADE_MS);
  }

  // The snow is the visual half of the victory cue, so it ends when the music does.
  function scheduleSnowStop(duration) {
    if (state.snowStopTimer) {
      window.clearTimeout(state.snowStopTimer);
      state.snowStopTimer = 0;
    }
    state.snowStopTimer = window.setTimeout(function () {
      state.snowStopTimer = 0;
      if (state.phase === "result") stopSnow();
    }, Math.max(1200, duration || MUSIC_FALLBACK_MS));
  }

  // The burst is the reaction to winning; the snow is the state you sit in afterwards. Both
  // draw from the same weighted pool, so what drifts past is still what you actually won.
  // It loops for as long as the result is up, because the result no longer times out.
  function startSnow(entry, reducedMotion) {
    clearSnow();
    if (reducedMotion) return;
    state.snowTimer = window.setTimeout(function () {
      state.snowTimer = 0;
      if (state.phase !== "result") return;
      var groups = particleComponents(entry);
      var pool = groups.primary.concat(groups.optional);
      if (!pool.length) return;
      for (var index = 0; index < SNOW_COUNT; index += 1) {
        var item = weightedParticlePick(pool);
        var definition = REWARDS[item.type];
        var flake = document.createElement("img");
        flake.className = "snow-flake snow-flake--" + (definition.crop || item.type);
        flake.src = definition.image;
        flake.alt = "";
        flake.style.left = (Math.random() * 100).toFixed(2) + "%";
        flake.style.setProperty("--flake-size", (16 + rewardTierScale(item) * 26).toFixed(0) + "px");
        flake.style.setProperty("--flake-sway", ((Math.random() - .5) * 90).toFixed(0) + "px");
        flake.style.setProperty("--flake-turn", ((Math.random() - .5) * 220).toFixed(0) + "deg");
        flake.style.setProperty("--flake-opacity", (.3 + Math.random() * .4).toFixed(2));
        flake.style.setProperty("--flake-duration", (7000 + Math.random() * 7000).toFixed(0) + "ms");
        // Negative delays start the field mid-fall, so snow is already in the air rather
        // than arriving as one visible wave from the top edge.
        flake.style.setProperty("--flake-delay", (-Math.random() * 14000).toFixed(0) + "ms");
        dom.snowField.appendChild(flake);
      }
      dom.snowField.classList.add("is-active");
    }, SNOW_START_MS);
  }

  function weightedParticlePick(items) {
    var total = items.reduce(function (sum, item) { return sum + Math.max(1, componentPrecedence(item)); }, 0);
    var cursor = Math.random() * total;
    for (var index = 0; index < items.length; index += 1) {
      cursor -= Math.max(1, componentPrecedence(items[index]));
      if (cursor <= 0) return items[index];
    }
    return items[items.length - 1];
  }

  function particleGroup(items, count) {
    if (!items.length || !count) return [];
    var particles = items.slice(0, Math.min(items.length, count));
    while (particles.length < count) particles.push(weightedParticlePick(items));
    return particles;
  }

  function particleComponents(entry) {
    if (entry.kind !== "structured") return { primary: [component("custom", 1, entry.label)], optional: [] };
    var always = (entry.reward.always || []).slice();
    var options = entry.reward.options || [];
    var primaryIndex = primaryOptionIndex(entry.reward);
    if (always.length) {
      return { primary: always, optional: options.reduce(function (all, branch) { return all.concat(branch); }, []) };
    }
    return {
      primary: primaryIndex >= 0 ? options[primaryIndex].slice() : [],
      optional: options.reduce(function (all, branch, index) { return index === primaryIndex ? all : all.concat(branch); }, [])
    };
  }

  function clearWinnerParticles() {
    dom.winnerParticles.replaceChildren();
  }

  // The 60/40 split is category-based: guaranteed/highest-priority rewards dominate the
  // shower, while every alternate branch still receives at least one visible token.
  //
  // Tokens erupt from along the landed wedge's own outer arc rather than from a single
  // point at the top of the shell, arc up and fall away under a two-stage ease. The count
  // is deliberately low: the burst has to read as "this is what you won", which it cannot
  // do when tokens overlap each other and the plate.
  function createWinnerParticles(entry, sliceCount) {
    clearWinnerParticles();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var groups = particleComponents(entry);
    var total = PARTICLE_COUNT;
    var primaryCount = groups.optional.length ? Math.round(total * .6) : total;
    if (!groups.primary.length) primaryCount = 0;
    var optionalCount = total - primaryCount;
    if (!groups.optional.length) optionalCount = 0;
    if (!primaryCount && groups.optional.length) optionalCount = total;
    var particles = particleGroup(groups.primary, primaryCount).concat(particleGroup(groups.optional, optionalCount));

    // The landed wedge always sits under the pointer, so its arc spans the top of the
    // shell. Travel is derived from the shell's measured radius, which is what keeps the
    // burst inside the reveal area instead of being silently clipped by the circular mask.
    var shellSize = dom.wheelShell.getBoundingClientRect().width || 600;
    var unit = shellSize / 600;
    var radius = shellSize / 2;
    var halfSlice = Math.min(30, 180 / Math.max(1, sliceCount || 1));

    particles.sort(function () { return Math.random() - .5; }).forEach(function (item, index) {
      var definition = REWARDS[item.type];
      var token = document.createElement("img");
      token.className = "winner-particle winner-particle--" + (definition.crop || item.type);
      token.src = definition.image;
      token.alt = "";
      token.style.setProperty("--particle-size", ((24 + rewardTierScale(item) * 34) * unit).toFixed(0) + "px");

      var emitAngle = -90 + (Math.random() - .5) * 2 * halfSlice;
      var emitRadians = emitAngle * Math.PI / 180;
      var emitRadius = 258 + Math.random() * 30;
      var originX = Math.cos(emitRadians) * emitRadius * unit;
      var originY = Math.sin(emitRadians) * emitRadius * unit;
      token.style.left = (50 + (emitRadius * Math.cos(emitRadians)) / 6).toFixed(2) + "%";
      token.style.top = (50 + (emitRadius * Math.sin(emitRadians)) / 6).toFixed(2) + "%";

      // Fan outward from the rim, then fall. Travel is pulled back until the landing point
      // sits inside the circular mask, so no token is ever clipped away mid-flight.
      var spread = (Math.random() - .5) * 1.9;
      var reach = radius * (.24 + Math.random() * .34);
      var rise = radius * (.1 + Math.random() * .16);
      var drop = radius * (.5 + Math.random() * .42);
      var turn = (Math.random() - .5) * 300;
      var endX = Math.cos(emitRadians + spread) * reach;
      var endY = drop;
      var limit = radius * .9;
      while (Math.hypot(originX + endX, originY + endY) > limit && Math.abs(endX) + Math.abs(endY) > 1) {
        endX *= .92;
        endY *= .92;
      }
      token.style.setProperty("--particle-apex-x", (endX * .45).toFixed(0) + "px");
      token.style.setProperty("--particle-apex-y", (-rise).toFixed(0) + "px");
      token.style.setProperty("--particle-end-x", endX.toFixed(0) + "px");
      token.style.setProperty("--particle-end-y", endY.toFixed(0) + "px");
      token.style.setProperty("--particle-turn-apex", (turn * .3).toFixed(0) + "deg");
      token.style.setProperty("--particle-turn", turn.toFixed(0) + "deg");
      token.style.setProperty("--particle-duration", (1400 + Math.random() * 600).toFixed(0) + "ms");
      token.style.setProperty("--particle-delay", (Math.random() * PARTICLE_STAGGER_MS).toFixed(0) + "ms");
      dom.winnerParticles.appendChild(token);
    });
  }

  function hexToRgba(hex, alpha) {
    var numeric = parseInt(hex.slice(1), 16);
    var red = (numeric >> 16) & 255;
    var green = (numeric >> 8) & 255;
    var blue = numeric & 255;
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function htmlComponent(item, size, isHero) {
    var wrapper = document.createElement("span");
    wrapper.className = "reward-token reward-token--" + (size || "result") + (isHero ? " reward-token--hero" : "");
    wrapper.dataset.rewardType = item.type;
    var amount = document.createElement("b");
    amount.textContent = String(item.amount);
    wrapper.appendChild(amount);
    var definition = REWARDS[item.type];
    var image = document.createElement("img");
    image.src = definition.image;
    image.alt = "";
    image.className = "reward-token__image reward-token__image--" + (definition.crop || item.type);
    wrapper.appendChild(image);
    var words = document.createElement("span");
    words.textContent = item.type === "custom" ? item.text : (item.amount === 1 ? definition.singular : definition.plural);
    // "compact" and "or" are icon-led: the art already names the reward, so repeating it in
    // words is noise. Custom rewards are the exception — their text is the only label there is.
    if ((size !== "compact" && size !== "or") || item.type === "custom") wrapper.appendChild(words);
    wrapper.setAttribute("aria-label", componentWords(item, false));
    return wrapper;
  }

  // The hero mirrors the wheel slice's own layout rules — a bare icon for one, the same
  // 2 / 2+1 / 2x2 cluster up to four, a count beside a single icon beyond that — but at full
  // size, with none of the slice's shrink-to-fit scaling. No numeral and no label on the art
  // itself; the wording lives in the helper line underneath.
  function heroCluster(item) {
    var definition = REWARDS[item.type];
    var wrapper = document.createElement("span");
    // Drives --reward-text, so a count is tinted by its own reward rather than by whatever
    // else happens to share the slice.
    wrapper.dataset.rewardType = item.type;

    function icon() {
      var frame = document.createElement("span");
      var crop = definition.crop || item.type;
      frame.className = "hero-icon-frame hero-icon-frame--" + crop;
      // Reuse the reward art as a CSS mask so the highlight follows the icon silhouette,
      // rather than sweeping a rectangular glare across the winning reward panel.
      frame.style.setProperty("--hero-icon-mask", "url(\"" + definition.image + "\")");
      var image = document.createElement("img");
      image.src = definition.image;
      image.alt = "";
      image.className = "hero-icon hero-icon--" + crop;
      frame.appendChild(image);
      return frame;
    }

    if (item.amount > 4 || (item.type !== "custom" && item.amount > 1 && usesNumericRewardDisplay(item))) {
      wrapper.className = "hero-unit hero-unit--counted";
      var count = document.createElement("b");
      count.textContent = String(item.amount);
      wrapper.appendChild(count);
      wrapper.appendChild(icon());
    } else {
      var total = item.type === "custom" ? 1 : item.amount;
      wrapper.className = "hero-unit hero-unit--cluster hero-cluster--" + total;
      for (var index = 0; index < total; index += 1) wrapper.appendChild(icon());
    }
    wrapper.setAttribute("aria-label", componentWords(item, false));
    return wrapper;
  }

  function appendHeroBranch(container, branch) {
    sortedComponents(branch).forEach(function (item, index) {
      if (index) {
        var plus = document.createElement("span");
        plus.className = "hero-plus";
        plus.textContent = "+";
        container.appendChild(plus);
      }
      container.appendChild(heroCluster(item));
    });
  }

  // Only custom rewards get a helper line. For catalogue rewards the hero art already says
  // both which reward and how many, so a caption under it just restates the picture.
  function appendHelperBranch(container, branch) {
    var custom = sortedComponents(branch).filter(function (item) { return item.type === "custom"; });
    custom.forEach(function (item, index) {
      if (index) {
        var plus = document.createElement("span");
        plus.className = "reward-plus";
        plus.textContent = "+";
        container.appendChild(plus);
      }
      var words = document.createElement("span");
      words.className = "result-helper__text";
      words.textContent = item.text;
      container.appendChild(words);
    });
    return custom.length;
  }

  function appendHtmlBranch(container, branch, size, emphasizeHighest) {
    sortedComponents(branch).forEach(function (item, index) {
      if (index) {
        var plus = document.createElement("span");
        plus.className = "reward-plus";
        plus.textContent = "+";
        container.appendChild(plus);
      }
      container.appendChild(htmlComponent(item, size, Boolean(emphasizeHighest && index === 0)));
    });
  }

  function renderResultCard(entry) {
    dom.resultPrimary.replaceChildren();
    dom.resultAlternatives.replaceChildren();
    dom.resultCard.setAttribute("aria-label", "Winning reward: " + entryLabel(entry));

    var headline = entry.kind === "structured"
      ? primaryComponents(entry.reward)
      : [component("custom", 1, entry.label)];

    var hero = document.createElement("div");
    hero.className = "result-hero";
    appendHeroBranch(hero, headline);
    dom.resultPrimary.appendChild(hero);

    var helper = document.createElement("p");
    helper.className = "result-helper";
    if (appendHelperBranch(helper, headline)) dom.resultPrimary.appendChild(helper);

    if (entry.kind === "structured") {
      // The plate carries only the winning slice's own reward. What could have been won
      // stays legible on the dimmed wheel behind it, so nothing competes with this.
      var primaryIndex = primaryOptionIndex(entry.reward);
      (entry.reward.options || []).forEach(function (branch, index) {
        if (index === primaryIndex) return;
        var line = document.createElement("p");
        line.className = "result-alternative";
        var marker = document.createElement("span");
        marker.className = "result-alternative__marker";
        marker.textContent = "or";
        line.appendChild(marker);
        appendHtmlBranch(line, branch, "or");
        line.setAttribute("aria-label", "Alternative: " + branch.map(function (item) {
          return componentWords(item, false);
        }).join(" and "));
        dom.resultAlternatives.appendChild(line);
      });
    }

    dom.resultCard.setAttribute("aria-hidden", "false");
    fitResultCard();
  }

  // A four-icon cluster per component, several components wide, can outgrow the plate. The
  // plate is a fixed share of the wheel by design, so the contents scale to it rather than
  // the other way round.
  function fitResultCard() {
    dom.resultCard.style.removeProperty("--result-fit");
    var available = dom.resultCard.clientHeight - 48;
    var widthAvailable = dom.resultCard.clientWidth - 60;
    if (available <= 0 || widthAvailable <= 0) return;

    function overflowRatio() {
      var hero = dom.resultPrimary.querySelector(".result-hero");
      var content = dom.resultPrimary.scrollHeight + dom.resultAlternatives.scrollHeight;
      // The hero row is measured directly: as a nowrap flex row it can be wider than the
      // column that holds it, and that overflow is exactly what needs scaling.
      var widest = Math.max(
        dom.resultPrimary.scrollWidth,
        dom.resultAlternatives.scrollWidth,
        hero ? hero.scrollWidth : 0
      );
      if (!content || !widest) return 1;
      return Math.min(1, available / content, widthAvailable / widest);
    }

    // Two passes: not everything in the plate scales with the factor (flex gaps round, the
    // "+" carries its own metrics), so one pass can leave a few pixels of overhang. The
    // second pass measures what the first actually produced and closes the gap.
    var fit = overflowRatio();
    if (fit >= 1) return;
    dom.resultCard.style.setProperty("--result-fit", fit.toFixed(3));
    var refine = overflowRatio();
    if (refine < 1) fit *= refine;
    dom.resultCard.style.setProperty("--result-fit", Math.max(.2, fit).toFixed(3));
  }

  function armSpin() {
    if (state.phase !== "setup" || !state.entries.length) return;
    audioController.unlock();
    state.phase = "armed";
    setCinematic(true);
    dom.spinButton.setAttribute("aria-label", "Start the spin");
    dom.spinButton.focus();
    emitSoundEvent("spinArm");
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

    audioController.unlock();
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
    renderWheel(snapshot, null);
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
    document.body.style.setProperty("--winner-accent", accentFor(winner));
    emitSoundEvent("winnerLand", { entry: cloneEntries([winner], false)[0], index: winnerIndex });

    // A brief beat to register the stop, then the reveal takes over immediately.
    await delay(reducedMotion ? 60 : LANDING_HOLD_MS);
    // The losing slices desaturate rather than being covered, so the wheel stays on screen
    // and the result reads as coming out of the slice that produced it.
    document.body.classList.add("is-revealing");
    renderWheel(snapshot, winner.id);
    renderResultCard(winner);
    clearRigging();
    state.phase = "result";
    dom.spinButton.setAttribute("aria-label", "Dismiss result");
    // The burst fires from the wedge first, then the plate unfurls out of it — the reward
    // reads as coming from the slice rather than arriving on top of it.
    createWinnerParticles(winner, snapshot.length);
    emitSoundEvent("winnerReveal", { entry: cloneEntries([winner], false)[0], index: winnerIndex });
    if (!reducedMotion) await delay(PLATE_UNFURL_DELAY_MS);
    if (state.phase !== "result") return;
    document.body.classList.add("is-result");
    focusResult();
    startSnow(winner, reducedMotion);
    audioController.playMusic(0).then(function (musicDuration) {
      if (state.phase === "result") scheduleSnowStop(musicDuration || MUSIC_FALLBACK_MS);
    });
    dom.resultAnnouncement.textContent = "Winning reward: " + entryLabel(winner) + ". Click anywhere or press any key to return to setup.";
  }

  // The exit runs the reveal backwards: the plate folds back toward the wedge it came from,
  // the wedge contracts, and the rotor eases to zero along the shorter arc instead of
  // teleporting there. "exiting" blocks re-entry while that plays out.
  async function exitResult() {
    if (state.phase !== "result") return;
    var winner = state.spinSnapshot && state.spinSnapshot[state.winnerIndex];
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.phase = "exiting";
    stopSnow();
    clearWinnerParticles();
    emitSoundEvent("exitResult", { entry: winner ? cloneEntries([winner], false)[0] : null });
    document.body.classList.remove("is-result");

    if (!reducedMotion) {
      await delay(EXIT_PLATE_MS);
      document.body.classList.remove("is-revealing");
      // Dropped off the existing nodes so the slices ease back to full colour across the
      // settle. Waiting for the rebuild at the end of exit would restore them in one frame.
      dom.rotor.querySelectorAll(".wheel-slice").forEach(function (group) {
        group.classList.remove("is-dimmed", "is-winner");
      });
      var settleFrom = state.rotation;
      var offset = normalizeAngle(settleFrom);
      var settleTo = offset > 180 ? settleFrom + (360 - offset) : settleFrom - offset;
      await animateValue(0, 1, EXIT_SETTLE_MS, easeOutCubic, function (value) {
        setRotation(settleFrom + (settleTo - settleFrom) * value);
      });
    }

    state.phase = "setup";
    state.rotation = 0;
    state.spinSnapshot = null;
    state.winnerIndex = -1;
    state.spinMotion = null;
    clearSnow();
    document.body.classList.remove("is-result", "is-revealing", "has-winner", "is-spinning");
    document.body.style.removeProperty("--winner-glow");
    document.body.style.removeProperty("--winner-accent");
    setCinematic(false);
    renderWheel(state.entries, null);
    syncControls();
    dom.spinButton.setAttribute("aria-label", "Spin the wheel");
    dom.resultAnnouncement.textContent = "";
    // Handed back only once focus has somewhere visible to land, so the plate is never
    // aria-hidden while it still holds focus.
    window.requestAnimationFrame(function () {
      dom.spinButton.focus();
      dom.resultCard.setAttribute("aria-hidden", "true");
    });
    setStatus("Returned to setup. Your wheel is unchanged.");
  }

  document.querySelectorAll("[data-reward]").forEach(function (button) {
    button.addEventListener("click", function () {
      var type = button.dataset.reward;
      var item = component(type, state.quantity);
      if (dom.rewardDialog.open) {
        if (applyComposerComponent(item) && item.type !== "custom") {
          dom.customLabel.value = "";
          syncControls();
        }
        return;
      }
      audioController.unlock();
      var entry = structuredEntry([item], []);
      if (addEntry(entry)) {
        commitChange(entryLabel(entry) + " added as one wheel reward.");
        emitSoundEvent("rewardAdded");
      }
    });
  });

  dom.sharedQuantity.addEventListener("input", function () {
    var quantity = Number(dom.sharedQuantity.value);
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_ENTRIES) {
      state.quantity = quantity;
      persistState();
      if (dom.rewardDialog.open && Number.isInteger(state.composerEditIndex)) {
        var selected = state.simpleComposer.tokens[state.composerEditIndex];
        if (selected) {
          selected.amount = quantity;
          updateComposerFromSimple();
          renderComposer();
          return;
        }
      }
      syncControls();
    }
  });

  dom.sharedQuantity.addEventListener("change", function () {
    var quantity = Number(dom.sharedQuantity.value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ENTRIES) {
      state.quantity = 1;
      setStatus("Quantity reset to 1. Use a whole number from 1 to " + MAX_ENTRIES + ".", "warning");
      persistState();
      if (dom.rewardDialog.open && Number.isInteger(state.composerEditIndex)) {
        var selected = state.simpleComposer.tokens[state.composerEditIndex];
        if (selected) {
          selected.amount = 1;
          updateComposerFromSimple();
          renderComposer();
          return;
        }
      }
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
    var item = component("custom", state.quantity, label);
    if (dom.rewardDialog.open) {
      var wasEditingComponent = Number.isInteger(state.composerEditIndex);
      if (applyComposerComponent(item)) {
        if (!wasEditingComponent) {
          dom.customLabel.value = "";
          syncControls();
        }
        dom.customLabel.focus();
      }
      return;
    }
    audioController.unlock();
    var entry = structuredEntry([item], []);
    if (!addEntry(entry)) return;
    dom.customLabel.value = "";
    commitChange(entryLabel(entry) + " added as one wheel reward.");
    emitSoundEvent("rewardAdded");
    dom.customLabel.focus();
  });
  dom.customLabel.addEventListener("input", syncControls);

  dom.composerToggle.addEventListener("click", function () {
    if (!dom.rewardDialog.open) openComposer(null);
    else resetComposer(true);
  });
  dom.composerClose.addEventListener("click", function () { resetComposer(true); });
  dom.composerReset.addEventListener("click", function () { resetComposer(false); });
  dom.simpleExpression.addEventListener("click", function (event) {
    var relationButton = event.target.closest("[data-relation-index]");
    if (relationButton && state.simpleComposer) {
      state.simpleComposer.relations[Number(relationButton.dataset.relationIndex)] = relationButton.dataset.relation;
      state.composerEditIndex = null;
      dom.customLabel.value = "";
      updateComposerFromSimple();
      renderComposer();
      return;
    }
    var selectButton = event.target.closest("[data-simple-select]");
    if (selectButton && state.simpleComposer) {
      selectComposerComponent(Number(selectButton.dataset.simpleSelect));
      return;
    }
    var removeButton = event.target.closest("[data-action='simple-remove']");
    if (!removeButton || !state.simpleComposer) return;
    var removeIndex = Number(removeButton.dataset.simpleIndex);
    state.simpleComposer.tokens.splice(removeIndex, 1);
    if (removeIndex === 0) state.simpleComposer.relations.shift();
    else state.simpleComposer.relations.splice(removeIndex - 1, 1);
    while (state.simpleComposer.relations.length < 2) state.simpleComposer.relations.push(null);
    state.composerEditIndex = null;
    dom.customLabel.value = "";
    updateComposerFromSimple();
    renderComposer();
  });
  dom.composerSubmit.addEventListener("click", function () {
    var validation = state.composerUnsupported
      ? "This saved reward cannot be edited in the three-component builder."
      : composerValidationMessage();
    if (validation) {
      dom.composerValidation.textContent = validation;
      return;
    }
    var reward = composerReward();
    if (state.editingEntryId) {
      var index = state.entries.findIndex(function (entry) { return entry.id === state.editingEntryId; });
      if (index >= 0) state.entries[index] = { id: state.editingEntryId, kind: "structured", reward: reward };
      commitChange("Wheel reward updated.");
    } else {
      audioController.unlock();
      var entry = structuredEntry(reward.always, reward.options);
      if (!addEntry(entry)) return;
      commitChange(entryLabel(entry) + " added as one wheel reward.");
      emitSoundEvent("rewardAdded");
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
      state.riggedEnabled = true;
    } else {
      state.riggedTargetId = null;
      state.riggedEnabled = false;
    }
    renderSliceList();
    syncControls();
  });

  dom.riggedToggle.addEventListener("change", function () {
    state.riggedEnabled = dom.riggedToggle.checked && Boolean(state.riggedTargetId);
    syncControls();
    setStatus(state.riggedEnabled ? "Rigged target enabled for the next spin." : "Rigged mode disabled.");
  });

  var armedRemoveButton = null;
  var armedRemoveTimer = null;

  function disarmRemoveButton() {
    if (!armedRemoveButton) return;
    armedRemoveButton.classList.remove("is-armed");
    armedRemoveButton.setAttribute("aria-label", armedRemoveButton.dataset.defaultLabel);
    armedRemoveButton = null;
    clearTimeout(armedRemoveTimer);
    armedRemoveTimer = null;
  }

  function armRemoveButton(button, label) {
    disarmRemoveButton();
    button.dataset.defaultLabel = button.getAttribute("aria-label");
    button.classList.add("is-armed");
    button.setAttribute("aria-label", "Click again to remove " + label);
    armedRemoveButton = button;
    armedRemoveTimer = setTimeout(disarmRemoveButton, 2500);
  }

  dom.sliceList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var row = button.closest("[data-entry-id]");
    var index = state.entries.findIndex(function (entry) { return entry.id === row.dataset.entryId; });
    if (index < 0) return;
    var entry = state.entries[index];
    var action = button.dataset.action;

    if (action === "remove" || action === "up" || action === "down") audioController.unlock();

    if (action !== "remove") disarmRemoveButton();

    if (action === "edit") {
      openComposer(entry);
      return;
    }

    if (action === "remove") {
      var label = entryLabel(entry);
      if (button !== armedRemoveButton) {
        armRemoveButton(button, label);
        return;
      }
      disarmRemoveButton();
      state.entries.splice(index, 1);
      if (entry.id === state.riggedTargetId) clearRigging();
      commitChange(label + " removed.");
      emitSoundEvent("rewardRemoved");
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
    emitSoundEvent("rewardMoved", { direction: action });
    focusRowAction(entry.id, action);
  });

  dom.newWheelButton.addEventListener("click", async function (event) {
    event.preventDefault();
    var canReplace = !isDraftDirty() || await requestConfirmation({
      message: "Any unsaved progress will be lost",
      confirmLabel: "New wheel"
    });
    if (!canReplace) return;
    dom.newWheelName.value = nextNewWheelName();
    dom.newWheelValidation.textContent = "";
    dom.newWheelDialog.showModal();
    window.requestAnimationFrame(function () { dom.newWheelName.select(); });
  });

  dom.newWheelCancel.addEventListener("click", function () { dom.newWheelDialog.close(); });
  dom.newWheelForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = cleanText(dom.newWheelName.value, MAX_LABEL_LENGTH);
    if (!name) {
      dom.newWheelValidation.textContent = "Enter a wheel name.";
      dom.newWheelName.focus();
      return;
    }
    if (findPresetByName(name)) {
      dom.newWheelValidation.textContent = "A saved wheel already uses that name.";
      dom.newWheelName.focus();
      return;
    }
    var selectedIcon = dom.newWheelForm.querySelector("input[name='newWheelIcon']:checked").value;
    var created = {
      id: createId("preset"),
      name: name,
      entries: [],
      updatedAt: Date.now(),
      builtinKey: null,
      iconKey: selectedIcon
    };
    state.presets.push(created);
    state.entries = [];
    state.draftIdentity = { presetId: created.id, name: created.name, iconKey: created.iconKey };
    clearRigging();
    dom.newWheelDialog.close();
    commitChange(name + " created and ready to build.");
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
      // Unlock before a confirmation dialog awaits, while this click is still a trusted gesture.
      audioController.unlock();
      var canLoad = !isDraftDirty() || await requestConfirmation({
        message: "Any unsaved progress will be lost",
        confirmLabel: "Load preset"
      });
      if (!canLoad) return;
      state.entries = cloneEntries(preset.entries, false);
      state.draftIdentity = { presetId: preset.id, name: preset.name, iconKey: presetIconKey(preset) };
      clearRigging();
      commitChange(preset.name + " loaded.");
      emitSoundEvent("presetLoaded");
      return;
    }

    if (action === "save") {
      if (state.draftIdentity.presetId !== preset.id) return;
      preset.entries = cloneEntries(state.entries, false);
      preset.updatedAt = Date.now();
      commitChange(preset.name + " saved.");
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
        message: "This wheel will be permanently deleted.",
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
  dom.soundToggle.addEventListener("click", function () {
    state.soundEnabled = !state.soundEnabled;
    persistSoundPreference();
    audioController.setEnabled(state.soundEnabled);
    syncSoundToggle();
  });
  dom.adminToggle.addEventListener("click", function () {
    setAdminPopoverOpen(dom.adminPopover.hidden, false);
  });
  dom.confirmDialog.addEventListener("close", handleDialogClose);
  dom.rewardDialog.addEventListener("close", handleRewardDialogClose);

  window.addEventListener("click", function (event) {
    if (!dom.adminPopover.hidden && !event.target.closest(".utility-chips--left")) {
      setAdminPopoverOpen(false, false);
    }
    if (isUtilityControl(event.target)) return;
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
    if (!dom.adminPopover.hidden && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setAdminPopoverOpen(false, true);
      return;
    }
    if (isUtilityControl(event.target)) return;
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
  hydrateSoundPreference();
  syncSoundToggle();
  bindSoundEvents();
  renderAll();
  if (initialNotice) setStatus(initialNotice, "warning", 0);
}());

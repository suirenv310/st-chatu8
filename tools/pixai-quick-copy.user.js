// ==UserScript==
// @name         PixAI Quick Copy v4.1 - st-chatu8
// @namespace    st-chatu8.pixai
// @version      4.1.0
// @description  Copy PixAI Editor model, LoRAs, weights and generation settings into st-chatu8.
// @match        https://pixai.art/*
// @match        https://www.pixai.art/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCHEMA = 'st-chatu8.pixai-quick-copy';
  const VERSION = 1;
  const TOOLBAR_ID = 'pixai-quick-copy-v41';
  const MODEL_PATH = /\/model\/(\d+)\/(\d+)(?:\/|$)/;

  const clean = value =>
    String(value ?? '').replace(/\s+/g, ' ').trim();

  const normalize = value =>
    clean(value).toLowerCase();

  const numeric = value => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  function toast(message) {
    document.getElementById('pixai-v41-toast')?.remove();

    const el = document.createElement('div');
    el.id = 'pixai-v41-toast';
    el.textContent = message;

    Object.assign(el.style, {
      position: 'fixed',
      bottom: '110px',
      right: '20px',
      zIndex: '2147483647',
      background: '#29252f',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: '10px',
      boxShadow: '0 5px 20px #0006',
      font: '13px system-ui',
      maxWidth: '360px'
    });

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function copy(value, message = 'Copied!') {
    GM_setClipboard(
      typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2),
      'text'
    );

    toast(message);
  }

  function parseModelLink(href) {
    try {
      const url = new URL(href, location.href);

      if (!/(^|\.)pixai\.art$/.test(url.hostname)) {
        return null;
      }

      const match = url.pathname.match(MODEL_PATH);
      if (!match) return null;

      return {
        modelId: match[1],
        versionId: match[2],
        url: url.href
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // LoRA
  // ============================================================

  function getCard(input) {
    let element = input.parentElement;

    for (let i = 0; i < 10 && element; i++) {
      const link = element.querySelector(
        'a[href*="/model/"]'
      );

      if (
        link &&
        element.querySelector('input[type="number"]')
      ) {
        return element;
      }

      element = element.parentElement;
    }

    return null;
  }

  function isWeightInput(input) {
    if (input.type !== 'number') return false;

    const parent = input.closest(
      '[role="group"],label'
    );

    const label = normalize(
      input.getAttribute('aria-label') ||
      parent?.getAttribute('aria-label') ||
      parent?.innerText ||
      input.parentElement?.innerText
    );

    if (/weight|trọng lượng|strength/.test(label)) {
      return true;
    }

    const card = getCard(input);

    return Boolean(
      card &&
      card.querySelector('a[href*="/model/"]') &&
      card.querySelector(
        '[role="slider"],input[type="range"]'
      )
    );
  }

  function readLoras() {
    const results = [];
    const seen = new Set();

    const inputs = document.querySelectorAll(
      'input[type="number"]'
    );

    for (const input of inputs) {
      if (!isWeightInput(input)) continue;

      const card = getCard(input);
      if (!card) continue;

      const link = card.querySelector(
        'a[href*="/model/"]'
      );

      if (!link) continue;

      const ids = parseModelLink(link.href);
      if (!ids) continue;

      const weight = numeric(input.value);

      if (weight === undefined) continue;
      if (seen.has(ids.versionId)) continue;

      seen.add(ids.versionId);

      const name = clean(
        link.getAttribute('aria-label') ||
        card.querySelector(
          'a[href*="/model/"][aria-label]'
        )?.getAttribute('aria-label') ||
        link.textContent ||
        'Unknown LoRA'
      );

      results.push({
        modelId: ids.versionId,
        weight,
        name,
        sourceModelId: ids.modelId
      });
    }

    return results;
  }

  // ============================================================
  // MODEL
  // ============================================================

  function currentModelLinks() {
    const links = [
      ...document.querySelectorAll(
        'a[href*="/model/"]'
      )
    ];

    const loraIds = new Set(
      readLoras().map(item => item.modelId)
    );

    const candidates = [];
    const seen = new Set();

    for (const link of links) {
      if (link.closest('#' + TOOLBAR_ID)) {
        continue;
      }

      const ids = parseModelLink(link.href);

      if (!ids?.versionId) continue;

      // Exclude LoRA version IDs.
      if (loraIds.has(ids.versionId)) continue;

      const name = clean(
        link.getAttribute('aria-label') ||
        link.textContent
      );

      const key = ids.versionId + ':' + name;

      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        element: link,
        modelId: ids.modelId,
        versionId: ids.versionId,
        name
      });
    }

    return candidates;
  }

  function readModel() {
    const candidates = currentModelLinks();

    if (!candidates.length) {
      return {
        modelVersionId: undefined,
        modelName: undefined
      };
    }

    // Prefer a named link sharing the same version
    // as the first current-model link.
    const first = candidates[0];

    const matching = candidates.filter(item =>
      item.versionId === first.versionId
    );

    const best =
      matching.find(item => item.name) ||
      first;

    return {
      modelVersionId: best.versionId,
      modelName: best.name || undefined
    };
  }

  // ============================================================
  // PROMPT
  // ============================================================

  function readPrompt() {
    const loraNames = readLoras()
      .map(item => normalize(item.name))
      .filter(Boolean);

    const editors = [
      ...document.querySelectorAll(
        'textarea,[contenteditable="true"],[role="textbox"]'
      )
    ].filter(el =>
      !el.closest('#' + TOOLBAR_ID)
    );

    for (const editor of editors) {
      const rect = editor.getBoundingClientRect();

      if (!rect.width || !rect.height) {
        continue;
      }

      const label = normalize([
        editor.getAttribute('aria-label'),
        editor.getAttribute('placeholder'),
        editor.getAttribute('name')
      ].filter(Boolean).join(' '));

      if (
        label.includes('search') ||
        label.includes('negative') ||
        label.includes('undesired')
      ) {
        continue;
      }

      const raw = 'value' in editor
        ? editor.value
        : editor.innerText;

      const text = clean(raw);
      if (!text) continue;

      const normalizedText = normalize(text);

      // Remove known LoRA chip names for validation.
      let remaining = normalizedText;

      for (const name of loraNames) {
        remaining = remaining.split(name).join('');
      }

      remaining = remaining
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[|｜•,._\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Avoid treating a prompt made entirely of LoRA
      // chips as genuine prompt text.
      if (
        loraNames.length > 0 &&
        remaining.length < 3
      ) {
        continue;
      }

      // Avoid values originating from non-text controls.
      if (
        normalizedText === 'true' ||
        normalizedText === 'false'
      ) {
        continue;
      }

      return text;
    }

    return undefined;
  }

  // ============================================================
  // OTHER SETTINGS
  // ============================================================

  function findLabeledControl(labels, options = {}) {
    const {
      textOnly = false
    } = options;

    const elements = [
      ...document.querySelectorAll(
        'input,textarea,select,[role="slider"]'
      )
    ];

    for (const el of elements) {
      if (
        ['checkbox', 'radio'].includes(el.type)
      ) {
        continue;
      }

      if (
        textOnly &&
        !['TEXTAREA', 'INPUT'].includes(el.tagName)
      ) {
        continue;
      }

      let label = [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('name'),
        el.getAttribute('title')
      ].filter(Boolean).join(' ');

      if (el.id) {
        for (const candidate of document.querySelectorAll(
          'label[for]'
        )) {
          if (candidate.htmlFor === el.id) {
            label += ' ' + candidate.innerText;
          }
        }
      }

      const group = el.closest(
        'label,[role="group"]'
      );

      if (group) {
        label += ' ' +
          (group.getAttribute('aria-label') || '');
      }

      label = normalize(label);

      if (labels.some(item =>
        label === normalize(item) ||
        label.includes(normalize(item))
      )) {
        return el;
      }
    }

    return null;
  }

  function controlValue(el) {
    if (!el) return undefined;

    if (
      el.type === 'checkbox' ||
      el.type === 'radio'
    ) {
      return undefined;
    }

    if (el.matches('[role="slider"]')) {
      return el.getAttribute('aria-valuenow');
    }

    return 'value' in el
      ? el.value
      : el.textContent;
  }

  function readNumberField(labels, min, max) {
    const el = findLabeledControl(labels);
    const value = numeric(controlValue(el));

    if (value === undefined) return undefined;
    if (value < min || value > max) return undefined;

    return value;
  }

  function readNegativePrompt() {
    const el = findLabeledControl(
      ['negative prompt', 'undesired content'],
      { textOnly: true }
    );

    return clean(controlValue(el)) || undefined;
  }

  function readAspectRatio() {
    const buttons = [
      ...document.querySelectorAll(
        'button,[role="radio"],[aria-checked]'
      )
    ];

    const selected = buttons.filter(el =>
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-pressed') === 'true' ||
      el.getAttribute('data-selected') === 'true'
    );

    for (const el of selected) {
      const text = clean(el.textContent);

      if (/^\d{1,2}:\d{1,2}$/.test(text)) {
        return text;
      }
    }

    return undefined;
  }

  function readSettings() {
    const settings = {};

    // Prompt
    const prompt = readPrompt();

    if (prompt) {
      settings.prompt = prompt;
    }

    const negativePrompt = readNegativePrompt();

    if (negativePrompt) {
      settings.negativePrompt = negativePrompt;
    }

    // Model
    const model = readModel();

    if (model.modelVersionId) {
      settings.modelVersionId =
        model.modelVersionId;
    }

    // LoRAs
    const loras = readLoras();

    if (loras.length) {
      settings.loras = loras.map(item => ({
        modelId: item.modelId,
        weight: item.weight
      }));
    }

    // Numeric settings
    const steps = readNumberField(
      ['sampling steps', 'steps'],
      1,
      150
    );

    const cfg = readNumberField(
      ['cfg scale', 'guidance scale', 'cfg'],
      0,
      30
    );

    const width = readNumberField(
      ['width'],
      64,
      8192
    );

    const height = readNumberField(
      ['height'],
      64,
      8192
    );

    if (steps !== undefined) {
      settings.steps = steps;
    }

    if (cfg !== undefined) {
      settings.cfgScale = cfg;
    }

    if (width !== undefined) {
      settings.width = width;
    }

    if (height !== undefined) {
      settings.height = height;
    }

    // Seed
    const seedControl = findLabeledControl([
      'seed'
    ]);

    const seed = clean(
      controlValue(seedControl)
    );

    if (/^\d+$/.test(seed)) {
      settings.seed = seed;
    }

    // Sampler
    const samplerControl = findLabeledControl([
      'sampler',
      'sampling method'
    ]);

    const sampler = clean(
      controlValue(samplerControl)
    );

    if (sampler) {
      settings.samplingMethod = sampler;
    }

    // Aspect ratio
    const ratio = readAspectRatio();

    if (ratio) {
      settings.aspectRatio = ratio;
    } else if (width && height) {
      const gcd = (a, b) =>
        b ? gcd(b, a % b) : a;

      const d = gcd(width, height);

      if (d) {
        settings.aspectRatio =
          `${width / d}:${height / d}`;
      }
    }

    return settings;
  }

  // ============================================================
  // PRESET PAYLOAD
  // ============================================================

  function buildPreset() {
    return {
      schema: SCHEMA,
      version: VERSION,
      type: 'preset',
      name: 'PixAI Editor Preset',
      settings: readSettings()
    };
  }

  function summary(data) {
    const s = data.settings;
    const loras = readLoras();
    const model = readModel();

    return [
      'PixAI Quick Copy v4.1',
      '',
      `Model: ${model.modelName || '(unknown)'}`,
      `Model Version ID: ${s.modelVersionId || '(missing)'}`,
      '',
      `LoRAs: ${loras.length}`,
      ...loras.map(item =>
        `• ${item.name}: ${item.weight}`
      ),
      '',
      `Prompt: ${s.prompt ? 'Found' : '(missing)'}`,
      `Negative: ${s.negativePrompt ? 'Found' : '(missing)'}`,
      `Steps: ${s.steps ?? '(missing)'}`,
      `CFG: ${s.cfgScale ?? '(missing)'}`,
      `Sampler: ${s.samplingMethod || '(missing)'}`,
      `Size: ${s.width || '?'} × ${s.height || '?'}`,
      `Aspect: ${s.aspectRatio || '(missing)'}`,
      '',
      'Missing values are not guessed.'
    ].join('\n');
  }

  function copyPreset() {
    const data = buildPreset();

    if (!Object.keys(data.settings).length) {
      toast('No generation settings found.');
      return;
    }

    const message =
      summary(data) +
      '\n\nCopy preset?';

    if (confirm(message)) {
      copy(data, 'PixAI preset copied!');
    }
  }

  // ============================================================
  // INSPECT
  // ============================================================

  function inspect() {
    const model = readModel();
    const loras = readLoras();

    const modelLinks = [
      ...document.querySelectorAll(
        'a[href*="/model/"]'
      )
    ].map(el => {
      const ids = parseModelLink(el.href);

      return {
        name: clean(
          el.getAttribute('aria-label') ||
          el.textContent
        ),
        modelId: ids?.modelId,
        versionId: ids?.versionId,
        href: el.href
      };
    });

    const fields = [
      ...document.querySelectorAll(
        'input,textarea,select,[contenteditable="true"]'
      )
    ].map(el => ({
      type: el.type || el.tagName,
      label: clean(
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder')
      ),
      value: el.type === 'checkbox'
        ? el.checked
        : clean(controlValue(el)).slice(0, 150)
    }));

    const result = {
      url: location.href,
      model,
      loras,
      modelLinks,
      fields,
      parsed: buildPreset()
    };

    copy(result, 'Diagnostic data copied!');
  }

  // ============================================================
  // UI
  // ============================================================

  function createButton(
    text,
    handler,
    secondary = false
  ) {
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = text;

    Object.assign(button.style, {
      border: 'none',
      borderRadius: '9px',
      padding: '10px 13px',
      cursor: 'pointer',
      font: '600 13px system-ui',
      color: '#fff',
      background: secondary
        ? '#45414f'
        : '#9333ea'
    });

    button.addEventListener('click', handler);

    return button;
  }

  function mountToolbar() {
    if (document.getElementById(TOOLBAR_ID)) {
      return;
    }

    const toolbar = document.createElement('div');

    toolbar.id = TOOLBAR_ID;

    Object.assign(toolbar.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '2147483646',
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
      padding: '9px',
      background: 'rgba(34,34,34,.94)',
      border: '1px solid #ffffff30',
      borderRadius: '13px',
      boxShadow: '0 5px 20px #0005'
    });

    toolbar.appendChild(
      createButton(
        '📋 Copy PixAI Preset',
        copyPreset
      )
    );

    toolbar.appendChild(
      createButton(
        '🔍 Inspect Data',
        inspect,
        true
      )
    );

    document.body.appendChild(toolbar);
  }

  function init() {
    if (!document.body) return;

    mountToolbar();

    const observer = new MutationObserver(() => {
      if (
        !document.getElementById(TOOLBAR_ID)
      ) {
        mountToolbar();
      }
    });

    observer.observe(document.documentElement, {
      childList: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();

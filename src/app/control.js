'use strict';

// The control room: a four-step setup and the big "Release the ghosts" button.
// All user content (names, subjects) goes in via textContent, never HTML.

const api = window.control;
let S = null; // latest status from main
let scan = null; // last scan result
let busy = null; // name of the action in progress
let editingKey = false;

// ---- tiny DOM helper ----------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function fill(id, done, locked, ...nodes) {
  const section = document.getElementById(id);
  section.classList.toggle('done', done);
  section.classList.toggle('locked', locked);
  section.querySelector('.body').replaceChildren(...nodes);
}

let toastTimer;
function toast(message, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 7000 : 3500);
}

// Runs a main-process action, tracks it as busy, and reports errors in plain words.
async function act(name, fn, ...args) {
  busy = name;
  render();
  try {
    const res = await fn(...args);
    if (!res.ok) {
      toast(res.error, true);
      return null;
    }
    return res.value;
  } finally {
    busy = null;
    render();
  }
}

function button(label, onclick, { primary = false, big = false, action, disabled = false } = {}) {
  const working = action && busy === action;
  return h(
    'button',
    { class: [primary && 'primary', big && 'big'].filter(Boolean).join(' '), onclick, disabled: disabled || Boolean(busy) },
    working ? 'Working…' : label
  );
}

function days(n) {
  return `${n} day${n === 1 ? '' : 's'}`;
}

// ---- steps ------------------------------------------------------------------------

function gmailStep() {
  if (!S.hasCredentials) {
    return fill(
      'step-gmail',
      false,
      false,
      h('p', {}, 'Choose the Google OAuth client file you downloaded. It’s usually named ', h('code', {}, 'client_secret_….json'), '.'),
      h('div', { class: 'row' }, button('Choose file…', chooseCredentials, { primary: true, action: 'creds' }), h('button', { class: 'link', onclick: () => api.help() }, 'How do I get this?'))
    );
  }
  if (!S.signedIn) {
    return fill(
      'step-gmail',
      false,
      false,
      h('p', {}, 'Your Google client file is in place. Now sign in. Your browser will open.'),
      h('div', { class: 'row' }, button('Sign in with Google', signIn, { primary: true, action: 'signin' }), h('button', { class: 'link', onclick: chooseCredentials }, 'Use a different file')),
      h('p', { class: 'hint' }, 'Google will say the app isn’t verified. It’s your own private app: click “Continue”, then allow read access.')
    );
  }
  return fill(
    'step-gmail',
    true,
    false,
    h('p', { class: 'ok' }, `✓ Connected${S.email ? ` as ${S.email}` : ''}. Read-only.`)
  );
}

function voiceStep() {
  const locked = !S.signedIn;
  const nodes = [];
  if (S.hasVoiceKey && !editingKey) {
    nodes.push(
      h('p', { class: 'ok' }, '✓ ElevenLabs key saved in your Mac’s Keychain.'),
      h(
        'div',
        { class: 'row' },
        button('▶ Hear a ghost', previewVoice, { action: 'preview' }),
        h('button', { class: 'link', onclick: () => ((editingKey = true), render()) }, 'Replace key'),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: S.voiceEnabled, onchange: (e) => act('voice', api.setVoiceEnabled, e.target.checked).then(setStatus) }), 'Voice on')
      )
    );
  } else {
    const input = h('input', { type: 'password', placeholder: 'Paste your ElevenLabs API key', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && saveKey(input.value));
    nodes.push(
      h('p', {}, 'Ghosts speak with an ElevenLabs voice. Paste your API key (ElevenLabs → Settings → API Keys).'),
      h('div', { class: 'row' }, input, button('Save', () => saveKey(input.value), { primary: true, action: 'key' })),
      h('p', { class: 'hint' }, 'Rather keep everything silent and on your Mac? ', h('button', { class: 'link', onclick: () => act('voice', api.setVoiceEnabled, false).then(setStatus) }, 'Skip voice'), '.')
    );
  }
  if (S.voiceError) nodes.push(h('p', { class: 'err' }, `Voice problem: ${S.voiceError}`));
  fill('step-voice', S.hasVoiceKey || !S.voiceEnabled, locked, ...nodes);
}

function scanStep() {
  const locked = !S.signedIn;
  const nodes = [];
  if (!scan) {
    nodes.push(
      h('p', {}, 'Look through your inbox for people you never wrote back to. Nothing in Gmail changes.'),
      button('Look in my inbox', runScan, { primary: !locked, action: 'scan', disabled: locked })
    );
  } else if (scan.total === 0) {
    nodes.push(h('p', {}, 'No unfinished business. The house is quiet… for now.'), button('Look again', runScan, { action: 'scan' }));
  } else {
    nodes.push(
      h('p', {}, `${scan.total} ${scan.total === 1 ? 'person is' : 'people are'} still waiting on you.`),
      h(
        'ul',
        { class: 'ghosts' },
        scan.ghosts.map((g) => h('li', {}, h('span', { class: 'days' }, `${g.ageDays}d`), h('span', { class: 'who' }, g.name), h('span', { class: 'what' }, g.subject || '(no subject)')))
      ),
      h('div', { class: 'row spaced' }, button('Look again', runScan, { action: 'scan' }))
    );
  }
  fill('step-scan', Boolean(scan), locked, ...nodes);
}

function releaseStep() {
  const ready = S.signedIn && scan && scan.total > 0;
  if (S.haunting) {
    const parts = [`${S.active.length} haunting`, `${S.waiting} waiting`];
    if (S.exorcised) parts.push(`${S.exorcised} laid to rest`);
    return fill(
      'step-release',
      true,
      false,
      h('p', { class: 'ok' }, S.banished ? '🕯️ Banished. Everything is hidden and silent.' : `👻 ${parts.join(' · ')}`),
      h('p', { class: 'hint' }, 'To make a ghost leave, reply to that email or archive it. Click a ghost to open its email.'),
      h(
        'div',
        { class: 'row' },
        button(S.banished ? 'Let them back in' : 'Banish all', () => act('banish', api.banish).then(setStatus), { primary: !S.banished }),
        button('Stop haunting', () => act('stop', api.stop).then(setStatus))
      ),
      paceChoices()
    );
  }
  fill(
    'step-release',
    false,
    !ready,
    h('p', {}, 'Ghosts drift in one at a time, oldest first, and stay until you deal with their email.'),
    paceChoices(),
    button('Release the ghosts', start, { primary: true, big: true, action: 'start', disabled: !ready })
  );
}

function paceChoices() {
  const choice = (seconds, title) =>
    h('label', {}, h('input', { type: 'radio', name: 'pace', checked: S.pace === seconds, onchange: () => act('pace', api.setPace, seconds).then(setStatus) }), title);
  return h('div', { class: 'choices' }, choice(45, 'Slow burn · every 45s'), choice(8, 'Demo · every 8s'));
}

// ---- actions --------------------------------------------------------------------

function setStatus(status) {
  if (status) S = status;
  render();
}

async function chooseCredentials() {
  setStatus(await act('creds', api.chooseCredentials));
}

async function signIn() {
  const status = await act('signin', api.signIn);
  if (status) {
    setStatus(status);
    toast('Connected. Now give them a voice.');
  }
}

async function saveKey(value) {
  const status = await act('key', api.saveVoiceKey, value);
  if (status) {
    editingKey = false;
    setStatus(status);
    toast('Key saved to your Keychain.');
  }
}

async function previewVoice() {
  const result = await act('preview', api.previewVoice);
  if (!result) return;
  const url = URL.createObjectURL(new Blob([result.audio], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play();
  toast(`“${result.line}”`);
  setStatus(await api.status().then((r) => r.value));
}

async function runScan() {
  const result = await act('scan', api.scan);
  if (!result) return;
  scan = result;
  render();
  if (scan.total > 0) document.getElementById('step-release').scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function start() {
  const status = await act('start', api.start);
  if (status) {
    setStatus(status);
    toast('They’re coming. Close this window if you like — they’ll stay.');
  }
}

async function undo() {
  const steps = await act('undo', api.uninstall);
  if (!steps) return;
  scan = null;
  editingKey = false;
  toast(steps.join(' '));
  setStatus((await api.status()).value);
}

// ---- render -------------------------------------------------------------------------

function render() {
  if (!S) return;
  gmailStep();
  voiceStep();
  scanStep();
  releaseStep();
  document.getElementById('undo').disabled = Boolean(busy);
}

document.getElementById('undo').addEventListener('click', undo);
api.onStatus(setStatus);
api.status().then((res) => setStatus(res.value));

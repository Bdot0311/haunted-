'use strict';

// Runs in the click-through overlay. Draws the ghosts, moves them, and gives
// them a voice through a Web Audio chain that gets darker with age.

const field = document.getElementById('ghosts');
const dread = document.getElementById('dread');
const ghosts = new Map(); // threadId -> state
let cursor = { x: -1e4, y: -1e4 };
let hovered = null;
let banished = false;

const GHOST_SVG = `
<svg viewBox="0 0 100 124" aria-hidden="true">
  <g class="tail">
    <path class="sheet" d="M50 4C23 4 9 27 9 56v56c6-7 11-7 16 0s11 7 16 0 11-7 18 0 11 7 16 0 11-7 16 0V56C91 27 77 4 50 4z"/>
  </g>
  <ellipse class="hollow" cx="36" cy="50" rx="7" ry="10"/>
  <ellipse class="hollow" cx="64" cy="50" rx="7" ry="10"/>
  <ellipse class="hollow mouth" cx="50" cy="78" rx="6" ry="9"/>
</svg>`;

function weight(ageDays) {
  return Math.min(ageDays, 90) / 90; // 0 = fresh, 1 = ancient
}

// ---- audio ------------------------------------------------------------------

const ctx = new AudioContext();
const master = ctx.createGain();
master.gain.value = 0.9;
master.connect(ctx.destination);

function impulse(seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

const reverb = ctx.createConvolver();
reverb.buffer = impulse(4, 2.6);
reverb.connect(master);

const noise = (() => {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
})();

function panFor(state) {
  const x = (state.x + state.size / 2) / window.innerWidth;
  return Math.max(-0.9, Math.min(0.9, x * 2 - 1));
}

// One voice at a time; the rest wait their turn in the dark.
let speech = Promise.resolve();

function say(state, buffer, { exorcism = false } = {}) {
  if (!buffer) return Promise.resolve();
  speech = speech.then(
    () =>
      new Promise((resolve) => {
        if (banished) return resolve();
        const w = weight(state.ghost.ageDays);
        const t = ctx.currentTime;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = exorcism ? 1 : 0.95 - w * 0.1; // lower and slower with age

        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = exorcism ? 9000 : 5500 - w * 2600;

        const pan = ctx.createStereoPanner();
        pan.pan.value = panFor(state);
        const dry = ctx.createGain();
        dry.gain.value = 0.8;
        const wet = ctx.createGain();
        wet.gain.value = exorcism ? 0.7 : 0.3 + w * 0.4;

        src.connect(tone).connect(pan);
        pan.connect(dry).connect(master);
        pan.connect(wet).connect(reverb);

        // Static under the voice, louder the longer they've waited.
        const hiss = ctx.createBufferSource();
        hiss.buffer = noise;
        hiss.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 1600;
        band.Q.value = 0.6;
        const hissGain = ctx.createGain();
        const level = exorcism ? 0 : 0.004 + w * 0.03;
        hissGain.gain.setValueAtTime(0, t);
        hissGain.gain.linearRampToValueAtTime(level, t + 0.8);
        hiss.connect(band).connect(hissGain).connect(pan);

        state.el.classList.add('speaking');
        src.onended = () => {
          hissGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
          hiss.stop(ctx.currentTime + 1.3);
          state.el.classList.remove('speaking');
          setTimeout(resolve, 1200); // let the reverb tail hang
        };
        hiss.start(t);
        src.start(t + 0.15);
      })
  );
  return speech;
}

async function decode(bytes) {
  if (!bytes) return null;
  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    return null;
  }
}

// ---- ghosts -----------------------------------------------------------------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function summon({ ghost, audio }) {
  if (ghosts.has(ghost.threadId)) return;
  const w = weight(ghost.ageDays);
  const size = 90 + w * 110;

  const el = element('div', 'ghost');
  el.style.width = `${size}px`;
  el.style.setProperty('--presence', String(0.35 + w * 0.5));
  const body = element('div', 'body');
  body.innerHTML = GHOST_SVG;
  const caption = element('div', 'caption');
  caption.append(
    element('span', 'who', `${ghost.name} · ${ghost.ageDays} day${ghost.ageDays === 1 ? '' : 's'}`),
    element('span', 'what', ghost.subject || '(no subject)')
  );
  el.append(body, caption);
  el.addEventListener('click', () => window.haunt.openThread(ghost.threadId));
  field.append(el);

  // Enter from a random edge of the screen.
  const edge = Math.floor(Math.random() * 4);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const state = {
    ghost,
    el,
    size,
    x: edge === 0 ? -size * 0.5 : edge === 1 ? W - size * 0.5 : Math.random() * (W - size),
    y: edge === 2 ? -size * 0.5 : edge === 3 ? H - size * 0.8 : Math.random() * (H - size),
    heading: Math.random() * Math.PI * 2,
    speed: 26 - w * 14, // older ghosts move slower, and mean it
    phase: Math.random() * Math.PI * 2,
    buffer: null,
    gone: false,
  };
  ghosts.set(ghost.threadId, state);
  updateDread();

  decode(audio).then((buffer) => {
    state.buffer = buffer;
    say(state, buffer);
    scheduleWhisper(state);
  });
}

function scheduleWhisper(state) {
  const delay = 70000 + Math.random() * 90000;
  state.whisper = setTimeout(() => {
    if (state.gone) return;
    if (!banished) say(state, state.buffer);
    scheduleWhisper(state);
  }, delay);
}

function exorcise({ threadId, audio }) {
  const state = ghosts.get(threadId);
  if (!state || state.gone) return;
  state.gone = true;
  clearTimeout(state.whisper);
  if (hovered === state) {
    hovered = null;
    window.haunt.setInteractive(false);
  }
  decode(audio).then((buffer) => say(state, buffer, { exorcism: true }));
  state.el.classList.add('exorcised');
  setTimeout(() => {
    state.el.remove();
    ghosts.delete(threadId);
    updateDread();
  }, 3100);
}

function updateDread() {
  const living = [...ghosts.values()].filter((s) => !s.gone).length;
  dread.style.opacity = String(Math.min(living * 0.08, 0.5));
}

// ---- motion -----------------------------------------------------------------

let last = performance.now();

function step(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const W = window.innerWidth;
  const H = window.innerHeight;

  for (const s of ghosts.values()) {
    if (s.gone) continue;
    const w = weight(s.ghost.ageDays);
    s.heading += (Math.random() - 0.5) * 0.9 * dt;
    let vx = Math.cos(s.heading) * s.speed;
    let vy = Math.sin(s.heading) * s.speed * 0.6;

    // Fresh ghosts shy away from your cursor. Old ones come closer.
    const cx = s.x + s.size / 2;
    const cy = s.y + s.size / 2;
    const dx = cursor.x - cx;
    const dy = cursor.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 420) {
      const pull = w > 0.33 ? (dist > 150 ? 18 * w : 0) : -40 * (1 - dist / 420);
      vx += (dx / dist) * pull;
      vy += (dy / dist) * pull;
    }

    s.x += vx * dt;
    s.y += vy * dt;
    // Turn back before drifting far off-screen.
    if (s.x < -s.size * 0.3 || s.x > W - s.size * 0.7) s.heading = Math.PI - s.heading;
    if (s.y < -s.size * 0.2 || s.y > H - s.size * 1.1) s.heading = -s.heading;
    s.x = Math.max(-s.size * 0.4, Math.min(W - s.size * 0.6, s.x));
    s.y = Math.max(-s.size * 0.3, Math.min(H - s.size, s.y));

    const bob = Math.sin(now / 900 + s.phase) * (6 + w * 6);
    const tilt = Math.sin(now / 1700 + s.phase) * 4;
    s.el.style.transform = `translate(${s.x}px, ${s.y + bob}px) rotate(${tilt}deg)`;
  }
  requestAnimationFrame(step);
}
requestAnimationFrame(step);

// The window ignores the mouse except over a ghost; mousemove still arrives
// because main forwards it.
window.addEventListener('mousemove', (e) => {
  cursor = { x: e.clientX, y: e.clientY };
  let over = null;
  for (const s of ghosts.values()) {
    if (s.gone) continue;
    const r = s.el.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) over = s;
  }
  if (over === hovered) return;
  if (hovered) hovered.el.classList.remove('hovered');
  hovered = over;
  if (hovered) hovered.el.classList.add('hovered');
  window.haunt.setInteractive(Boolean(hovered));
});

window.haunt.onSpawn(summon);
window.haunt.onExorcise(exorcise);
window.haunt.onBanish(() => {
  banished = true;
  ctx.suspend();
  document.body.style.visibility = 'hidden';
});
window.haunt.onRestore(() => {
  banished = false;
  ctx.resume();
  document.body.style.visibility = 'visible';
});

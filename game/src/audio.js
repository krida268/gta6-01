// audio.js — Semua suara "Solmar Bay" dibuat dengan WebAudio API murni,
// tanpa file suara apa pun. SFX sintetis (tembakan, mesin, sirene, klakson,
// tabrakan, pickup, langkah, klik UI) + musik latar synthwave-ish sederhana
// (bassline + pad + arpeggio, ~100 BPM) yang intensitasnya naik saat wanted tinggi.
//
// Aturan browser: AudioContext hanya dibuat/dijalankan setelah interaksi user
// pertama (klik Start / tombol apa pun / keydown). Modul ini mendengarkan
// bus 'audio-start' dan juga gesture pertama di window.
//
// Kontrak yang dipakai:
//   state = { mode, wanted, player: { speed, onFoot, vehicleId } }
//   ctx.bus = { on(event, fn), emit(event, payload) }
//   ctx.registerUpdate(fn) = (opsional) pendaftaran update(dt)
//
// Event bus yang didengarkan:
//   'audio-start' -> buat/resume AudioContext, mulai musik + engine
//   'toggle-mute' -> mute/unmute (tombol M juga ditangani di sini)
//   'gunshot' | 'crash' | 'siren' | 'pickup' | 'mission-done'
//   'car-stolen' | 'footstep' | 'ui-click' | 'horn' | 'game-complete'
// Event bus yang di-emit:
//   'toast' { text } saat mute berubah (supaya HUD menampilkan status)

function dummyBus() {
  return { on() {}, emit() {} };
}

// Nada (Hz) — temperamen sama rata.
const N = {
  A1: 55.0, C2: 65.41, D2: 73.42, E2: 82.41, F1: 43.65, G1: 49.0,
  A2: 110.0, C3: 130.81, D3: 146.83, E3: 164.81, F2: 87.31, G2: 98.0,
  A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, F3: 174.61, G3: 196.0,
  A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, F4: 349.23, G4: 392.0,
  B4: 493.88, G5: 783.99, B5: 987.77, E6: 1318.51,
};

// Progresi 4 bar: Am – F – C – G (satu bar per akor, 4 ketuk per bar).
const CHORDS = [
  { pad: [N.A2, N.C3, N.E3], bass: N.A1, arp: [N.A3, N.C4, N.E4, N.A4] },
  { pad: [N.F2, N.A2, N.C3], bass: N.F1, arp: [N.F3, N.A3, N.C4, N.F4] },
  { pad: [N.C3, N.E3, N.G3], bass: N.C2, arp: [N.C4, N.E4, N.G4, N.C5] },
  { pad: [N.G2, N.B4 / 2, N.D3], bass: N.G1, arp: [N.G3, N.B4, N.D4, N.G4] },
];

const BPM = 100;
const BEAT = 60 / BPM; // 0.6 detik
const STEP16 = BEAT / 4; // 0.15 detik per langkah 16th

export function initSystem(state, scene, ctx) {
  const bus = (ctx && ctx.bus) || dummyBus();

  const rt = {
    ctx: null, // AudioContext
    master: null,
    musicGain: null,
    sfxGain: null,
    noiseBuf: null,
    started: false,
    muted: false,
    engine: null, // { osc, gain, filter }
    siren: null, // { osc, lfo, gain }
    musicTimer: null,
    nextStepTime: 0,
    step: 0, // langkah 16th global
    intensity: 0.25,
    intensityTarget: 0.25,
    lastFoot: 0,
  };

  // -------------------------------------------------------------------------
  // Inisialisasi AudioContext (hanya setelah gesture user).
  // -------------------------------------------------------------------------
  function ensureAudio() {
    if (rt.ctx) {
      if (rt.ctx.state === 'suspended') rt.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      rt.ctx = new AC();
      rt.master = rt.ctx.createGain();
      rt.master.gain.value = rt.muted ? 0 : 0.9;
      rt.master.connect(rt.ctx.destination);
      rt.musicGain = rt.ctx.createGain();
      rt.musicGain.gain.value = 0.5;
      rt.musicGain.connect(rt.master);
      rt.sfxGain = rt.ctx.createGain();
      rt.sfxGain.gain.value = 0.9;
      rt.sfxGain.connect(rt.master);
      // Buffer noise putih 1 detik, dipakai semua SFX berbasis noise.
      const len = rt.ctx.sampleRate;
      rt.noiseBuf = rt.ctx.createBuffer(1, len, rt.ctx.sampleRate);
      const data = rt.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function startAudio() {
    if (!ensureAudio()) return;
    if (!rt.started) {
      rt.started = true;
      startEngine();
      startMusic();
    } else if (rt.ctx.state === 'suspended') {
      rt.ctx.resume().catch(() => {});
    }
  }

  function setMuted(m) {
    rt.muted = m;
    if (rt.master && rt.ctx) {
      rt.master.gain.setTargetAtTime(m ? 0 : 0.9, rt.ctx.currentTime, 0.05);
    }
    bus.emit('toast', { text: m ? 'Suara: Mati (M untuk menghidupkan)' : 'Suara: Hidup' });
  }

  function toggleMute() {
    setMuted(!rt.muted);
  }

  // -------------------------------------------------------------------------
  // Primitif SFX.
  // -------------------------------------------------------------------------
  function tone(freq, dur, type, gainVal, when, slideTo, dest) {
    if (!rt.ctx) return;
    const t0 = when || rt.ctx.currentTime;
    const osc = rt.ctx.createOscillator();
    const g = rt.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainVal), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest || rt.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, filterFreq, gainVal, type, when) {
    if (!rt.ctx || !rt.noiseBuf) return;
    const t0 = when || rt.ctx.currentTime;
    const src = rt.ctx.createBufferSource();
    src.buffer = rt.noiseBuf;
    src.loop = true;
    const filter = rt.ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq;
    const g = rt.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainVal), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(rt.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // -------------------------------------------------------------------------
  // SFX satu kali.
  // -------------------------------------------------------------------------
  function sfxGunshot() {
    noise(0.12, 1800, 0.5, 'lowpass');
    tone(160, 0.09, 'square', 0.25, 0, 60);
  }

  function sfxCrash() {
    noise(0.35, 320, 0.6, 'lowpass');
    tone(90, 0.25, 'sine', 0.4, 0, 40);
  }

  function sfxHorn() {
    if (!rt.ctx) return;
    const t0 = rt.ctx.currentTime;
    tone(370, 0.28, 'square', 0.18, t0);
    tone(466, 0.28, 'square', 0.12, t0);
  }

  function sfxPickup() {
    if (!rt.ctx) return;
    const t0 = rt.ctx.currentTime;
    tone(N.E5, 0.12, 'triangle', 0.3, t0);
    tone(N.G5, 0.12, 'triangle', 0.3, t0 + 0.09);
    tone(N.B5, 0.18, 'triangle', 0.3, t0 + 0.18);
  }

  function sfxFootstep() {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now - rt.lastFoot < 180) return; // batasi: maks ~5 langkah/detik
    rt.lastFoot = now;
    noise(0.06, 500, 0.12, 'lowpass');
  }

  function sfxUiClick() {
    tone(880, 0.06, 'square', 0.12);
  }

  function sfxCarStolen() {
    if (!rt.ctx) return;
    const t0 = rt.ctx.currentTime;
    tone(N.C4, 0.14, 'triangle', 0.3, t0);
    tone(N.G4, 0.22, 'triangle', 0.3, t0 + 0.12);
  }

  function sfxMissionDone() {
    if (!rt.ctx) return;
    const t0 = rt.ctx.currentTime;
    const seq = [N.C5, N.E5, N.G5, N.E6];
    seq.forEach((f, i) => tone(f, 0.22, 'triangle', 0.3, t0 + i * 0.13));
  }

  function sfxSirenBlip() {
    // Satu lengking sirene pendek (untuk event 'siren' sekali jalan).
    tone(950, 0.5, 'triangle', 0.2, 0, 1400);
  }

  // -------------------------------------------------------------------------
  // Loop kontinu: mesin mobil & sirene polisi.
  // -------------------------------------------------------------------------
  function startEngine() {
    if (!rt.ctx || rt.engine) return;
    const osc = rt.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const filter = rt.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const g = rt.ctx.createGain();
    g.gain.value = 0;
    osc.connect(filter);
    filter.connect(g);
    g.connect(rt.master);
    osc.start();
    rt.engine = { osc, gain: g, filter };
  }

  function startSiren() {
    if (!rt.ctx || rt.siren) return;
    const osc = rt.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1000;
    const lfo = rt.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.6; // naik-turun ~0.6 Hz
    const lfoGain = rt.ctx.createGain();
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const g = rt.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(rt.master);
    osc.start();
    lfo.start();
    rt.siren = { osc, lfo, gain: g };
  }

  // -------------------------------------------------------------------------
  // Musik latar: scheduler lookahead. Satu bar = 16 langkah 16th.
  // Per bar: pad akor (2 osc detuned), bass 8th, arpeggio 16th, hat bila intens.
  // -------------------------------------------------------------------------
  function startMusic() {
    if (!rt.ctx || rt.musicTimer) return;
    rt.nextStepTime = rt.ctx.currentTime + 0.1;
    rt.step = 0;
    rt.musicTimer = setInterval(() => scheduleMusic(), 40);
  }

  function scheduleMusic() {
    if (!rt.ctx) return;
    while (rt.nextStepTime < rt.ctx.currentTime + 0.18) {
      scheduleStep(rt.step, rt.nextStepTime);
      rt.step += 1;
      rt.nextStepTime += STEP16;
    }
  }

  function padChord(freqs, t0, dur) {
    for (const f of freqs) {
      for (const det of [-4, 4]) {
        const osc = rt.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.detune.value = det;
        const flt = rt.ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 1200;
        const g = rt.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.045, t0 + 0.3);
        g.gain.setValueAtTime(0.045, t0 + dur - 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(flt);
        flt.connect(g);
        g.connect(rt.musicGain);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      }
    }
  }

  function bassNote(freq, t0, dur) {
    const osc = rt.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const flt = rt.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 300;
    const g = rt.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(flt);
    flt.connect(g);
    g.connect(rt.musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function arpNote(freq, t0) {
    const osc = rt.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = rt.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + STEP16 * 0.9);
    osc.connect(g);
    g.connect(rt.musicGain);
    osc.start(t0);
    osc.stop(t0 + STEP16);
  }

  function hatTick(t0) {
    const src = rt.ctx.createBufferSource();
    src.buffer = rt.noiseBuf;
    src.loop = true;
    const flt = rt.ctx.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.value = 6000;
    const g = rt.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    src.connect(flt);
    flt.connect(g);
    g.connect(rt.musicGain);
    src.start(t0);
    src.stop(t0 + 0.06);
  }

  function scheduleStep(step, t0) {
    const bar = Math.floor(step / 16) % CHORDS.length;
    const chord = CHORDS[bar];
    const inBar = step % 16;
    const barDur = STEP16 * 16;
    // Pad di awal tiap bar.
    if (inBar === 0) padChord(chord.pad, t0, barDur);
    // Bass di tiap 8th (langkah genap).
    if (inBar % 2 === 0) bassNote(chord.bass, t0, STEP16 * 1.8);
    // Arpeggio 16th — makin rapat saat intensitas tinggi.
    const arpOn = rt.intensity > 0.6 || inBar % 2 === 0;
    if (arpOn) {
      const seq = chord.arp;
      const note = seq[(step >> 1) % seq.length] * (inBar % 4 === 2 ? 2 : 1);
      arpNote(note, t0);
    }
    // Hat di offbeat saat wanted tinggi.
    if (rt.intensity > 0.55 && inBar % 4 === 2) hatTick(t0);
  }

  // -------------------------------------------------------------------------
  // Update per frame: engine ikut kecepatan, sirene ikut wanted, intensitas musik.
  // -------------------------------------------------------------------------
  function update(dt) {
    if (!rt.ctx || !rt.started) return;
    const t = rt.ctx.currentTime;
    const p = state.player || {};
    const inVehicle = !p.onFoot && !!p.vehicleId;
    const speed = Math.abs(p.speed || 0);
    const playing = state.mode === 'playing';

    // Mesin: pitch naik dengan kecepatan, senyap saat jalan kaki / bukan bermain.
    if (rt.engine) {
      const targetGain = (playing && inVehicle) ? 0.05 : 0;
      const targetFreq = 50 + speed * 4.5;
      rt.engine.gain.gain.setTargetAtTime(targetGain, t, 0.1);
      rt.engine.osc.frequency.setTargetAtTime(targetFreq, t, 0.08);
      rt.engine.filter.frequency.setTargetAtTime(500 + speed * 25, t, 0.1);
    }

    // Sirene: bunyi bila wanted > 0 dan sedang bermain.
    if (rt.siren) {
      const targetGain = (playing && (state.wanted || 0) > 0) ? 0.05 : 0;
      rt.siren.gain.gain.setTargetAtTime(targetGain, t, 0.3);
    } else if (playing && (state.wanted || 0) > 0) {
      startSiren();
    }

    // Intensitas musik mengikuti wanted (halus, tidak melonjak).
    const w = state.wanted || 0;
    rt.intensityTarget = w >= 4 ? 1 : w >= 2 ? 0.7 : w >= 1 ? 0.45 : 0.25;
    rt.intensity += (rt.intensityTarget - rt.intensity) * Math.min(1, dt * 0.8);
  }

  // -------------------------------------------------------------------------
  // Event bus & gesture pertama.
  // -------------------------------------------------------------------------
  bus.on('audio-start', () => startAudio());
  bus.on('toggle-mute', () => toggleMute());
  bus.on('gunshot', () => sfxGunshot());
  bus.on('crash', () => sfxCrash());
  bus.on('siren', () => sfxSirenBlip());
  bus.on('pickup', () => sfxPickup());
  bus.on('mission-done', () => sfxMissionDone());
  bus.on('game-complete', () => sfxMissionDone());
  bus.on('car-stolen', () => sfxCarStolen());
  bus.on('footstep', () => sfxFootstep());
  bus.on('ui-click', () => sfxUiClick());
  bus.on('horn', () => sfxHorn());

  if (typeof window !== 'undefined' && !rt._gestureBound) {
    rt._gestureBound = true;
    const once = () => startAudio();
    window.addEventListener('pointerdown', once, { once: true });
    window.addEventListener('keydown', once, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') toggleMute();
    });
  }

  if (ctx && typeof ctx.registerUpdate === 'function') {
    try { ctx.registerUpdate(update); } catch { /* abaikan */ }
  }

  return {
    update,
    startAudio,
    toggleMute,
    setMuted,
    isMuted: () => rt.muted,
    isStarted: () => rt.started,
  };
}

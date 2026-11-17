// main.js — Bootstrap SOLMAR BAY.
// Renderer + scene + kota, loop requestAnimationFrame, registry sistem.
// Setiap modul sistem mengekspor initSystem(state, scene, ctx) yang
// mendaftarkan update-nya lewat registerSystem(fn) (alias ctx.registerUpdate),
// atau mengembalikan update (fungsi, atau objek { update }) yang didaftarkan
// main.js. Kontrak update sistem: fn(dt, ctx) — dt detik sejak frame lalu;
// state dibaca dari closure initSystem (modul-modul B/C menulis update(dt),
// BUKAN update(state, dt)). Dipanggil tiap frame saat mode 'playing'
// (dan 'menu', supaya latar menu tetap hidup).
// ctx berisi { scene, camera, renderer, input, bus, registerSystem, THREE }.
// State global tersedia di window.__game untuk debug / play-test.

import * as THREE from 'three';
import { state, bus } from './state.js';
import { input, attachInput } from './input.js';
import { buildCity } from './city.js';
import { updatePlayer } from './player.js';
import { initSystem as initVehicles } from './vehicles.js';
import { initSystem as initTraffic } from './traffic.js';
import { initSystem as initPedestrians } from './pedestrians.js';
import { initSystem as initPolice } from './police.js';
import { initSystem as initCombat } from './combat.js';
import { initSystem as initMissions } from './missions.js';
import { initSystem as initSave, hasSave } from './save.js';
import { initSystem as initHud } from './hud.js';
import { initSystem as initAudio } from './audio.js';

// ---------- Registry sistem ----------
window.__systems = [];
export function registerSystem(fn) {
  if (typeof fn === 'function') window.__systems.push(fn);
  return fn;
}

// ---------- Renderer / scene / kamera ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 8, 40);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Dunia ----------
buildCity(scene, state);
state.player.x = state.city.spawns.player.x;
state.player.z = state.city.spawns.player.z;

// ---------- Input ----------
attachInput(canvas);

// ---------- Konteks untuk sistem ----------
const ctx = {
  scene,
  camera,
  renderer,
  input,
  bus,
  registerSystem,
  // Alias yang dipakai builder B/C: registerUpdate(fn).
  registerUpdate: registerSystem,
  // missions.js memakai ctx.THREE untuk marker 3D.
  THREE,
};

// Daftarkan semua sistem (masing-masing mendaftarkan update-nya sendiri
// lewat ctx.registerSystem/registerUpdate, atau mengembalikan update yang
// didaftarkan di sini — keduanya dicatat sekali saja, tanpa ganda).
function safeInit(name, fn) {
  try {
    if (typeof fn !== 'function') return;
    const before = window.__systems.length;
    const ret = fn(state, scene, ctx);
    if (window.__systems.length === before) {
      if (typeof ret === 'function') registerSystem(ret);
      else if (ret && typeof ret.update === 'function') registerSystem(ret.update);
    }
  } catch (err) {
    console.error(`initSystem gagal: ${name}`, err);
  }
}
// Urutan penting: save.js SEBELUM hud.js supaya tombol Continue tahu ada save.
safeInit('vehicles', initVehicles);
safeInit('traffic', initTraffic);
safeInit('pedestrians', initPedestrians);
safeInit('police', initPolice);
safeInit('combat', initCombat);
safeInit('missions', initMissions);
safeInit('save', initSave);
safeInit('hud', initHud);
safeInit('audio', initAudio);

// ---------- Mode & overlay ----------
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const gameoverEl = document.getElementById('gameover');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverText = document.getElementById('gameover-text');
const hudEl = document.getElementById('hud');

function showOnly(el) {
  for (const o of [menuEl, pauseEl, gameoverEl]) {
    if (o) o.classList.toggle('hidden', o !== el);
  }
  if (hudEl) hudEl.classList.toggle('hidden', el === menuEl);
}

export function setMode(mode) {
  state.mode = mode;
  if (mode === 'playing') {
    showOnly(null);
    input.clearAll();
    bus.emit('mode', { mode });
  } else if (mode === 'paused') {
    showOnly(pauseEl);
    bus.emit('mode', { mode });
  } else if (mode === 'menu') {
    showOnly(menuEl);
    bus.emit('mode', { mode });
  } else if (mode === 'busted' || mode === 'dead') {
    if (gameoverTitle) gameoverTitle.textContent = mode === 'busted' ? 'TERTANGKAP!' : 'GAME OVER';
    if (gameoverText) {
      gameoverText.textContent = mode === 'busted'
        ? 'Polisi Solmar Bay berhasil menangkapmu. Uang hasil misimu disita.'
        : 'Kamu kehabisan nyawa di jalanan Solmar Bay.';
    }
    showOnly(gameoverEl);
    bus.emit('mode', { mode });
  } else if (mode === 'complete') {
    if (gameoverTitle) gameoverTitle.textContent = 'SOLMAR BAY MILIKMU!';
    if (gameoverText) gameoverText.textContent = 'Semua misi selesai. Kota ini sekarang milikmu.';
    showOnly(gameoverEl);
    bus.emit('mode', { mode });
  }
}

export function startGame() {
  if (state.mode === 'menu' || state.mode === 'busted' || state.mode === 'dead' || state.mode === 'complete') {
    // Reset ringan untuk permainan baru.
    if (state.mode !== 'menu') {
      state.health = 100;
      state.armor = 0;
      state.money = 250;
      state.wanted = 0;
      state.wantedHeat = 0;
      state.player.x = state.city.spawns.player.x;
      state.player.z = state.city.spawns.player.z;
      state.player.heading = 0;
      state.player.onFoot = true;
      state.player.vehicleId = null;
      state.player.weapon = 'fists';
      state.player.ammo = 0;
      state.mission.index = 0;
      state.mission.id = 'intro';
      state.mission.stage = 0;
      state.mission.done = false;
      state.stats.carsStolen = 0;
      state.stats.missionsDone = 0;
      state.stats.kills = 0;
      bus.emit('game-reset', {});
    }
    setMode('playing');
    // Beri tahu missions.js untuk (me)mulai M1 dari awal.
    bus.emit('game-start', {});
  } else if (state.mode === 'paused') {
    setMode('playing');
  }
}

// Tombol-tombol menu / pause / game over.
function wireButton(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}
wireButton('btn-start', startGame);
wireButton('btn-continue', () => {
  // Hanya lanjut bila ada save (pemuatannya di-emit handler hud.js);
  // kalau tidak ada save, tetap di menu + toast.
  if (hasSave()) {
    setMode('playing');
  } else {
    bus.emit('toast', { text: 'Belum ada save. Mulai game baru dulu.' });
  }
});
wireButton('btn-restart', startGame);
wireButton('btn-howto', () => {
  const howto = document.getElementById('howto');
  if (howto) howto.classList.toggle('hidden');
});
wireButton('btn-menu', () => setMode('menu'));
wireButton('btn-menu-over', () => setMode('menu'));

// ---------- Loop utama ----------
// Esc = jeda / lanjut ditangani hud.js (keydown) — JANGAN ditangani di sini
// juga, supaya sekali tekan tidak jeda-lalu-lanjut dalam frame yang sama.
// Mode yang diubah langsung oleh modul lain (police: 'busted', combat: 'dead',
// hud: 'paused'/'playing') disinkronkan ke overlay lewat setMode di bawah;
// 'dialog' dan 'complete' dikecualikan — dialog diatur missions.js,
// 'complete' ditangani overlay kemenangan hud.js.
const clock = new THREE.Clock();
let menuAngle = 0;
let lastMode = state.mode;
function runSystems(dt) {
  for (const sys of window.__systems) {
    // Kontrak modul: update(dt, ctx) — state dibaca dari closure initSystem.
    // JANGAN panggil sys(state, dt, ctx): dt akan terisi objek state dan
    // semua aritmatika waktu jadi NaN (pernah terjadi: traffic/mobil NaN).
    try { sys(dt, ctx); } catch (err) { console.error('system error', err); }
  }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.mode !== lastMode) {
    const m = state.mode;
    lastMode = m;
    if (m === 'paused' || m === 'menu' || m === 'busted' || m === 'dead' || m === 'playing') {
      setMode(m);
    }
  }

  if (state.mode === 'playing') {
    state.time += dt;
    updatePlayer(state, input, dt, scene, camera);
    runSystems(dt);
  } else if (state.mode === 'menu') {
    // Sistem tetap jalan di menu supaya latar (mobil parkir, pejalan kaki,
    // traffic) sudah tampak saat kamera mengorbit.
    runSystems(dt);
    // Kamera menu: orbit pelan di atas plaza pusat.
    menuAngle += dt * 0.05;
    const r = 120;
    camera.position.set(Math.sin(menuAngle) * r, 70, Math.cos(menuAngle) * r);
    camera.lookAt(0, 0, 20);
  } else if (state.mode === 'busted' || state.mode === 'dead' || state.mode === 'complete') {
    if (input.pressed('Enter')) startGame();
  }

  // Bersihkan input sekali-tekan di akhir frame.
  input.update();
  renderer.render(scene, camera);
}

// ---------- State global untuk debug / play-test ----------
window.__game = {
  state,
  bus,
  input,
  scene,
  camera,
  renderer,
  setMode,
  startGame,
  registerSystem,
  systems: window.__systems,
};

setMode('menu');
frame();

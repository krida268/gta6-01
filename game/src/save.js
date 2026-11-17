// save.js — Simpan/muat progress "Solmar Bay" ke localStorage.
// Key: 'solmar-bay-save-v1'. Yang disimpan HANYA data plain (angka, string,
// objek polos): uang, health, armor, indeks misi, statistik, posisi player,
// dan waktu. TIDAK PERNAH menyimpan objek three.js, scene, atau fungsi.
//
// Kontrak yang dipakai:
//   state = { mode, time, money, health, armor, wanted,
//             player: { x, z, heading },
//             mission: { index, id },
//             stats: { carsStolen, missionsDone, kills } }
//   ctx.bus = { on(event, fn), emit(event, payload) }
//   ctx.registerUpdate(fn) = (opsional)
//
// Event bus yang didengarkan:
//   'save-request'  -> simpan sekarang, emit 'save-done' + toast
//   'request-load'  -> muat & terapkan ke state, emit 'save-loaded' / 'save-missing'
//   'mission-done'  -> autosave
//   'game-start'    -> (game baru) tidak menghapus save lama; save baru menimpanya
// initSystem memasang ctx.save = { saveGame, loadGame, hasSave, applySave }
// supaya HUD (tombol Continue / Save di pause menu) bisa memakainya langsung.

export const SAVE_KEY = 'solmar-bay-save-v1';

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

function isPlainNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// saveGame(state): tulis snapshot plain ke localStorage. Kembalikan true bila
// berhasil, false bila storage tidak tersedia / gagal.
// ---------------------------------------------------------------------------
export function saveGame(state) {
  const storage = safeStorage();
  if (!storage || !state) return false;
  const p = state.player || {};
  const data = {
    v: 1,
    savedAt: Date.now(),
    money: isPlainNumber(state.money) ? state.money : 0,
    health: isPlainNumber(state.health) ? state.health : 100,
    armor: isPlainNumber(state.armor) ? state.armor : 0,
    time: isPlainNumber(state.time) ? state.time : 0,
    missionIndex: state.mission && isPlainNumber(state.mission.index) ? state.mission.index : 0,
    missionId: state.mission && typeof state.mission.id === 'string' ? state.mission.id : null,
    stats: {
      carsStolen: state.stats && isPlainNumber(state.stats.carsStolen) ? state.stats.carsStolen : 0,
      missionsDone: state.stats && isPlainNumber(state.stats.missionsDone) ? state.stats.missionsDone : 0,
      kills: state.stats && isPlainNumber(state.stats.kills) ? state.stats.kills : 0,
    },
    player: {
      x: isPlainNumber(p.x) ? p.x : 0,
      z: isPlainNumber(p.z) ? p.z : 0,
      heading: isPlainNumber(p.heading) ? p.heading : 0,
    },
  };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// loadGame(): baca & validasi snapshot. Kembalikan objek data, atau null bila
// tidak ada save / rusak / versinya tidak dikenal.
// ---------------------------------------------------------------------------
export function loadGame() {
  const storage = safeStorage();
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== 1) return null;
  if (!isPlainNumber(data.money) || !isPlainNumber(data.health)) return null;
  if (!data.player || !isPlainNumber(data.player.x) || !isPlainNumber(data.player.z)) return null;
  if (!isPlainNumber(data.missionIndex)) return null;
  return data;
}

export function hasSave() {
  return loadGame() !== null;
}

export function clearSave() {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// applySave(state, data): terapkan snapshot ke state yang sedang berjalan.
// Hanya field plain yang disentuh; wanted direset ke 0 (polisi tidak
// "ikut tersimpan"), dan mode dikembalikan ke 'playing' oleh pemanggil.
// ---------------------------------------------------------------------------
export function applySave(state, data) {
  if (!state || !data) return false;
  state.money = data.money;
  state.health = data.health;
  state.armor = isPlainNumber(data.armor) ? data.armor : 0;
  if (isPlainNumber(data.time)) state.time = data.time;
  if (!state.mission) state.mission = { index: 0, id: null, stage: 0, objectiveText: '', target: null, done: false };
  state.mission.index = data.missionIndex;
  state.mission.id = data.missionId || null;
  state.mission.stage = 0;
  state.mission.done = false;
  if (!state.stats) state.stats = { carsStolen: 0, missionsDone: 0, kills: 0 };
  if (data.stats) {
    state.stats.carsStolen = data.stats.carsStolen || 0;
    state.stats.missionsDone = data.stats.missionsDone || 0;
    state.stats.kills = data.stats.kills || 0;
  }
  if (!state.player) state.player = {};
  state.player.x = data.player.x;
  state.player.z = data.player.z;
  state.player.heading = data.player.heading || 0;
  state.player.onFoot = true;
  state.player.vehicleId = null;
  state.wanted = 0;
  state.wantedHeat = 0;
  return true;
}

function dummyBus() {
  return { on() {}, emit() {} };
}

export function initSystem(state, scene, ctx) {
  const bus = (ctx && ctx.bus) || dummyBus();

  // Sediakan API save ke modul lain (HUD memakai ini untuk tombol Continue).
  if (ctx) {
    ctx.save = { saveGame, loadGame, hasSave, applySave, clearSave };
  }

  function doSave(quiet) {
    const ok = saveGame(state);
    if (ok && !quiet) bus.emit('toast', { text: 'Game tersimpan.' });
    if (!ok && !quiet) bus.emit('toast', { text: 'Gagal menyimpan (storage tidak tersedia).' });
    if (ok) bus.emit('save-done', { at: Date.now() });
    return ok;
  }

  function doLoad() {
    const data = loadGame();
    if (!data) {
      bus.emit('save-missing', {});
      return false;
    }
    applySave(state, data);
    // Beri tahu missions.js agar melompat ke misi tersimpan.
    bus.emit('save-loaded', { missionIndex: data.missionIndex, money: data.money });
    return true;
  }

  bus.on('save-request', () => doSave(false));
  bus.on('request-load', () => doLoad());
  // Autosave tiap misi selesai (juga saat game selesai).
  bus.on('mission-done', () => doSave(true));
  bus.on('game-complete', () => doSave(true));

  function update() {
    // Tidak ada pekerjaan per frame; autosave dipicu event.
  }

  if (ctx && typeof ctx.registerUpdate === 'function') {
    try { ctx.registerUpdate(update); } catch { /* abaikan */ }
  }

  return {
    update,
    saveGame,
    loadGame,
    hasSave,
    applySave,
    clearSave,
    saveNow: () => doSave(false),
    loadNow: () => doLoad(),
  };
}

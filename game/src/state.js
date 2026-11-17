// state.js — State bersama + event bus untuk game SOLMAR BAY.
// Semua sistem (vehicles, pedestrians, police, combat, missions, hud, audio)
// membaca dan menulis state yang sama. Posisi dunia memakai {x, z} dengan
// y = 0 di permukaan tanah. Heading dalam radian, SATU definisi untuk semua
// modul: 0 = menghadap +Z, arah maju = (sin h, cos h); mesh menghadap +Z
// (rotation.y = heading). Dipakai player.js, vehicles.js, traffic.js,
// police.js, combat.js, dan missions.js.

export function createBus() {
  const handlers = new Map();
  return {
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, []);
      handlers.get(evt).push(fn);
      return () => {
        const list = handlers.get(evt);
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit(evt, data) {
      const list = handlers.get(evt);
      if (!list) return;
      // Salin daftar supaya handler yang unsubscribe di tengah jalan aman.
      for (const fn of list.slice()) {
        try { fn(data); } catch (err) { console.error('bus handler error', evt, err); }
      }
    },
  };
}

export const bus = createBus();

// Collider AABB: { minX, maxX, minZ, maxZ }.
// Kendaraan: { id, kind: 'sedan'|'taxi'|'truck'|'sport'|'police',
//   x, z, heading, speed, color, driver: 'player'|'traffic'|'police'|'none' }.
// Polisi: { id, x, z, heading, speed, onFoot, vehicleId }.
// Ped: { id, x, z, heading, speed, kind }.
export function createGameState() {
  return {
    mode: 'menu', // 'menu' | 'playing' | 'paused' | 'busted' | 'dead' | 'complete'
    time: 0, // detik sejak mode playing dimulai
    money: 250,
    health: 100,
    armor: 0,
    wanted: 0, // 0..5 bintang
    wantedHeat: 0, // 0..100, panas yang menaikkan/menurunkan wanted
    player: {
      x: 0,
      z: 0,
      heading: 0,
      speed: 0,
      onFoot: true,
      vehicleId: null,
      weapon: 'fists', // 'fists' | 'pistol' | 'smg' | 'shotgun'
      ammo: 0,
    },
    vehicles: [],
    peds: [],
    police: [],
    mission: {
      index: 0,
      id: 'intro',
      stage: 0,
      objectiveText: 'Selamat datang di Solmar Bay',
      target: null, // { x, z, radius } atau null
      done: false,
    },
    flags: {},
    stats: {
      carsStolen: 0,
      missionsDone: 0,
      kills: 0,
    },
    city: {
      colliders: [], // AABB { minX, maxX, minZ, maxZ }
      roads: [], // segmen jalan { x1, z1, x2, z2 } untuk traffic
      spawns: {
        player: { x: 0, z: 0 },
        cars: [], // { x, z, heading }
        peds: [], // { x, z }
      },
    },
  };
}

// Satu state global untuk sesi ini; modul lain mengimpor state yang sama.
export const state = createGameState();

// Helper kecil yang dipakai beberapa sistem.
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Apakah titik (x, z) dengan radius r bertabrakan dengan collider AABB mana pun.
export function collidesWithCity(stateObj, x, z, r) {
  for (const c of stateObj.city.colliders) {
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) {
      return c;
    }
  }
  return null;
}

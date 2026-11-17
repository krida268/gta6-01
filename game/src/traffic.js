// traffic.js — Mobil lalu-lintas AI untuk SOLMAR BAY.
// ~14 mobil mengikuti segmen jalan state.city.roads di lajur kanan,
// kecepatan 8-14, berhenti sebentar di persimpangan, melambat kalau ada
// mobil di depan, dan respawn saat mencapai ujung jalan atau dicuri pemain.
//
// Kontrak: export initSystem(state, scene, ctx) -> update(dt).
// Mobil traffic hidup di state.vehicles dengan driver 'traffic'; mesh-nya
// digambar oleh vehicles.js. Modul ini hanya mengatur posisi/heading/speed.

import { bus as busSingleton } from './state.js';

const TRAFFIC_COUNT = 14;
const LANE_OFFSET = 3; // lajur kanan: 3 unit dari tengah jalan
const MIN_SPEED = 8;
const MAX_SPEED = 14;

let trafficCounter = 0;
function nextTrafficId() {
  trafficCounter += 1;
  return `traf-${trafficCounter}`;
}

const TRAFFIC_KINDS = ['sedan', 'sedan', 'sedan', 'taxi', 'truck', 'sport', 'sedan', 'taxi'];
const TRAFFIC_COLORS = [0xef476f, 0x118ab2, 0x06d6a0, 0xffd166, 0x8ecae6, 0xc77dff, 0x90be6d, 0xf4a261, 0xe07a5f];

function pick(arr, randFn) {
  return arr[Math.floor(randFn() * arr.length)];
}

export function initSystem(state, scene, ctx) {
  const evt = (ctx && ctx.bus) || busSingleton;
  const rand = Math.random;
  // id mobil -> AI { road, t, dir, speed, targetSpeed, stopped, stopTimer }
  const ai = new Map();
  let spawned = false;
  let replaceTimer = 0;

  function roadLength(road) {
    return Math.hypot(road.x2 - road.x1, road.z2 - road.z1);
  }

  // Posisi di jalan: lerp segmen + offset lajur kanan.
  function roadPoint(road, t, dir) {
    const len = roadLength(road);
    const dx = (road.x2 - road.x1) / len;
    const dz = (road.z2 - road.z1) / len;
    // Arah jalan sesuai dir (+1 ke ujung, -1 ke awal).
    const fx = dx * dir;
    const fz = dz * dir;
    // Kanan dari arah maju: (-fz, fx) dalam (x, z).
    const rx = -fz;
    const rz = fx;
    const x = road.x1 + dx * len * t + rx * LANE_OFFSET;
    const z = road.z1 + dz * len * t + rz * LANE_OFFSET;
    const heading = Math.atan2(fx, fz);
    return { x, z, heading, len };
  }

  function spawnTrafficCar() {
    const roads = state.city.roads;
    if (!roads || roads.length === 0) return null;
    if (!Array.isArray(state.vehicles)) state.vehicles = [];
    const road = pick(roads, rand);
    const dir = rand() < 0.5 ? 1 : -1;
    const t = 0.05 + rand() * 0.9;
    const pt = roadPoint(road, t, dir);
    const kind = pick(TRAFFIC_KINDS, rand);
    const v = {
      id: nextTrafficId(),
      kind,
      x: pt.x,
      z: pt.z,
      heading: pt.heading,
      speed: MIN_SPEED + rand() * (MAX_SPEED - MIN_SPEED),
      color: kind === 'taxi' ? 0xffd21f : pick(TRAFFIC_COLORS, rand),
      driver: 'traffic',
      hp: 100,
      maxSpeed: MAX_SPEED,
    };
    state.vehicles.push(v);
    ai.set(v.id, {
      road,
      t,
      dir,
      targetSpeed: v.speed,
      stopped: false,
      stopTimer: 0,
      blockedTimer: 0,
    });
    return v;
  }

  function spawnInitial() {
    if (spawned) return;
    spawned = true;
    for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTrafficCar();
  }

  // Cari segmen jalan lain yang tersambung di ujung segmen ini.
  function nextRoadAt(road, atEnd) {
    const ex = atEnd ? road.x2 : road.x1;
    const ez = atEnd ? road.z2 : road.z1;
    const roads = state.city.roads;
    const candidates = [];
    for (const r of roads) {
      if (r === road) continue;
      const dStart = Math.hypot(r.x1 - ex, r.z1 - ez);
      const dEnd = Math.hypot(r.x2 - ex, r.z2 - ez);
      if (dStart < 3) candidates.push({ road: r, t: 0, dir: 1 });
      else if (dEnd < 3) candidates.push({ road: r, t: 1, dir: -1 });
    }
    if (candidates.length === 0) return null;
    return pick(candidates, rand);
  }

  // Mobil di depan dalam jalur yang sama? Kembalikan jarak & kecepatannya.
  function carAhead(v, fx, fz) {
    let bestGap = Infinity;
    let bestSpeed = 0;
    for (const other of state.vehicles) {
      if (other === v) continue;
      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const proj = dx * fx + dz * fz; // jarak ke depan
      if (proj <= 0 || proj > 11) continue;
      const lat = Math.abs(dx * -fz + dz * fx); // jarak lateral
      if (lat > 2.6) continue;
      // Hanya yang searah (heading mirip).
      const dot = Math.sin(other.heading) * fx + Math.cos(other.heading) * fz;
      if (dot < 0.5) continue;
      if (proj < bestGap) { bestGap = proj; bestSpeed = other.speed; }
    }
    return { gap: bestGap, speed: bestSpeed };
  }

  function update(dt) {
    // Spawn malas: tunggu kota selesai dibangun.
    if (!spawned && state.city && state.city.roads.length > 0) spawnInitial();
    if (state.mode !== 'playing') return;

    // Bersihkan AI untuk mobil traffic yang sudah dicuri / hilang / rusak total.
    for (const [id, a] of ai) {
      const v = state.vehicles.find((car) => car.id === id);
      if (!v || v.driver !== 'traffic') ai.delete(id);
    }

    // Jaga jumlah traffic ~14 (ganti yang hilang, dengan jeda singkat).
    replaceTimer -= dt;
    if (replaceTimer <= 0) {
      replaceTimer = 1.5;
      let count = 0;
      for (const v of state.vehicles) if (v.driver === 'traffic') count += 1;
      if (count < TRAFFIC_COUNT) spawnTrafficCar();
    }

    for (const [id, a] of ai) {
      const v = state.vehicles.find((car) => car.id === id);
      if (!v) continue;

      // Berhenti di persimpangan.
      if (a.stopped) {
        a.stopTimer -= dt;
        v.speed += (0 - v.speed) * Math.min(1, 8 * dt);
        if (a.stopTimer <= 0) a.stopped = false;
        continue;
      }

      const len = roadLength(a.road);
      const dx = (a.road.x2 - a.road.x1) / len;
      const dz = (a.road.z2 - a.road.z1) / len;
      const fx = dx * a.dir;
      const fz = dz * a.dir;

      // Melambat kalau ada mobil di depan.
      const ahead = carAhead(v, fx, fz);
      let target = a.targetSpeed;
      if (ahead.gap < 10) {
        if (ahead.gap < 4) target = 0;
        else target = Math.min(target, Math.max(0, ahead.speed * 0.85));
      }
      // Terjebak macet di belakang mobil parkir / roadblock: pindah jalan.
      if (target === 0 && v.speed < 0.5) {
        a.blockedTimer += dt;
        if (a.blockedTimer > 5) {
          const roads = state.city.roads;
          const road = pick(roads, rand);
          a.road = road;
          a.dir = rand() < 0.5 ? 1 : -1;
          a.t = 0.05 + rand() * 0.9;
          a.blockedTimer = 0;
          a.stopped = false;
        }
      } else {
        a.blockedTimer = 0;
      }
      // Mobil rusak berat berhenti.
      if (v.hp <= 0) target = 0;
      v.speed += (target - v.speed) * Math.min(1, 2.2 * dt);

      // Maju sepanjang segmen.
      a.t += (v.speed * dt * a.dir) / len;
      const endReached = (a.dir === 1 && a.t >= 1) || (a.dir === -1 && a.t <= 0);
      if (endReached) {
        const atEnd = a.dir === 1;
        // Kadang berhenti sebentar di persimpangan.
        if (rand() < 0.35) {
          a.stopped = true;
          a.stopTimer = 1 + rand() * 1.5;
        }
        const next = nextRoadAt(a.road, atEnd);
        if (next) {
          a.road = next.road;
          a.t = next.t;
          a.dir = next.dir;
        } else {
          // Jalan buntu: putar balik di tempat (respawn di jalan acak).
          const roads = state.city.roads;
          const road = pick(roads, rand);
          a.road = road;
          a.dir = rand() < 0.5 ? 1 : -1;
          a.t = 0.05 + rand() * 0.9;
        }
      }

      const pt = roadPoint(a.road, Math.max(0, Math.min(1, a.t)), a.dir);
      v.x = pt.x;
      v.z = pt.z;
      v.heading = pt.heading;
    }
  }

  // Beri tahu modul lain lewat bus (dipakai kalau ada yang mendengarkan).
  void evt;
  return update;
}

export default initSystem;

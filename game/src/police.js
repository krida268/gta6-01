// police.js — Sistem wanted 0-5 bintang + AI patroli untuk SOLMAR BAY.
// Wanted naik saat kejahatan (curi mobil, tabrak pejalan kaki, tembak,
// bunuh petugas) lewat bus, turun perlahan saat bersembunyi. Polisi
// jalan kaki mengejar & menangkap (mode 'busted'), mobil patroli mengejar
// & menabrak mobil pemain, roadblock di level 3+, tembakan polisi di
// level 3+ (kerusakan lewat bus 'player-hurt', diterapkan combat.js).
// Lampu strobo digambar vehicles.js; sirene disiarkan lewat bus 'siren'.
//
// Kontrak: export initSystem(state, scene, ctx) -> update(dt).
// Field di entri state.police yang dipakai modul ini:
//   hp (100), dead (bool), stun (detik) — hp/dead ditulis juga combat.js.

import * as THREE from 'three';
import { bus as busSingleton, clamp, collidesWithCity } from './state.js';

const HEAT_CAR_STOLEN = 14;
const HEAT_PED_HIT = 22;
const HEAT_GUNSHOT = 8;
const HEAT_KILL = 12;
const HEAT_KILL_POLICE = 26;
const DECAY_DELAY = 20; // detik tanpa kejahatan sebelum wanted turun
const DECAY_RATE = 2.0; // heat per detik saat bersembunyi
const HIDE_DIST = 35; // tidak ada polisi dalam jarak ini = bersembunyi

// Jumlah unit yang diinginkan per level: [jalan kaki, mobil patroli, roadblock].
const LEVEL_UNITS = [
  { foot: 0, cars: 0, roadblock: false },
  { foot: 1, cars: 1, roadblock: false },
  { foot: 2, cars: 1, roadblock: false },
  { foot: 2, cars: 2, roadblock: true },
  { foot: 3, cars: 3, roadblock: true },
  { foot: 4, cars: 4, roadblock: true },
];

const FOOT_SPEED = 5.0;
const CAR_TOP_SPEED = [0, 15, 15.5, 16.5, 17.5, 19];
const ARREST_DIST_FOOT = 2.0;
const ARREST_DIST_CAR = 3.2;
const ARREST_TIME = 1.2;
const SHOOT_RANGE = 20;
const SHOOT_INTERVAL = 1.4;

let policeCounter = 0;
function nextPoliceId() {
  policeCounter += 1;
  return `pol-${policeCounter}`;
}

function heatToLevel(heat) {
  if (heat < 8) return 0;
  if (heat < 25) return 1;
  if (heat < 45) return 2;
  if (heat < 65) return 3;
  if (heat < 85) return 4;
  return 5;
}

function buildCopMesh() {
  const group = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14213d, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 10), navy);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  // Lencana kuning di dada.
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.5 }),
  );
  badge.position.set(-0.12, 1.25, 0.28);
  group.add(badge);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);

  // Topi patroli.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.1, 14), dark);
  cap.position.y = 1.92;
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.2), dark);
  brim.position.set(0, 1.88, 0.22);
  group.add(brim);

  const armGeo = new THREE.BoxGeometry(0.14, 0.6, 0.14);
  const armL = new THREE.Mesh(armGeo, navy);
  armL.position.set(-0.38, 1.15, 0);
  const armR = new THREE.Mesh(armGeo, navy);
  armR.position.set(0.38, 1.15, 0);
  group.add(armL, armR);

  const legGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.13, 0.32, 0);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.13, 0.32, 0);
  group.add(legL, legR);

  return { group, armL, armR, legL, legR };
}

export function initSystem(state, scene, ctx) {
  const evt = (ctx && ctx.bus) || busSingleton;
  const rand = Math.random;
  // id polisi -> { mesh, ai: 'foot'|'car'|'roadblock', arrestTimer, shootTimer,
  //   walkPhase, stunTimer, roadblockTimer }
  const cops = new Map();
  let lastCrimeAt = -1000;
  let time = 0;
  let sirenOn = false;
  let prevMode = state.mode;

  function setSiren(on) {
    if (on === sirenOn) return;
    sirenOn = on;
    evt.emit('siren', { on });
  }

  function addHeat(amount) {
    state.wantedHeat = clamp(state.wantedHeat + amount, 0, 100);
    lastCrimeAt = time;
    const level = heatToLevel(state.wantedHeat);
    if (level !== state.wanted) {
      const prev = state.wanted;
      state.wanted = level;
      evt.emit('wanted', { level, prev });
    }
  }

  evt.on('car-stolen', () => addHeat(HEAT_CAR_STOLEN));
  evt.on('ped-hit', () => addHeat(HEAT_PED_HIT));
  evt.on('gunshot', () => addHeat(HEAT_GUNSHOT));
  evt.on('kill', (data) => {
    addHeat(data && data.kind === 'police' ? HEAT_KILL_POLICE : HEAT_KILL);
  });

  function randomRoadPointNear(px, pz, minD, maxD) {
    const roads = state.city.roads;
    if (!roads || roads.length === 0) return { x: px + 25, z: pz };
    for (let tries = 0; tries < 12; tries++) {
      const road = roads[Math.floor(rand() * roads.length)];
      const t = rand();
      const x = road.x1 + (road.x2 - road.x1) * t;
      const z = road.z1 + (road.z2 - road.z1) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d >= minD && d <= maxD) return { x, z };
    }
    return { x: px + minD, z: pz };
  }

  function spawnFootCop() {
    const p = state.player;
    const spot = randomRoadPointNear(p.x, p.z, 18, 38);
    const cop = {
      id: nextPoliceId(),
      x: spot.x,
      z: spot.z,
      heading: 0,
      speed: 0,
      onFoot: true,
      vehicleId: null,
      hp: 100,
      dead: false,
      stun: 0,
    };
    state.police.push(cop);
    const mesh = buildCopMesh();
    scene.add(mesh.group);
    cops.set(cop.id, { mesh, ai: 'foot', arrestTimer: 0, shootTimer: 1 + rand(), walkPhase: rand() * 6, stunTimer: 0 });
    return cop;
  }

  function spawnPatrolCar() {
    const p = state.player;
    const spot = randomRoadPointNear(p.x, p.z, 22, 42);
    if (!Array.isArray(state.vehicles)) state.vehicles = [];
    const vehicleId = `polcar-${Date.now() % 100000}-${Math.floor(rand() * 1000)}`;
    const v = {
      id: vehicleId,
      kind: 'police',
      x: spot.x,
      z: spot.z,
      heading: rand() * Math.PI * 2,
      speed: 0,
      color: 0xf5f5f5,
      driver: 'police',
      hp: 100,
      maxSpeed: CAR_TOP_SPEED[state.wanted] || 16,
    };
    state.vehicles.push(v);
    const cop = {
      id: nextPoliceId(),
      x: spot.x,
      z: spot.z,
      heading: v.heading,
      speed: 0,
      onFoot: false,
      vehicleId,
      hp: 100,
      dead: false,
      stun: 0,
    };
    state.police.push(cop);
    cops.set(cop.id, { mesh: null, ai: 'car', arrestTimer: 0, shootTimer: 1 + rand(), walkPhase: 0, stunTimer: 0 });
    return cop;
  }

  function spawnRoadblock() {
    const p = state.player;
    // Dua mobil patroli melintang di jalan di depan arah pemain.
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const cx = p.x + fx * 30;
    const cz = p.z + fz * 30;
    for (const side of [-1, 1]) {
      const v = {
        id: `polblock-${Date.now() % 100000}-${side}-${Math.floor(rand() * 1000)}`,
        kind: 'police',
        x: cx - fz * side * 3.2,
        z: cz + fx * side * 3.2,
        heading: Math.atan2(fx, fz) + Math.PI / 2,
        speed: 0,
        color: 0xf5f5f5,
        driver: 'police',
        hp: 100,
        maxSpeed: 0,
      };
      state.vehicles.push(v);
      const cop = {
        id: nextPoliceId(),
        x: v.x,
        z: v.z,
        heading: v.heading,
        speed: 0,
        onFoot: false,
        vehicleId: v.id,
        hp: 100,
        dead: false,
        stun: 0,
      };
      state.police.push(cop);
      cops.set(cop.id, { mesh: null, ai: 'roadblock', arrestTimer: 0, shootTimer: 0, walkPhase: 0, stunTimer: 0, roadblockTimer: 0 });
    }
  }

  function removeCop(cop) {
    const m = cops.get(cop.id);
    if (m && m.mesh) scene.remove(m.mesh.group);
    cops.delete(cop.id);
    if (cop.vehicleId) {
      const vi = state.vehicles.findIndex((v) => v.id === cop.vehicleId);
      if (vi >= 0) state.vehicles.splice(vi, 1);
    }
    const pi = state.police.indexOf(cop);
    if (pi >= 0) state.police.splice(pi, 1);
  }

  function clearAllPolice() {
    for (const cop of state.police.slice()) removeCop(cop);
    setSiren(false);
  }

  function bustPlayer(fine) {
    state.mode = 'busted';
    state.money = Math.max(0, Math.floor(state.money - fine));
    evt.emit('busted', { fine, money: state.money });
  }

  function update(dt) {
    time += dt;

    // Respawn setelah ditangkap / mati: wanted bersih, polisi bubar.
    if (prevMode !== state.mode && state.mode === 'playing' && (prevMode === 'busted' || prevMode === 'dead')) {
      state.wanted = 0;
      state.wantedHeat = 0;
      clearAllPolice();
    }
    prevMode = state.mode;

    // Sinkron mesh polisi jalan kaki (mobil patroli digambar vehicles.js).
    for (const [id, m] of cops) {
      const cop = state.police.find((c) => c.id === id);
      if (!cop || !m.mesh) continue;
      m.mesh.group.position.set(cop.x, 0, cop.z);
      m.mesh.group.rotation.y = cop.heading;
    }

    if (state.mode !== 'playing') return;

    const p = state.player;
    const level = state.wanted;
    const want = LEVEL_UNITS[level] || LEVEL_UNITS[0];

    // --- Turunkan wanted saat bersembunyi. ---
    const anyNear = state.police.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < HIDE_DIST);
    if (time - lastCrimeAt > DECAY_DELAY && !anyNear && state.wantedHeat > 0) {
      state.wantedHeat = Math.max(0, state.wantedHeat - DECAY_RATE * dt);
      const newLevel = heatToLevel(state.wantedHeat);
      if (newLevel !== state.wanted) {
        const prev = state.wanted;
        state.wanted = newLevel;
        evt.emit('wanted', { level: newLevel, prev });
      }
    }

    // --- Hapus polisi mati (ditembak combat.js) & yang kendaraannya hancur. ---
    for (const cop of state.police.slice()) {
      if (cop.dead || cop.hp <= 0) {
        removeCop(cop);
        continue;
      }
      if (!cop.onFoot && cop.vehicleId) {
        const v = state.vehicles.find((car) => car.id === cop.vehicleId);
        if (!v) { removeCop(cop); continue; }
        if (v.driver === 'player') {
          // Mobil patroli dicuri pemain: petugasnya hilang, mobil tetap milik pemain.
          cops.delete(cop.id);
          const pi = state.police.indexOf(cop);
          if (pi >= 0) state.police.splice(pi, 1);
          continue;
        }
        if (v.hp <= 0 && cops.get(cop.id) && cops.get(cop.id).ai === 'car') {
          // Mobil patroli hancur: petugas keluar jadi pejalan kaki pengejar.
          const idx = state.vehicles.indexOf(v);
          if (idx >= 0) state.vehicles.splice(idx, 1);
          cop.onFoot = true;
          cop.vehicleId = null;
          cop.x = v.x;
          cop.z = v.z;
          const mesh = buildCopMesh();
          scene.add(mesh.group);
          const entry = cops.get(cop.id);
          entry.mesh = mesh;
          entry.ai = 'foot';
        }
      }
    }

    // --- Jaga jumlah unit sesuai level. ---
    let footCount = 0;
    let carCount = 0;
    let hasRoadblock = false;
    for (const cop of state.police) {
      const entry = cops.get(cop.id);
      if (!entry) continue;
      if (entry.ai === 'foot') footCount += 1;
      else if (entry.ai === 'car') carCount += 1;
      else if (entry.ai === 'roadblock') hasRoadblock = true;
    }
    if (level === 0) {
      // Wanted habis: bubarkan semua polisi.
      if (state.police.length > 0) clearAllPolice();
    } else {
      while (footCount < want.foot) { spawnFootCop(); footCount += 1; }
      while (carCount < want.cars) { spawnPatrolCar(); carCount += 1; }
      if (want.roadblock && !hasRoadblock) spawnRoadblock();
      // Kelebihan unit (level turun): hapus yang terjauh dulu.
      if (footCount > want.foot || carCount > want.cars) {
        const sorted = state.police.slice().sort((a, b) =>
          Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(a.x - p.x, a.z - p.z));
        for (const cop of sorted) {
          const entry = cops.get(cop.id);
          if (!entry) continue;
          if (entry.ai === 'foot' && footCount > want.foot) { removeCop(cop); footCount -= 1; }
          else if (entry.ai === 'car' && carCount > want.cars) { removeCop(cop); carCount -= 1; }
        }
      }
    }

    setSiren(state.police.length > 0);

    // --- AI tiap polisi. ---
    for (const cop of state.police.slice()) {
      const entry = cops.get(cop.id);
      if (!entry) continue;
      const dPlayer = Math.hypot(p.x - cop.x, p.z - cop.z);

      // Stun (dipukul combat.js): diam sebentar.
      if (cop.stun > 0) {
        cop.stun -= dt;
        continue;
      }

      if (entry.ai === 'foot') {
        // Kejar pemain dengan lari.
        const dx = p.x - cop.x;
        const dz = p.z - cop.z;
        const d = Math.max(0.01, Math.hypot(dx, dz));
        const targetHeading = Math.atan2(dx, dz);
        let diff = targetHeading - cop.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        cop.heading += clamp(diff, -4 * dt, 4 * dt);
        cop.speed = FOOT_SPEED;
        cop.x += Math.sin(cop.heading) * cop.speed * dt;
        cop.z += Math.cos(cop.heading) * cop.speed * dt;
        // Animasi lari.
        if (entry.mesh) {
          entry.walkPhase += dt * 12;
          const s = Math.sin(entry.walkPhase);
          entry.mesh.legL.rotation.x = s * 0.7;
          entry.mesh.legR.rotation.x = -s * 0.7;
          entry.mesh.armL.rotation.x = -s * 0.6;
          entry.mesh.armR.rotation.x = s * 0.6;
        }
        // Tangkap kalau dekat & pemain jalan kaki.
        if (p.onFoot && dPlayer < ARREST_DIST_FOOT) {
          entry.arrestTimer += dt;
          if (entry.arrestTimer >= ARREST_TIME) {
            bustPlayer(50 + level * 50);
            return;
          }
        } else {
          entry.arrestTimer = 0;
        }
        // Tembak pemain di level 3+.
        if (level >= 3 && dPlayer < SHOOT_RANGE && dPlayer > 4) {
          entry.shootTimer -= dt;
          if (entry.shootTimer <= 0) {
            entry.shootTimer = SHOOT_INTERVAL + rand() * 0.6;
            if (rand() < 0.4) {
              evt.emit('player-hurt', { damage: 5 + level, from: 'police' });
            }
          }
        }
      } else if (entry.ai === 'car') {
        const v = state.vehicles.find((car) => car.id === cop.vehicleId);
        if (!v) continue;
        // Kejar posisi pemain: belok ke arah target, gas penuh.
        const dx = p.x - v.x;
        const dz = p.z - v.z;
        const d = Math.max(0.01, Math.hypot(dx, dz));
        const targetHeading = Math.atan2(dx, dz);
        let diff = targetHeading - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const top = CAR_TOP_SPEED[level] || 16;
        v.maxSpeed = top;
        v.heading += clamp(diff, -1.6 * dt, 1.6 * dt);
        const desired = d > 6 ? top : top * 0.5;
        v.speed += (desired - v.speed) * Math.min(1, 1.8 * dt);
        // Gerak + tabrakan gedung (pisah sumbu -> slide).
        const fx = Math.sin(v.heading);
        const fz = Math.cos(v.heading);
        const nx = v.x + fx * v.speed * dt;
        const nz = v.z + fz * v.speed * dt;
        if (!collidesWithCity(state, nx, v.z, 1.6)) v.x = nx;
        else v.speed *= 0.5;
        if (!collidesWithCity(state, v.x, nz, 1.6)) v.z = nz;
        else v.speed *= 0.5;
        cop.x = v.x;
        cop.z = v.z;
        cop.heading = v.heading;
        cop.speed = v.speed;
        // Menabrak mobil pemain: dorong + rusak.
        if (!p.onFoot && p.vehicleId) {
          const pv = state.vehicles.find((car) => car.id === p.vehicleId);
          if (pv && Math.hypot(pv.x - v.x, pv.z - v.z) < 3.4) {
            pv.hp = Math.max(0, pv.hp - 6);
            pv.speed *= 0.7;
            evt.emit('crash', { vehicleId: pv.id, speed: Math.abs(v.speed), x: pv.x, z: pv.z });
          }
        }
        // Tangkap pemain jalan kaki yang didekati mobil patroli.
        if (p.onFoot && dPlayer < ARREST_DIST_CAR) {
          entry.arrestTimer += dt;
          if (entry.arrestTimer >= ARREST_TIME + 0.3) {
            bustPlayer(50 + level * 50);
            return;
          }
        } else {
          entry.arrestTimer = 0;
        }
        // Tembakan drive-by di level 4+.
        if (level >= 4 && dPlayer < SHOOT_RANGE) {
          entry.shootTimer -= dt;
          if (entry.shootTimer <= 0) {
            entry.shootTimer = SHOOT_INTERVAL + rand() * 0.8;
            if (rand() < 0.3) {
              evt.emit('player-hurt', { damage: 4 + level, from: 'police' });
            }
          }
        }
      } else if (entry.ai === 'roadblock') {
        // Diam di tempat; bubar kalau pemain sudah jauh atau wanted turun.
        entry.roadblockTimer += dt;
        const v = state.vehicles.find((car) => car.id === cop.vehicleId);
        if (v) { cop.x = v.x; cop.z = v.z; }
        if (dPlayer > 90 || !want.roadblock) removeCop(cop);
      }
    }
  }

  return update;
}

export default initSystem;

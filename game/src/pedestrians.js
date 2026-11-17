// pedestrians.js — Pejalan kaki prosedural untuk SOLMAR BAY.
// ~24 pejalan kaki warna-warni berjalan di trotoar (offset dari jalan),
// ganti arah di persimpangan, lari menjauh saat ada tembakan di dekatnya,
// dan bisa tertabrak mobil (jatuh; kalau yang menabrak mobil pemain,
// wanted naik lewat bus 'ped-hit').
//
// Kontrak: export initSystem(state, scene, ctx) -> update(dt).
// Field di entri state.peds yang dipakai modul ini:
//   down (bool), downTimer (detik), dead (bool) — ditulis juga oleh combat.js.

import * as THREE from 'three';
import { bus as busSingleton, clamp } from './state.js';

const PED_COUNT = 24;
const SIDEWALK_OFFSET = 8.2; // trotoar: 8,2 unit dari tengah jalan
const FLEE_RADIUS = 28; // jarak tembakan yang membuat ped lari
const FLEE_SPEED = 5.5;
const HIT_SPEED = 3; // mobil lebih cepat dari ini bisa menabrak ped
const HIT_DIST = 1.5;
const DOWN_TIME = 4; // detik ped tergeletak sebelum bangun

let pedCounter = 0;
function nextPedId() {
  pedCounter += 1;
  return `ped-${pedCounter}`;
}

const SKIN_COLORS = [0xe8b88a, 0xc98d5f, 0x8a5a3b, 0xf2c9a0];
const SHIRT_COLORS = [0xef476f, 0x118ab2, 0x06d6a0, 0xffd166, 0x8ecae6, 0xc77dff, 0xff8fa3, 0x90be6d, 0xf4a261];
const PANTS_COLORS = [0x264653, 0x3a3f46, 0x6d6875, 0x2a9d8f];

function pick(arr, randFn) {
  return arr[Math.floor(randFn() * arr.length)];
}

function buildPedMesh(shirtColor, pantsColor, skinColor, scale) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 4, 10), shirt);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);

  // Topi / rambut: setengah bola warna gelap.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.95 }),
  );
  hair.position.y = 1.76;
  group.add(hair);

  const armGeo = new THREE.BoxGeometry(0.14, 0.6, 0.14);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.36, 1.15, 0);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.36, 1.15, 0);
  group.add(armL, armR);

  const legGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.12, 0.32, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.12, 0.32, 0);
  legR.castShadow = true;
  group.add(legL, legR);

  group.scale.setScalar(scale);
  return { group, armL, armR, legL, legR };
}

export function initSystem(state, scene, ctx) {
  const evt = (ctx && ctx.bus) || busSingleton;
  const rand = Math.random;
  // id ped -> { group, armL, armR, legL, legR, road, t, dir, side, speed,
  //   walkPhase, fleeTimer, fleeX, fleeZ, fallT, fadeT, baseY }
  const peds = new Map();
  let spawned = false;
  let time = 0;

  // Tembakan / ledakan di dekat ped -> ped lari menjauh.
  evt.on('gunshot', (data) => {
    if (!data) return;
    for (const [id, m] of peds) {
      const ped = state.peds.find((p) => p.id === id);
      if (!ped || ped.down || ped.dead) continue;
      const d = Math.hypot(ped.x - data.x, ped.z - data.z);
      if (d > FLEE_RADIUS) continue;
      // Arah lari: menjauh dari sumber, dijepit ke sumbu dominan (tetap di jalan).
      let dx = ped.x - data.x;
      let dz = ped.z - data.z;
      if (Math.abs(dx) > Math.abs(dz)) { dz = 0; dx = Math.sign(dx) || 1; }
      else { dx = 0; dz = Math.sign(dz) || 1; }
      m.fleeX = dx;
      m.fleeZ = dz;
      m.fleeTimer = 2.5 + rand() * 1.5;
    }
  });

  function roadLength(road) {
    return Math.hypot(road.x2 - road.x1, road.z2 - road.z1);
  }

  function nearestRoad(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const road of state.city.roads) {
      // Jarak titik ke segmen.
      const len = roadLength(road);
      const dx = (road.x2 - road.x1) / len;
      const dz = (road.z2 - road.z1) / len;
      const t = clamp(((x - road.x1) * dx + (z - road.z1) * dz) / len, 0, 1);
      const px = road.x1 + dx * len * t;
      const pz = road.z1 + dz * len * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; best = { road, t }; }
    }
    return best;
  }

  function nextRoadAt(road, atEnd) {
    const ex = atEnd ? road.x2 : road.x1;
    const ez = atEnd ? road.z2 : road.z1;
    const candidates = [];
    for (const r of state.city.roads) {
      if (r === road) continue;
      if (Math.hypot(r.x1 - ex, r.z1 - ez) < 3) candidates.push({ road: r, t: 0, dir: 1 });
      else if (Math.hypot(r.x2 - ex, r.z2 - ez) < 3) candidates.push({ road: r, t: 1, dir: -1 });
    }
    if (candidates.length === 0) return null;
    return pick(candidates, rand);
  }

  function spawnPed(sx, sz) {
    const kind = pick(['adult', 'adult', 'adult', 'elder', 'tourist'], rand);
    const speed = kind === 'elder' ? 0.9 + rand() * 0.3 : 1.2 + rand() * 1.1;
    const scale = kind === 'elder' ? 0.94 : 0.97 + rand() * 0.12;
    const ped = {
      id: nextPedId(),
      x: sx,
      z: sz,
      heading: rand() * Math.PI * 2,
      speed,
      kind,
      down: false,
      downTimer: 0,
      dead: false,
    };
    state.peds.push(ped);
    const mesh = buildPedMesh(pick(SHIRT_COLORS, rand), pick(PANTS_COLORS, rand), pick(SKIN_COLORS, rand), scale);
    scene.add(mesh.group);
    const near = nearestRoad(sx, sz);
    peds.set(ped.id, {
      ...mesh,
      road: near ? near.road : state.city.roads[0],
      t: near ? near.t : rand(),
      dir: rand() < 0.5 ? 1 : -1,
      side: rand() < 0.5 ? 1 : -1,
      speed,
      walkPhase: rand() * Math.PI * 2,
      fleeTimer: 0,
      fleeX: 0,
      fleeZ: 1,
      fallT: 0,
      fadeT: 0,
    });
    return ped;
  }

  function spawnInitial() {
    if (spawned) return;
    spawned = true;
    if (!Array.isArray(state.peds)) state.peds = [];
    const spawns = (state.city && state.city.spawns && state.city.spawns.peds) || [];
    for (let i = 0; i < PED_COUNT; i++) {
      const s = spawns[i % Math.max(1, spawns.length)];
      if (s) spawnPed(s.x + (rand() - 0.5) * 6, s.z + (rand() - 0.5) * 6);
      else spawnPed((rand() - 0.5) * 100, (rand() - 0.5) * 100);
    }
  }

  // Posisi trotoar di sepanjang jalan.
  function sidewalkPoint(m, t) {
    const road = m.road;
    const len = roadLength(road);
    const dx = (road.x2 - road.x1) / len;
    const dz = (road.z2 - road.z1) / len;
    const rx = -dz * m.side;
    const rz = dx * m.side;
    return {
      x: road.x1 + dx * len * t + rx * SIDEWALK_OFFSET,
      z: road.z1 + dz * len * t + rz * SIDEWALK_OFFSET,
      heading: Math.atan2(dx * m.dir, dz * m.dir),
    };
  }

  function update(dt) {
    time += dt;
    if (!spawned && state.city && state.city.roads.length > 0) spawnInitial();

    // Bersihkan mesh ped yang sudah dihapus dari state.
    for (const [id, m] of peds) {
      if (!state.peds.find((p) => p.id === id)) {
        scene.remove(m.group);
        peds.delete(id);
      }
    }

    const playing = state.mode === 'playing';

    for (const ped of state.peds.slice()) {
      let m = peds.get(ped.id);
      if (!m) {
        // Ped yang ditambahkan modul lain (NPC misi: Dito / penjaga M6):
        // beri mesh supaya terlihat, tanpa AI trotoar (diam di tempat).
        const mesh = buildPedMesh(pick(SHIRT_COLORS, rand), pick(PANTS_COLORS, rand), pick(SKIN_COLORS, rand), 1);
        scene.add(mesh.group);
        m = {
          ...mesh,
          road: state.city.roads[0],
          t: 0, dir: 1, side: 1, speed: 0, walkPhase: 0,
          fleeTimer: 0, fleeX: 0, fleeZ: 1, fallT: 0, fadeT: 0,
        };
        peds.set(ped.id, m);
      }
      const g = m.group;

      // --- Ped mati (ditembak): rebah, tenggelam, lalu hilang. ---
      if (ped.dead) {
        m.fallT = Math.min(1, m.fallT + dt * 3);
        g.rotation.x = -Math.PI / 2 * m.fallT;
        g.position.y = -m.fallT * 0.4;
        m.fadeT += dt;
        if (m.fadeT > 3) {
          scene.remove(g);
          peds.delete(ped.id);
          const idx = state.peds.indexOf(ped);
          if (idx >= 0) state.peds.splice(idx, 1);
        }
        continue;
      }

      // --- Ped tertabrak: tergeletak, lalu bangun. ---
      if (ped.down) {
        m.fallT = Math.min(1, m.fallT + dt * 4);
        g.rotation.x = -Math.PI / 2 * m.fallT;
        g.position.set(ped.x, 0.25, ped.z);
        if (playing) {
          ped.downTimer -= dt;
          if (ped.downTimer <= 0) {
            ped.down = false;
            m.fallT = 0;
            g.rotation.x = 0;
            // Bangun lalu berjalan menjauh dari jalan (ganti sisi trotoar).
            m.side = -m.side;
          }
        }
        continue;
      }
      // Berdiri kembali (transisi dari rebah).
      if (m.fallT > 0) {
        m.fallT = Math.max(0, m.fallT - dt * 4);
        g.rotation.x = -Math.PI / 2 * m.fallT;
      }

      if (!playing) {
        g.position.set(ped.x, 0, ped.z);
        g.rotation.y = ped.heading;
        continue;
      }

      // NPC misi (Dito / penjaga): diam di tempat, mesh mengikuti state saja
      // (posisinya diatur missions.js, mis. Dito ikut mobilnya saat kabur).
      if (ped.mission) {
        g.position.set(ped.x, 0, ped.z);
        g.rotation.y = ped.heading;
        continue;
      }

      // --- Lari menjauh (setelah tembakan). ---
      if (m.fleeTimer > 0) {
        m.fleeTimer -= dt;
        ped.x += m.fleeX * FLEE_SPEED * dt;
        ped.z += m.fleeZ * FLEE_SPEED * dt;
        ped.x = clamp(ped.x, -250, 250);
        ped.z = clamp(ped.z, -250, 320);
        ped.heading = Math.atan2(m.fleeX, m.fleeZ);
        ped.speed = FLEE_SPEED;
        if (m.fleeTimer <= 0) {
          // Kembali ke trotoar terdekat.
          const near = nearestRoad(ped.x, ped.z);
          if (near) { m.road = near.road; m.t = near.t; m.dir = rand() < 0.5 ? 1 : -1; }
          ped.speed = m.speed;
        }
      } else {
        // --- Jalan santai di trotoar. ---
        const len = roadLength(m.road);
        m.t += (ped.speed * dt * m.dir) / len;
        const endReached = (m.dir === 1 && m.t >= 1) || (m.dir === -1 && m.t <= 0);
        if (endReached) {
          const next = nextRoadAt(m.road, m.dir === 1);
          if (next) {
            m.road = next.road;
            m.t = next.t;
            m.dir = next.dir;
            if (rand() < 0.5) m.side = -m.side; // kadang menyeberang
          } else {
            m.dir = -m.dir;
            m.t = clamp(m.t, 0, 1);
          }
        }
        const pt = sidewalkPoint(m, clamp(m.t, 0, 1));
        ped.x = pt.x;
        ped.z = pt.z;
        ped.heading = pt.heading;
      }

      // --- Tertabrak mobil? ---
      for (const v of state.vehicles) {
        if (Math.abs(v.speed) < HIT_SPEED) continue;
        const d = Math.hypot(v.x - ped.x, v.z - ped.z);
        if (d < HIT_DIST) {
          ped.down = true;
          ped.downTimer = DOWN_TIME;
          m.fallT = 0;
          // Wanted hanya naik kalau yang menabrak mobil pemain.
          if (v.driver === 'player') {
            evt.emit('ped-hit', { pedId: ped.id, vehicleId: v.id, x: ped.x, z: ped.z });
          }
          break;
        }
      }

      // --- Sinkron mesh + animasi jalan. ---
      g.position.set(ped.x, 0, ped.z);
      g.rotation.y = ped.heading;
      const freq = ped.speed > 3 ? 13 : 8;
      m.walkPhase += dt * freq;
      const amp = ped.speed > 0.3 ? 0.55 : 0;
      const s = Math.sin(m.walkPhase);
      m.legL.rotation.x = s * amp;
      m.legR.rotation.x = -s * amp;
      m.armL.rotation.x = -s * amp * 0.8;
      m.armR.rotation.x = s * amp * 0.8;
      g.position.y = Math.abs(Math.cos(m.walkPhase)) * 0.05 * (amp > 0 ? 1 : 0);
    }
  }

  return update;
}

export default initSystem;

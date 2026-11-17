// vehicles.js — Mobil prosedural + sistem mengemudi untuk SOLMAR BAY.
// Bangun model mobil dari geometri dasar three.js (tanpa aset eksternal),
// spawn mobil parkir dari state.city.spawns.cars, masuk/keluar mobil (E),
// mengemudi WASD + Space rem tangan, tabrakan gedung & antar mobil,
// kerusakan + asap, lampu strobo mobil patroli, kamera ikut mobil.
//
// Kontrak: export initSystem(state, scene, ctx) -> update(dt).
// ctx: { camera, renderer, input, bus }. Kalau ctx.input / ctx.bus kosong,
// dipakai singleton dari ./input.js dan ./state.js.
// Arah maju mobil: (sin(heading), cos(heading)) — sama seperti player.js.
// Mesh mobil dibangun menghadap +Z (lampu depan di +Z).

import * as THREE from 'three';
import { bus as busSingleton, clamp, collidesWithCity } from './state.js';
import { input as inputSingleton } from './input.js';

// Spesifikasi per jenis mobil.
const KIND_SPEC = {
  sedan: { len: 4.2, wid: 1.9, bodyY: 0.62, bodyH: 0.65, top: 26, accel: 15, colors: [0xef476f, 0x118ab2, 0x06d6a0, 0xffd166, 0x8ecae6, 0xc77dff, 0x90be6d] },
  taxi: { len: 4.2, wid: 1.9, bodyY: 0.62, bodyH: 0.65, top: 24, accel: 14, colors: [0xffd21f] },
  truck: { len: 5.2, wid: 2.1, bodyY: 0.75, bodyH: 0.8, top: 18, accel: 11, colors: [0x90be6d, 0xf4a261, 0x8ecae6, 0xe07a5f] },
  sport: { len: 4.6, wid: 2.0, bodyY: 0.5, bodyH: 0.55, top: 34, accel: 20, colors: [0xd90429, 0xffd166, 0x118ab2, 0x22223b] },
  police: { len: 4.3, wid: 1.95, bodyY: 0.62, bodyH: 0.65, top: 30, accel: 17, colors: [0xf5f5f5] },
};

const REVERSE_MAX = 9;
const ENTER_DIST = 4.2;
const CAR_RADIUS = 1.6; // radius tabrakan mobil vs gedung
const SMOKE_HP = 45; // hp di bawah ini mobil berasap

let vehicleCounter = 0;
function nextVehicleId() {
  vehicleCounter += 1;
  return `veh-${vehicleCounter}`;
}

function pick(arr, randFn) {
  return arr[Math.floor(randFn() * arr.length)];
}

// ---- Partikel sederhana: kotak kecil yang menyusut (percikan, asap) ----
function createParticlePool(scene, size) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const mats = {
    spark: new THREE.MeshBasicMaterial({ color: 0xffc93c }),
    smoke: new THREE.MeshBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.55 }),
    blood: new THREE.MeshBasicMaterial({ color: 0xd90429 }),
    muzzle: new THREE.MeshBasicMaterial({ color: 0xffe066 }),
  };
  const pool = [];
  for (let i = 0; i < size; i++) {
    const mesh = new THREE.Mesh(geo, mats.spark);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, grav: 0, grow: 0, base: 1 });
  }
  let cursor = 0;
  return {
    spawn(x, y, z, kind, vx, vy, vz, life, sizeScale, grav) {
      const p = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      p.mesh.visible = true;
      p.mesh.material = mats[kind] || mats.spark;
      p.mesh.position.set(x, y, z);
      p.mesh.scale.setScalar(sizeScale || 1);
      p.vx = vx; p.vy = vy; p.vz = vz;
      p.life = life; p.maxLife = life;
      p.grav = grav || 0;
      p.grow = kind === 'smoke' ? 1.6 : 0;
      p.base = sizeScale || 1;
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.mesh.visible = false; continue; }
        p.vy -= p.grav * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const k = p.life / p.maxLife;
        const s = p.base * (p.grow ? (1 + (1 - k) * p.grow) : k);
        p.mesh.scale.setScalar(Math.max(0.05, s));
      }
    },
  };
}

// ---- Model mobil prosedural (depan menghadap +Z) ----
function buildCarMesh(kind, color) {
  const spec = KIND_SPEC[kind] || KIND_SPEC.sedan;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x182635, roughness: 0.15, metalness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.35, metalness: 0.7 });

  const L = spec.len;
  const W = spec.wid;

  // Bodi utama.
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, spec.bodyH, L), bodyMat);
  body.position.y = spec.bodyY;
  body.castShadow = true;
  group.add(body);

  // Kabin / kargo.
  if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.15, 0.85, 1.4), bodyMat);
    cab.position.set(0, spec.bodyY + 0.65, L / 2 - 0.9);
    cab.castShadow = true;
    group.add(cab);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.6, 0.08), glassMat);
    windshield.position.set(0, spec.bodyY + 0.7, L / 2 - 0.18);
    group.add(windshield);
    const cargoMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 });
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 1.5, L - 2.0), cargoMat);
    cargo.position.set(0, spec.bodyY + 0.95, -0.7);
    cargo.castShadow = true;
    group.add(cargo);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W - 0.25, 0.6, L * 0.48), glassMat);
    cabin.position.set(0, spec.bodyY + spec.bodyH / 2 + 0.28, -L * 0.06);
    cabin.castShadow = true;
    group.add(cabin);
    // Atap tipis di atas kabin (warna bodi).
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.08, L * 0.42), bodyMat);
    roof.position.set(0, spec.bodyY + spec.bodyH / 2 + 0.6, -L * 0.06);
    group.add(roof);
  }

  // Spoiler untuk sport.
  if (kind === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.08, 0.45), bodyMat);
    spoiler.position.set(0, spec.bodyY + 0.75, -L / 2 + 0.15);
    group.add(spoiler);
  }

  // Papan taksi di atap.
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.28, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xfffbe8, emissive: 0xffe66d, emissiveIntensity: 0.7 }),
    );
    sign.position.set(0, spec.bodyY + spec.bodyH / 2 + 0.72, -L * 0.06);
    group.add(sign);
  }

  // Roda: grup pembungkus (untuk putaran) + ban + pelek.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10);
  const wheelZ = L / 2 - 0.75;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W / 2 - 0.08), 0.36, sz * wheelZ);
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      pivot.add(tire, hub);
      group.add(pivot);
      wheels.push(pivot);
    }
  }

  // Lampu depan (putih menyala) & belakang (merah).
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffe9a0, emissiveIntensity: 1.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xd90429, emissive: 0xd90429, emissiveIntensity: 1.1 });
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    head.position.set(sx * (W / 2 - 0.35), spec.bodyY + 0.05, L / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tailMat);
    tail.position.set(sx * (W / 2 - 0.35), spec.bodyY + 0.05, -L / 2 - 0.02);
    group.add(tail);
  }

  // Strobo patroli: bilah lampu merah-biru di atap.
  let strobe = null;
  if (kind === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
    bar.position.set(0, spec.bodyY + spec.bodyH / 2 + 0.72, -L * 0.06);
    group.add(bar);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.2 });
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.2 });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), redMat);
    red.position.set(-0.33, spec.bodyY + spec.bodyH / 2 + 0.82, -L * 0.06);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.5), blueMat);
    blue.position.set(0.33, spec.bodyY + spec.bodyH / 2 + 0.82, -L * 0.06);
    group.add(red, blue);
    strobe = { redMat, blueMat };
    // Garis hitam di pintu (kotak tipis di sisi bodi).
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, L * 0.55), stripeMat);
      stripe.position.set(sx * (W / 2 + 0.01), spec.bodyY, -L * 0.05);
      group.add(stripe);
    }
  }

  return { group, wheels, strobe };
}

export function initSystem(state, scene, ctx) {
  const input = (ctx && ctx.input) || inputSingleton;
  const evt = (ctx && ctx.bus) || busSingleton;
  const camera = ctx && ctx.camera;
  const rand = Math.random;

  const meshes = new Map(); // id mobil -> { group, wheels, strobe }
  const particles = createParticlePool(scene, 72);
  const camSmooth = { x: 0, y: 8, z: 14, init: false };
  let spawned = false;
  let time = 0;
  let smokeTimer = 0;

  // ---------- Spawn mobil parkir dari state.city.spawns.cars ----------
  function spawnParkedCars() {
    if (spawned) return;
    spawned = true;
    if (!Array.isArray(state.vehicles)) state.vehicles = [];
    const spawns = (state.city && state.city.spawns && state.city.spawns.cars) || [];
    const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'truck', 'sport', 'sedan', 'taxi'];
    for (const s of spawns) {
      const kind = pick(kinds, rand);
      const spec = KIND_SPEC[kind];
      state.vehicles.push({
        id: nextVehicleId(),
        kind,
        x: s.x,
        z: s.z,
        heading: s.heading || 0,
        speed: 0,
        color: pick(spec.colors, rand),
        driver: 'none', // 'player' | 'traffic' | 'police' | 'none'
        hp: 100,
        maxSpeed: spec.top,
      });
    }
  }

  // ---------- Sinkron mesh untuk semua mobil di state.vehicles ----------
  function syncMeshes(dt) {
    const seen = new Set();
    for (const v of state.vehicles) {
      seen.add(v.id);
      let m = meshes.get(v.id);
      if (!m) {
        m = buildCarMesh(v.kind, v.color);
        scene.add(m.group);
        meshes.set(v.id, m);
      }
      m.group.position.set(v.x, 0, v.z);
      m.group.rotation.y = v.heading;
      // Roda berputar seiring kecepatan.
      const spin = (v.speed * dt) / 0.36;
      for (const w of m.wheels) w.rotation.x += spin;
      // Strobo mobil patroli: merah-biru bergantian.
      if (m.strobe && v.driver === 'police') {
        const phase = Math.floor(time * 5) % 2 === 0;
        m.strobe.redMat.emissiveIntensity = phase ? 2.6 : 0.15;
        m.strobe.blueMat.emissiveIntensity = phase ? 0.15 : 2.6;
      } else if (m.strobe) {
        m.strobe.redMat.emissiveIntensity = 0.15;
        m.strobe.blueMat.emissiveIntensity = 0.15;
      }
      // Mobil rusak berat: miring sedikit + asap ditangani di bawah.
      m.group.rotation.z = v.hp <= 0 ? 0.04 : 0;
    }
    // Hapus mesh mobil yang sudah tidak ada di state.
    for (const [id, m] of meshes) {
      if (!seen.has(id)) {
        scene.remove(m.group);
        meshes.delete(id);
      }
    }
  }

  function spawnSparks(x, z, n) {
    for (let i = 0; i < n; i++) {
      particles.spawn(
        x, 0.7, z, 'spark',
        (rand() - 0.5) * 9, 2 + rand() * 4, (rand() - 0.5) * 9,
        0.35 + rand() * 0.3, 0.8 + rand() * 0.7, 12,
      );
    }
  }

  function spawnSmoke(x, y, z, big) {
    particles.spawn(
      x, y, z, 'smoke',
      (rand() - 0.5) * 1.2, 1.6 + rand() * 1.2, (rand() - 0.5) * 1.2,
      0.9 + rand() * 0.5, big ? 1.6 : 1.0, -0.5,
    );
  }

  // ---------- Masuk / keluar mobil ----------
  function nearestVehicle(maxDist) {
    const p = state.player;
    let best = null;
    let bestD = maxDist;
    for (const v of state.vehicles) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) { best = v; bestD = d; }
    }
    return best;
  }

  function enterVehicle(v) {
    const p = state.player;
    const wasOwned = v.driver === 'player';
    const stolen = v.driver === 'none' || v.driver === 'traffic' || v.driver === 'police';
    v.driver = 'player';
    p.onFoot = false;
    p.vehicleId = v.id;
    p.x = v.x;
    p.z = v.z;
    p.heading = v.heading;
    p.speed = v.speed;
    if (stolen && !wasOwned) {
      state.stats.carsStolen += 1;
      evt.emit('car-stolen', { vehicleId: v.id, kind: v.kind, x: v.x, z: v.z });
    }
  }

  function exitVehicle() {
    const p = state.player;
    const v = state.vehicles.find((car) => car.id === p.vehicleId);
    if (!v) {
      p.onFoot = true;
      p.vehicleId = null;
      return;
    }
    // Keluar di sisi kiri mobil; kalau terhalang gedung, coba sisi kanan / belakang.
    const lx = Math.cos(v.heading);
    const lz = -Math.sin(v.heading);
    const spots = [
      { x: v.x + lx * 2.4, z: v.z + lz * 2.4 },
      { x: v.x - lx * 2.4, z: v.z - lz * 2.4 },
      { x: v.x - Math.sin(v.heading) * 3.4, z: v.z - Math.cos(v.heading) * 3.4 },
    ];
    let spot = spots[2];
    for (const s of spots) {
      if (!collidesWithCity(state, s.x, s.z, 0.7)) { spot = s; break; }
    }
    p.x = spot.x;
    p.z = spot.z;
    p.heading = v.heading;
    p.speed = 0;
    p.onFoot = true;
    p.vehicleId = null;
    v.driver = 'none';
    v.speed = 0;
  }

  // ---------- Fisika mengemudi ----------
  function drivePlayerCar(v, dt) {
    const spec = KIND_SPEC[v.kind] || KIND_SPEC.sedan;
    const axis = input.moveAxis(); // z: -1 = W maju, +1 = S mundur; x: -1 kiri, +1 kanan
    const handbrake = input.held('Space');
    const disabled = v.hp <= 0;

    // Gas / rem.
    let throttle = 0;
    if (!disabled) {
      if (axis.z < 0) throttle = 1;
      else if (axis.z > 0) throttle = v.speed > 0.5 ? -1.6 : -0.7; // rem kuat kalau masih melaju
    }
    v.speed += throttle * spec.accel * dt;
    // Hambatan + gesekan gelinding.
    v.speed -= v.speed * 0.55 * dt;
    if (throttle === 0 && !handbrake) {
      const drag = 7 * dt;
      if (Math.abs(v.speed) <= drag) v.speed = 0;
      else v.speed -= Math.sign(v.speed) * drag;
    }
    // Rem tangan: deselerasi kuat + belok lebih tajam (drift ringan).
    if (handbrake && Math.abs(v.speed) > 0.5) {
      const dec = 24 * dt;
      v.speed -= Math.sign(v.speed) * Math.min(dec, Math.abs(v.speed));
    }
    const top = disabled ? 0 : spec.top;
    v.speed = clamp(v.speed, -REVERSE_MAX, top);

    // Belok: proporsional kecepatan, lebih tajam saat rem tangan.
    const steerMax = 0.62 / (1 + Math.abs(v.speed) * 0.045);
    const steer = axis.x * steerMax * (handbrake ? 1.5 : 1);
    v.heading += (v.speed / 3.1) * Math.tan(steer) * dt;

    // Gerak + tabrakan gedung (pisah sumbu X lalu Z -> slide alami).
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    const nx = v.x + fx * v.speed * dt;
    const nz = v.z + fz * v.speed * dt;
    const impact = Math.abs(v.speed);
    let hit = false;
    if (!collidesWithCity(state, nx, v.z, CAR_RADIUS)) v.x = nx;
    else hit = true;
    if (!collidesWithCity(state, v.x, nz, CAR_RADIUS)) v.z = nz;
    else hit = true;
    if (hit) {
      if (impact > 7) {
        v.hp = Math.max(0, v.hp - (impact - 7) * 1.6);
        spawnSparks(v.x + fx * 2, v.z + fz * 2, 8);
        evt.emit('crash', { vehicleId: v.id, speed: impact, x: v.x, z: v.z });
      }
      v.speed *= 0.35;
    }

    // Sinkron posisi pemain ke mobil.
    const p = state.player;
    p.x = v.x;
    p.z = v.z;
    p.heading = v.heading;
    p.speed = v.speed;
  }

  // Tabrakan antar mobil (lingkaran sederhana, dorong + tukar kecepatan).
  function collideVehicles(dt) {
    const list = state.vehicles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const minD = 3.1;
        if (d >= minD || d === 0) continue;
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        a.x -= ux * push;
        a.z -= uz * push;
        b.x += ux * push;
        b.z += uz * push;
        // Benturan keras: kurangi kecepatan & hp, percikan.
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 6) {
          const midX = (a.x + b.x) / 2;
          const midZ = (a.z + b.z) / 2;
          spawnSparks(midX, midZ, 6);
          a.hp = Math.max(0, a.hp - rel * 0.7);
          b.hp = Math.max(0, b.hp - rel * 0.7);
          const avg = (a.speed + b.speed) / 2;
          a.speed = avg * 0.6;
          b.speed = avg * 0.6;
          if (a.driver === 'player' || b.driver === 'player') {
            evt.emit('crash', { vehicleId: a.driver === 'player' ? a.id : b.id, speed: rel, x: midX, z: midZ });
          }
        } else {
          // Sentuhan ringan: samakan kecepatan sedikit.
          const avg = (a.speed + b.speed) / 2;
          a.speed += (avg - a.speed) * 0.2;
          b.speed += (avg - b.speed) * 0.2;
        }
      }
    }
  }

  // Kamera mengikuti mobil dari belakang-atas saat mengemudi.
  function followCamera(v, dt) {
    if (!camera) return;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    const tx = v.x - fx * 11;
    const tz = v.z - fz * 11;
    const ty = 5.4;
    if (!camSmooth.init) {
      camSmooth.x = tx; camSmooth.y = ty; camSmooth.z = tz;
      camSmooth.init = true;
    }
    const k = 1 - Math.exp(-5 * dt);
    camSmooth.x += (tx - camSmooth.x) * k;
    camSmooth.y += (ty - camSmooth.y) * k;
    camSmooth.z += (tz - camSmooth.z) * k;
    camera.position.set(camSmooth.x, camSmooth.y, camSmooth.z);
    camera.lookAt(v.x + fx * 7, 1.4, v.z + fz * 7);
  }

  function update(dt) {
    time += dt;
    // Spawn malas: tunggu kota selesai dibangun (roads/spawns terisi).
    if (!spawned && state.city && state.city.spawns && state.city.spawns.cars.length > 0) {
      spawnParkedCars();
    }
    syncMeshes(dt);
    particles.update(dt);

    // Asap dari mobil rusak (di semua mode, supaya menu pun terlihat hidup).
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = 0.12;
      for (const v of state.vehicles) {
        if (v.hp < SMOKE_HP) {
          const bx = v.x - Math.sin(v.heading) * 1.6;
          const bz = v.z - Math.cos(v.heading) * 1.6;
          spawnSmoke(bx, 1.1, bz, v.hp <= 0);
        }
      }
    }

    if (state.mode !== 'playing') return;

    const p = state.player;

    // Masuk / keluar mobil (E).
    if (input.pressed('KeyE')) {
      if (p.onFoot) {
        const v = nearestVehicle(ENTER_DIST);
        if (v) enterVehicle(v);
      } else {
        exitVehicle();
      }
    }

    // Mengemudi.
    if (!p.onFoot && p.vehicleId) {
      const v = state.vehicles.find((car) => car.id === p.vehicleId);
      if (v) {
        drivePlayerCar(v, dt);
        followCamera(v, dt);
      } else {
        // Mobil hilang (misal dihapus sistem lain): paksa keluar.
        p.onFoot = true;
        p.vehicleId = null;
      }
    }

    collideVehicles(dt);
  }

  return update;
}

export default initSystem;

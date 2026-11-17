// combat.js — Senjata & pertarungan untuk SOLMAR BAY.
// Tinju (F / klik kiri, jarak dekat) dan pistol (klik kiri, R reload).
// Raycast sederhana: target dalam jarak + sudut dari heading pemain.
// Musuh jatuh (ped/polisi), partikel darah, health pemain berkurang saat
// ditembak polisi (bus 'player-hurt'), pemain mati -> mode 'dead'.
// Crosshair dibaca HUD dari state.player.aimPoint (titik bidik di tanah).
//
// Kontrak: export initSystem(state, scene, ctx) -> update(dt).
// state.player.weapon: 'fists' | 'pistol' (+ 'smg'/'shotgun' disiapkan
// state.js tapi belum dipakai modul ini). state.player.ammo = isi magazen.

import * as THREE from 'three';
import { bus as busSingleton, clamp } from './state.js';
import { input as inputSingleton } from './input.js';

const PISTOL_MAG = 24; // isi magazen pistol
const PISTOL_RANGE = 32;
const PISTOL_CONE = 0.18; // radian (~10 derajat) dari heading pemain
const PISTOL_COOLDOWN = 0.28;
const PISTOL_DAMAGE_PED = 100; // sekali tembak ped jatuh (mati)
const PISTOL_DAMAGE_COP = 50; // dua tembak polisi jatuh
const PISTOL_DAMAGE_CAR = 20;
const RELOAD_TIME = 1.1;
const FIST_RANGE = 2.4;
const FIST_CONE = 0.6;
const FIST_COOLDOWN = 0.45;
const FIST_DAMAGE_COP = 34;
const HURT_COOLDOWN = 0.3; // jeda antar damage ke pemain (anti leleh instan)

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function initSystem(state, scene, ctx) {
  const input = (ctx && ctx.input) || inputSingleton;
  const evt = (ctx && ctx.bus) || busSingleton;
  const rand = Math.random;

  // --- Partikel darah + kilat moncong (kotak kecil, tanpa aset) ---
  const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0xd90429 });
  const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const particles = [];
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(particleGeo, bloodMat);
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
  }
  let particleCursor = 0;

  function spawnBurst(x, y, z, kind, n, speed) {
    for (let i = 0; i < n; i++) {
      const p = particles[particleCursor];
      particleCursor = (particleCursor + 1) % particles.length;
      p.mesh.visible = true;
      p.mesh.material = kind === 'muzzle' ? muzzleMat : bloodMat;
      p.mesh.position.set(x, y, z);
      p.mesh.scale.setScalar(kind === 'muzzle' ? 1.4 : 0.8 + rand() * 0.8);
      const a = rand() * Math.PI * 2;
      const up = kind === 'muzzle' ? 0.5 : 2 + rand() * 2;
      p.vx = Math.cos(a) * speed * (0.4 + rand() * 0.6);
      p.vy = up;
      p.vz = Math.sin(a) * speed * (0.4 + rand() * 0.6);
      p.life = 0.4 + rand() * 0.35;
      p.maxLife = p.life;
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vy -= 9 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) p.mesh.position.y = 0.05;
      p.mesh.scale.setScalar(Math.max(0.05, p.life / p.maxLife));
    }
  }

  // --- Damage ke pemain (dari polisi lewat bus 'player-hurt'). ---
  let hurtTimer = 0;
  let prevMode = state.mode;
  evt.on('player-hurt', (data) => {
    if (state.mode !== 'playing' || !data) return;
    if (hurtTimer > 0) return; // jeda antar hit
    hurtTimer = HURT_COOLDOWN;
    let dmg = data.damage || 5;
    // Armor menyerap dulu.
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, dmg);
      state.armor -= absorbed;
      dmg -= absorbed;
    }
    state.health = Math.max(0, state.health - dmg);
    if (state.health <= 0) {
      state.mode = 'dead';
      evt.emit('player-dead', { from: data.from || 'police' });
    }
  });

  let cooldown = 0;
  let reloading = false;
  let reloadTimer = 0;

  // Cari target dalam cone bidik: ped / polisi jalan kaki / mobil.
  // Kembalikan { type, ref, dist } yang terdekat.
  function findTarget(range, cone) {
    const p = state.player;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    let best = null;
    let bestDist = range;

    function consider(x, z, radius, type, ref) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz) - radius;
      if (d > bestDist || d < -0.5) return;
      const ang = wrapAngle(Math.atan2(dx, dz) - p.heading);
      if (Math.abs(ang) > cone) return;
      best = { type, ref, dist: Math.max(0, d) };
      bestDist = d;
    }

    for (const ped of state.peds) {
      if (ped.down || ped.dead) continue;
      consider(ped.x, ped.z, 0.4, 'ped', ped);
    }
    for (const cop of state.police) {
      if (cop.dead || cop.hp <= 0 || !cop.onFoot) continue;
      consider(cop.x, cop.z, 0.4, 'police', cop);
    }
    for (const v of state.vehicles) {
      if (v.driver === 'player') continue;
      consider(v.x, v.z, 1.6, 'vehicle', v);
    }
    return best;
  }

  function shootPistol() {
    const p = state.player;
    if (reloading) return;
    if (p.ammo <= 0) {
      // Magazen kosong: mulai reload otomatis.
      reloading = true;
      reloadTimer = RELOAD_TIME;
      return;
    }
    p.ammo -= 1;
    cooldown = PISTOL_COOLDOWN;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    // Kilat moncong di depan pemain.
    spawnBurst(p.x + fx * 1.1, 1.4, p.z + fz * 1.1, 'muzzle', 4, 2);
    evt.emit('gunshot', { x: p.x, z: p.z });

    const target = findTarget(PISTOL_RANGE, PISTOL_CONE);
    if (!target) {
      // Tembakan meleset: titik bidik tetap di ujung jarak.
      p.aimPoint = { x: p.x + fx * PISTOL_RANGE, z: p.z + fz * PISTOL_RANGE };
      return;
    }
    const t = target.ref;
    p.aimPoint = { x: t.x, z: t.z };
    spawnBurst(t.x, 1.2, t.z, 'blood', 8, 3.5);

    if (target.type === 'ped') {
      t.dead = true;
      t.down = true;
      t.downTimer = 0;
      state.stats.kills += 1;
      evt.emit('kill', { kind: 'ped', id: t.id });
    } else if (target.type === 'police') {
      t.hp -= PISTOL_DAMAGE_COP;
      if (t.hp <= 0) {
        t.dead = true;
        state.stats.kills += 1;
        evt.emit('kill', { kind: 'police', id: t.id });
      } else {
        // Polisi yang tertembak tersentak (stun singkat).
        t.stun = 0.8;
      }
    } else if (target.type === 'vehicle') {
      t.hp = Math.max(0, t.hp - PISTOL_DAMAGE_CAR);
      if (t.hp <= 0) evt.emit('crash', { vehicleId: t.id, speed: 0, x: t.x, z: t.z });
    }
  }

  function punch() {
    const p = state.player;
    cooldown = FIST_COOLDOWN;
    const target = findTarget(FIST_RANGE, FIST_CONE);
    if (!target) return;
    const t = target.ref;
    spawnBurst(t.x, 1.2, t.z, 'blood', 5, 2.5);

    if (target.type === 'ped') {
      if (t.down) {
        // Pukulan kedua ke ped yang sudah jatuh: mati.
        t.dead = true;
        state.stats.kills += 1;
        evt.emit('kill', { kind: 'ped', id: t.id });
      } else {
        t.down = true;
        t.downTimer = 4;
        evt.emit('ped-hit', { pedId: t.id, byFist: true, x: t.x, z: t.z });
      }
    } else if (target.type === 'police') {
      t.hp -= FIST_DAMAGE_COP;
      if (t.hp <= 0) {
        t.dead = true;
        state.stats.kills += 1;
        evt.emit('kill', { kind: 'police', id: t.id });
      } else {
        t.stun = 1.2;
      }
    } else if (target.type === 'vehicle') {
      // Meninju mobil: tidak ada efek selain bunyi (diwakili partikel).
      t.hp = Math.max(0, t.hp - 1);
    }
  }

  function update(dt) {
    const p = state.player;
    if (hurtTimer > 0) hurtTimer -= dt;
    if (cooldown > 0) cooldown -= dt;
    updateParticles(dt);

    // Titik bidik: 20 unit di depan pemain (dipakai crosshair HUD).
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    if (!p.aimPoint) p.aimPoint = { x: 0, z: 0 };
    p.aimPoint.x = p.x + fx * 20;
    p.aimPoint.z = p.z + fz * 20;

    // Respawn setelah mati: pulihkan health & ammo.
    if (prevMode === 'dead' && state.mode === 'playing') {
      state.health = 100;
      if (p.weapon === 'pistol') p.ammo = PISTOL_MAG;
    }
    prevMode = state.mode;

    if (state.mode !== 'playing' || !p.onFoot) return;

    // Ganti senjata: 1 = tinju, 2 = pistol.
    if (input.pressed('Digit1')) {
      p.weapon = 'fists';
      reloading = false;
    } else if (input.pressed('Digit2')) {
      p.weapon = 'pistol';
      if (p.ammo <= 0) p.ammo = PISTOL_MAG;
      reloading = false;
    }

    // Reload manual (R) atau otomatis saat magazen habis.
    if (input.pressed('KeyR') && p.weapon === 'pistol' && !reloading && p.ammo < PISTOL_MAG) {
      reloading = true;
      reloadTimer = RELOAD_TIME;
    }
    if (reloading) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloading = false;
        p.ammo = PISTOL_MAG; // cadangan tak terbatas
      }
      return; // tidak bisa menembak saat reload
    }

    // Tembak / pukul: klik kiri, atau F untuk tinju.
    const click = input.mouse.clicked;
    const fistKey = input.pressed('KeyF');
    if (cooldown > 0) return;
    if (p.weapon === 'pistol') {
      if (click) shootPistol();
    } else if (click || fistKey) {
      punch();
    }
  }

  return update;
}

export default initSystem;

// player.js — Kontrol jalan kaki + kamera third-person untuk SOLMAR BAY.
// Gerak WASD relatif arah kamera, Shift lari, heading mengikuti arah gerak,
// animasi sederhana (badan + lengan/kaki berayun), tabrakan AABB kota dengan
// slide, kamera follow halus (lerp) + orbit drag mouse + zoom wheel.

import * as THREE from 'three';
import { collidesWithCity, clamp } from './state.js';

const WALK_SPEED = 6;
const RUN_SPEED = 11;
const ACCEL = 40;
const RADIUS = 0.6; // radius tabrakan pemain

// State kamera (disimpan di modul supaya persisten antar frame).
const cam = {
  yaw: 0, // orbit horizontal mengelilingi pemain
  pitch: 0.32, // sudut pandang dari atas (radian)
  dist: 9, // jarak kamera
  pos: new THREE.Vector3(0, 6, 12),
  look: new THREE.Vector3(0, 1.5, 0),
};

let playerMesh = null;
let limbs = null;

// Bangun model pemain: kapsul badan + kepala + lengan + kaki (kotak).
function buildPlayerMesh(scene) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xef476f, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x264653, roughness: 0.9 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 6, 12), shirt);
  body.position.y = 1.15;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), skin);
  head.position.y = 2.05;
  head.castShadow = true;
  group.add(head);

  // Topi pantai khas Solmar Bay.
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xf2d8a7, roughness: 0.9 }));
  hat.position.y = 2.32;
  group.add(hat);

  const armGeo = new THREE.BoxGeometry(0.22, 0.85, 0.22);
  const legGeo = new THREE.BoxGeometry(0.26, 0.85, 0.26);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.58, 1.35, 0);
  armL.castShadow = true;
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.58, 1.35, 0);
  armR.castShadow = true;
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.2, 0.45, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.2, 0.45, 0);
  legR.castShadow = true;
  group.add(armL, armR, legL, legR);

  // Sepatu.
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.5), shoes);
  shoeL.position.set(-0.2, 0.07, 0.08);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.5), shoes);
  shoeR.position.set(0.2, 0.07, 0.08);
  group.add(shoeL, shoeR);

  scene.add(group);
  return { group, armL, armR, legL, legR, shoeL, shoeR };
}

// Geser posisi dengan tabrakan AABB (coba sumbu X lalu Z — slide alami).
function moveWithCollision(state, x, z, r) {
  let nx = x;
  let nz = z;
  if (!collidesWithCity(state, nx, state.player.z, r)) state.player.x = nx;
  if (!collidesWithCity(state, state.player.x, nz, r)) state.player.z = nz;
}

export function getCameraTarget(state) {
  return { x: state.player.x, y: 1.6, z: state.player.z };
}

export function updatePlayer(state, input, dt, scene, camera) {
  const p = state.player;

  if (!playerMesh) {
    playerMesh = buildPlayerMesh(scene);
    limbs = playerMesh;
    // Tempatkan kamera awal di belakang spawn.
    cam.yaw = 0;
    cam.pos.set(p.x, 6, p.z + 12);
  }

  // Hanya kendalikan saat jalan kaki & mode playing.
  if (!p.onFoot || state.mode !== 'playing') {
    // Tetap tampilkan mesh di posisi pemain (misal saat di dalam mobil disembunyikan).
    playerMesh.group.visible = p.onFoot;
    return;
  }
  playerMesh.group.visible = true;

  // --- Orbit kamera dari drag mouse, zoom dari wheel ---
  cam.yaw -= input.mouse.dx * 0.005;
  cam.pitch = clamp(cam.pitch + input.mouse.dy * 0.003, 0.08, 1.1);
  cam.dist = clamp(cam.dist + input.mouse.wheel * 0.01, 5, 16);

  // --- Gerak relatif kamera ---
  const axis = input.moveAxis();
  const running = input.held('ShiftLeft') || input.held('ShiftRight');
  const targetSpeed = (axis.x !== 0 || axis.z !== 0)
    ? (running ? RUN_SPEED : WALK_SPEED)
    : 0;

  // Arah maju kamera di bidang XZ (yaw 0 = menghadap -Z).
  const sin = Math.sin(cam.yaw);
  const cos = Math.cos(cam.yaw);
  // axis.z = -1 saat W (maju): maju = (-sin, -cos); kanan = (cos, -sin).
  let mx = 0;
  let mz = 0;
  if (axis.x !== 0 || axis.z !== 0) {
    mx = -sin * -axis.z + cos * axis.x;
    mz = -cos * -axis.z - sin * axis.x;
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
  }

  // Percepatan halus menuju kecepatan target.
  const cur = p.speed;
  const next = cur + clamp(targetSpeed - cur, -ACCEL * dt, ACCEL * dt);
  p.speed = next;

  if (next > 0.1) {
    moveWithCollision(state, p.x + mx * next * dt, p.z + mz * next * dt, RADIUS);
    // Heading mengikuti arah gerak (lerp sudut terpendek).
    const targetHeading = Math.atan2(mx, mz);
    let diff = targetHeading - p.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.heading += diff * Math.min(1, 12 * dt);
  }

  // --- Sinkron mesh + animasi jalan/lari ---
  const g = playerMesh.group;
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.heading;
  const swing = Math.min(1, p.speed / RUN_SPEED);
  const t = state.time * (running ? 13 : 9) * (swing > 0.05 ? 1 : 0);
  const amp = 0.6 * swing;
  limbs.armL.rotation.x = Math.sin(t) * amp;
  limbs.armR.rotation.x = -Math.sin(t) * amp;
  limbs.legL.rotation.x = -Math.sin(t) * amp;
  limbs.legR.rotation.x = Math.sin(t) * amp;
  // Sedikit membungkuk saat lari.
  g.rotation.x = running && swing > 0.5 ? 0.12 : 0;
  // Bobbing ringan.
  g.position.y = Math.abs(Math.sin(t)) * 0.08 * swing;

  // --- Kamera follow halus ---
  if (camera) {
    const cx = p.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cz = p.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    const cy = 1.6 + Math.sin(cam.pitch) * cam.dist;
    const k = 1 - Math.exp(-8 * dt); // lerp framerate-independent
    cam.pos.x += (cx - cam.pos.x) * k;
    cam.pos.y += (cy - cam.pos.y) * k;
    cam.pos.z += (cz - cam.pos.z) * k;
    cam.look.set(p.x, 1.6, p.z);
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
  }
}

// Reset kamera (misal saat respawn / mulai misi baru).
export function resetCamera(x, z) {
  cam.yaw = 0;
  cam.pos.set(x, 6, z + 12);
  cam.look.set(x, 1.6, z);
}

export default updatePlayer;

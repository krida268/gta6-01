// city.js — Kota orisinal "Solmar Bay": kota pantai fiktif bermatahari terik.
// Grid jalan ~9x9 blok, trotoar, gedung prosedural, taman, pantai + laut di
// selatan, jembatan dermaga, lampu jalan, pohon palem, rambu, tempat parkir,
// marka jalan. Semua mesh dari geometri dasar three.js, tanpa aset eksternal.
// Mengisi state.city.colliders (gedung & prop), state.city.roads (segmen
// jalan untuk traffic) dan state.city.spawns (player, mobil, pejalan kaki).

import * as THREE from 'three';

// RNG deterministik supaya kota selalu sama di tiap load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCK = 40; // lebar blok
const ROAD = 12; // lebar jalan
const PITCH = BLOCK + ROAD; // jarak antar pusat blok
const GRID = 9; // 9x9 blok, indeks -4..4
const HALF = (GRID * PITCH) / 2; // setengah bentang kota (~234)
const BEACH_Z = HALF + 14; // garis pantai (z positif = selatan)
const SEA_Z = BEACH_Z + 70;

// Palet pastel / cerah khas kota pantai.
const BUILDING_COLORS = [
  0xffd9a0, 0xffb3a7, 0xa8e6cf, 0x8ecae6, 0xffe66d, 0xf4a7b9,
  0xcdb4db, 0x90be6d, 0xf9c74f, 0x90dbf4, 0xffafcc, 0xbde0fe,
];
const ROOF_COLORS = [0xef476f, 0x118ab2, 0x073b4c, 0x06d6a0, 0xffd166];

function makeCanvasTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(scene, state) {
  const rand = mulberry32(1337);
  const colliders = state.city.colliders;
  const roads = state.city.roads;
  const spawns = state.city.spawns;

  // ---------- Langit, kabut, pencahayaan ----------
  scene.fog = new THREE.Fog(0xcfe8f5, 260, 900);

  // Kubah langit gradient (tekstur canvas, dibuat runtime — bukan aset eksternal).
  const skyTex = makeCanvasTexture((g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2f7fd0');
    grad.addColorStop(0.55, '#7ec3ee');
    grad.addColorStop(0.8, '#ffe3a3');
    grad.addColorStop(1, '#fff3d6');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 16, 512);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(850, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);

  // Matahari terik + cahaya langit.
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.6);
  sun.position.set(180, 260, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -280;
  sun.shadow.camera.right = 280;
  sun.shadow.camera.top = 280;
  sun.shadow.camera.bottom = -280;
  sun.shadow.camera.far = 800;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfdfff, 0x8a7a5a, 0.9));

  // Awan: gumpalan bola putih pipih yang melayang pelan (di-animate oleh hud? tidak — statis).
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Mesh(cloudGeo, cloudMat);
      s.position.set((rand() - 0.5) * 30, (rand() - 0.5) * 4, (rand() - 0.5) * 12);
      s.scale.set(10 + rand() * 12, 4 + rand() * 3, 8 + rand() * 6);
      cloud.add(s);
    }
    cloud.position.set((rand() - 0.5) * 900, 150 + rand() * 60, (rand() - 0.5) * 900 - 60);
    scene.add(cloud);
  }

  // ---------- Material bersama ----------
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5d8a4a, roughness: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.95 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 1 });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xf2d8a7, roughness: 1 });
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1e90c8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 });
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 1 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0xffd98a, emissiveIntensity: 0.55, roughness: 0.4 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 1 });
  const palmMat = new THREE.MeshStandardMaterial({ color: 0x2e9e5b, roughness: 0.9 });
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.6, metalness: 0.4 });
  const lampGlowMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffe9a0, emissiveIntensity: 1.2 });

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);

  function addBox(mat, x, y, z, sx, sy, sz, opts = {}) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // ---------- Tanah dasar, jalan, trotoar ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 60, HALF * 2 + 60), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Jalan vertikal & horizontal (pusat jalan di kelipatan PITCH).
  const roadLines = [];
  for (let i = -4; i <= 4; i++) roadLines.push(i * PITCH);
  // Jalan juga di tepi kota (di luar blok terluar).
  roadLines.push(-HALF - ROAD / 2, HALF + ROAD / 2);

  for (const x of roadLines) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, HALF * 2 + ROAD * 2), roadMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, 0.01, 0);
    r.receiveShadow = true;
    scene.add(r);
    roads.push({ x1: x, z1: -HALF - ROAD, x2: x, z2: HALF + ROAD });
  }
  for (const z of roadLines) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + ROAD * 2, ROAD), roadMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(0, 0.012, z);
    r.receiveShadow = true;
    scene.add(r);
    roads.push({ x1: -HALF - ROAD, z1: z, x2: HALF + ROAD, z2: z });
  }

  // Marka jalan: garis tengah putus-putus (kotak kecil kuning).
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf7d154, roughness: 0.8 });
  for (const x of roadLines) {
    for (let z = -HALF; z < HALF; z += 8) {
      addBox(dashMat, x, 0.03, z, 0.4, 0.02, 3, { cast: false });
    }
  }
  for (const z of roadLines) {
    for (let x = -HALF; x < HALF; x += 8) {
      addBox(dashMat, x, 0.03, z, 3, 0.02, 0.4, { cast: false });
    }
  }

  // Trotoar di sekeliling tiap blok. Blok berada DI ANTARA jalan (pusat blok
  // = pusat jalan + setengah pitch), jadi trotoar & gedung digeser +26 dari
  // garis jalan supaya tidak menutupi jalan.
  for (let bx = -4; bx <= 3; bx++) {
    for (let bz = -4; bz <= 3; bz++) {
      const cx = bx * PITCH + PITCH / 2;
      const cz = bz * PITCH + PITCH / 2;
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 4, BLOCK + 4), sidewalkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(cx, 0.02, cz);
      walk.receiveShadow = true;
      scene.add(walk);
    }
  }

  // ---------- Gedung prosedural ----------
  const buildingMats = BUILDING_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const roofMats = ROOF_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));

  function addBuilding(cx, cz, w, d, h, matIdx) {
    const mat = buildingMats[matIdx % buildingMats.length];
    const b = addBox(mat, cx, h / 2, cz, w, h, d);
    b.castShadow = true;
    // Atap datar + tepi atap warna kontras.
    const roof = addBox(roofMats[Math.floor(rand() * roofMats.length)], cx, h + 0.4, cz, w + 1, 0.8, d + 1);
    roof.castShadow = true;
    // Jendela emissive: strip tipis di tiap sisi, per lantai.
    const floors = Math.max(1, Math.floor(h / 6));
    for (let f = 0; f < floors; f++) {
      const wy = 3 + f * 6;
      if (wy > h - 2) break;
      const cols = Math.max(1, Math.floor(w / 6));
      for (let i = 0; i < cols; i++) {
        const wx = cx - w / 2 + 3 + i * 6;
        if (wx > cx + w / 2 - 2) break;
        addBox(windowMat, wx, wy, cz + d / 2 + 0.06, 2.4, 2.4, 0.1, { cast: false });
        addBox(windowMat, wx, wy, cz - d / 2 - 0.06, 2.4, 2.4, 0.1, { cast: false });
      }
    }
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  // Taman pusat (blok 0,0, pusatnya di +26,+26): plaza + pepohonan, tanpa gedung.
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 2, BLOCK + 2), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PITCH / 2, 0.03, PITCH / 2);
  plaza.receiveShadow = true;
  scene.add(plaza);
  // Air mancur mini di tengah plaza.
  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1, 16), new THREE.MeshStandardMaterial({ color: 0x9db3c8, roughness: 0.6 }));
  fountainBase.position.set(PITCH / 2, 0.5, PITCH / 2);
  fountainBase.castShadow = true;
  scene.add(fountainBase);
  const fountainWater = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.2 }));
  fountainWater.position.set(PITCH / 2, 0.95, PITCH / 2);
  scene.add(fountainWater);
  colliders.push({ minX: PITCH / 2 - 5.5, maxX: PITCH / 2 + 5.5, minZ: PITCH / 2 - 5.5, maxZ: PITCH / 2 + 5.5 });

  // Blok gedung: tiap blok 1-3 gedung, kecuali taman pusat & baris paling
  // selatan (bz = 4) yang jadi area pantai / parkir. Pusat blok = pusat jalan
  // + setengah pitch, supaya gedung berdiri di antara jalan, bukan di atasnya.
  for (let bx = -4; bx <= 3; bx++) {
    for (let bz = -4; bz <= 3; bz++) {
      if (bx === 0 && bz === 0) continue; // plaza pusat
      const cx = bx * PITCH + PITCH / 2;
      const cz = bz * PITCH + PITCH / 2;
      const kind = rand();
      if (kind < 0.55) {
        // Satu gedung besar.
        const w = 22 + rand() * 10;
        const d = 22 + rand() * 10;
        const h = 10 + rand() * 34;
        addBuilding(cx, cz, w, d, h, Math.floor(rand() * buildingMats.length));
      } else if (kind < 0.85) {
        // Dua gedung berdampingan.
        addBuilding(cx - 9, cz, 15 + rand() * 4, 24 + rand() * 8, 8 + rand() * 22, Math.floor(rand() * buildingMats.length));
        addBuilding(cx + 9, cz, 15 + rand() * 4, 24 + rand() * 8, 8 + rand() * 26, Math.floor(rand() * buildingMats.length));
      } else {
        // Taman kecil di blok itu: rumput + palem + bangku.
        const lawn = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK), new THREE.MeshStandardMaterial({ color: 0x6fae5a, roughness: 1 }));
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(cx, 0.03, cz);
        lawn.receiveShadow = true;
        scene.add(lawn);
        for (let t = 0; t < 4; t++) {
          addPalm(cx + (rand() - 0.5) * 28, cz + (rand() - 0.5) * 28);
        }
      }
    }
  }

  // ---------- Pantai + laut (selatan) ----------
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 120, SEA_Z - BEACH_Z + 30), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, (BEACH_Z + SEA_Z) / 2);
  sand.receiveShadow = true;
  scene.add(sand);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 400, 400), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, SEA_Z + 180);
  sea.receiveShadow = true;
  scene.add(sea);

  // Garis ombak: strip putih tipis di tepi pantai.
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 120, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.06, BEACH_Z + 6);
  scene.add(foam);

  // Palem di sepanjang pantai + payung pantai warna-warni.
  for (let x = -HALF; x <= HALF; x += 26) {
    addPalm(x + (rand() - 0.5) * 8, BEACH_Z + 12 + rand() * 10);
    if (rand() < 0.6) {
      const umbrella = new THREE.Group();
      const pole = new THREE.Mesh(cylGeo, lampPoleMat);
      pole.scale.set(0.12, 3, 0.12);
      pole.position.y = 1.5;
      umbrella.add(pole);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 2.6, 1, 8), new THREE.MeshStandardMaterial({ color: ROOF_COLORS[Math.floor(rand() * ROOF_COLORS.length)], roughness: 0.9 }));
      top.position.y = 3.2;
      umbrella.add(top);
      umbrella.position.set(x + 8, 0, BEACH_Z + 14 + rand() * 8);
      scene.add(umbrella);
    }
  }

  // ---------- Dermaga / jembatan ke laut ----------
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 1 });
  const pier = addBox(pierMat, 0, 0.6, SEA_Z - 8, 8, 0.6, 60, { cast: false });
  pier.receiveShadow = true;
  for (let z = SEA_Z - 36; z <= SEA_Z + 18; z += 8) {
    for (const px of [-3.4, 3.4]) {
      const post = new THREE.Mesh(cylGeo, trunkMat);
      post.scale.set(0.5, 2.4, 0.5);
      post.position.set(px, -0.4, z);
      scene.add(post);
    }
  }
  // Menara suar mini di ujung dermaga.
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(cylGeo, new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.8 }));
  tower.scale.set(2.2, 12, 2.2);
  tower.position.y = 6;
  tower.castShadow = true;
  lighthouse.add(tower);
  const lampTop = new THREE.Mesh(cylGeo, lampGlowMat);
  lampTop.scale.set(1.4, 2, 1.4);
  lampTop.position.y = 12.6;
  lighthouse.add(lampTop);
  lighthouse.position.set(0, 0.8, SEA_Z + 18);
  scene.add(lighthouse);
  colliders.push({ minX: -2.4, maxX: 2.4, minZ: SEA_Z + 15, maxZ: SEA_Z + 21 });

  // ---------- Tempat parkir (baris selatan, di antara jalan z=208 dan pantai) ----------
  for (let bx = -3; bx <= 3; bx += 2) {
    const px = bx * PITCH;
    const pz = 4 * PITCH + PITCH / 2;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK, BLOCK - 6), new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 1 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(px, 0.025, pz);
    lot.receiveShadow = true;
    scene.add(lot);
    // Garis slot parkir.
    for (let s = -3; s <= 3; s++) {
      addBox(new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }), px + s * 5, 0.04, pz, 0.25, 0.02, 8, { cast: false });
    }
    spawns.cars.push({ x: px - 10, z: pz, heading: Math.PI / 2 });
    spawns.cars.push({ x: px + 10, z: pz, heading: Math.PI / 2 });
  }

  // ---------- Lampu jalan, palem kota, rambu ----------
  function addPalm(x, z) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(cylGeo, trunkMat);
    trunk.scale.set(0.35, 7, 0.35);
    trunk.position.y = 3.5;
    trunk.rotation.z = (rand() - 0.5) * 0.15;
    trunk.castShadow = true;
    palm.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(boxGeo, palmMat);
      const ang = (i / 6) * Math.PI * 2;
      leaf.scale.set(4.5, 0.25, 1.4);
      leaf.position.set(Math.cos(ang) * 2.2, 7.2, Math.sin(ang) * 2.2);
      leaf.rotation.y = -ang;
      leaf.rotation.z = 0.45;
      leaf.castShadow = true;
      palm.add(leaf);
    }
    palm.position.set(x, 0, z);
    scene.add(palm);
    colliders.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
  }

  function addLamp(x, z) {
    const pole = new THREE.Mesh(cylGeo, lampPoleMat);
    pole.scale.set(0.18, 6, 0.18);
    pole.position.set(x, 3, z);
    pole.castShadow = true;
    scene.add(pole);
    const arm = addBox(lampPoleMat, x, 6, z, 0.2, 0.2, 2.2, { cast: false });
    arm.position.z = z + 1;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), lampGlowMat);
    bulb.position.set(x, 5.9, z + 2);
    scene.add(bulb);
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
  }

  // Lampu di tiap persimpangan, palem di tepi jalan utama.
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = i * PITCH + ROAD / 2 + 1;
      const z = j * PITCH + ROAD / 2 + 1;
      addLamp(x, z);
    }
  }
  for (let i = -4; i <= 4; i++) {
    addPalm(i * PITCH + BLOCK / 2 + 2, -HALF - 4);
    addPalm(i * PITCH - BLOCK / 2 - 2, HALF + 4);
  }

  // Rambu: tiang + papan (STOP di persimpangan utama, arah pantai).
  function addSign(x, z, color) {
    const pole = new THREE.Mesh(cylGeo, lampPoleMat);
    pole.scale.set(0.1, 2.6, 0.1);
    pole.position.set(x, 1.3, z);
    scene.add(pole);
    const board = addBox(new THREE.MeshStandardMaterial({ color, roughness: 0.7 }), x, 2.8, z, 1.6, 1.6, 0.1, { cast: false });
    board.rotation.y = Math.PI / 4;
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 });
  }
  addSign(PITCH + ROAD / 2 + 1, PITCH + ROAD / 2 + 1, 0xd90429);
  addSign(-PITCH - ROAD / 2 - 1, 2 * PITCH + ROAD / 2 + 1, 0x118ab2);
  addSign(0, BEACH_Z - 4, 0x06d6a0);

  // ---------- Spawn ----------
  spawns.player = { x: 0, z: 26 };
  // Titik-titik misi (dipakai missions.js; semuanya di jalan/pasir yang bisa
  // dicapai jalan kaki, bukan di dalam gedung). miraWorkshop di jalan x=0
  // tepat di utara spawn; sedan di jalan x=52 dekat alun-alun.
  spawns.miraWorkshop = { x: 0, z: -26 };
  spawns.sedan = { x: 52, z: 0 };
  spawns.packageDrop = { x: -208, z: -104 };
  spawns.ditoStart = { x: 208, z: 104 };
  spawns.shop = { x: -104, z: 208 };
  spawns.safehouse = { x: 156, z: 208 };
  spawns.harbor = { x: 0, z: 262 };
  spawns.briefcase = { x: 8, z: 300 };
  // Spawn mobil di jalan (traffic) + parkir.
  for (let i = 0; i < 10; i++) {
    const road = roads[Math.floor(rand() * roads.length)];
    const t = rand();
    spawns.cars.push({
      x: road.x1 + (road.x2 - road.x1) * t + (rand() - 0.5) * 4,
      z: road.z1 + (road.z2 - road.z1) * t + (rand() - 0.5) * 4,
      heading: Math.abs(road.x2 - road.x1) > Math.abs(road.z2 - road.z1) ? (rand() < 0.5 ? 0 : Math.PI) : (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
    });
  }
  // Spawn pejalan kaki di trotoar sekitar plaza & jalan utama.
  for (let i = 0; i < 24; i++) {
    const bx = Math.floor(rand() * 5) - 2;
    const bz = Math.floor(rand() * 5) - 2;
    spawns.peds.push({
      x: bx * PITCH + (rand() - 0.5) * (BLOCK + 2),
      z: bz * PITCH + (rand() - 0.5) * (BLOCK + 2),
    });
  }

  return { beachZ: BEACH_Z, seaZ: SEA_Z, half: HALF };
}

export default buildCity;

// missions.js — Rantai 6 misi orisinal "Solmar Bay" untuk game open-world crime 3D.
// Semua tokoh, tempat, dan cerita di sini orisinal (kota fiktif Solmar Bay).
// Modul ini HANYA mengurus logika misi: stage, target, timer, dialog, reward,
// marker 3D, dan kondisi gagal/ulang. Gerakan player, kendaraan, dan tembak-menembak
// tetap menjadi urusan modul world/player (builder B) — modul ini hanya membaca
// dan menulis state sesuai kontrak bersama.
//
// Kontrak yang dipakai:
//   state.mission = { index, id, stage, objectiveText, target: {x,z}|null, done }
//   state.player  = { x, z, heading, speed, onFoot, vehicleId, weapon, ammo }
//   state.vehicles / state.peds / state.police  = array objek dunia
//   state.money, state.health, state.armor, state.wanted, state.wantedHeat
//   state.city    = { colliders, roads, spawns }
//   ctx.bus       = { on(event, fn), emit(event, payload) }
//   ctx.THREE     = (opsional) namespace three.js untuk marker 3D
//   ctx.registerUpdate(fn) = (opsional) pendaftaran update(dt) ke main.js
//
// initSystem mengembalikan { update(dt), startMission, restartMission, ... }
// sekaligus mendaftarkan update ke ctx.registerUpdate bila tersedia, supaya
// main.js bisa memanggil update lewat registry ATAU lewat nilai kembalian.
//
// Event bus yang di-emit:
//   'mission-start' { id, title } | 'mission-stage' { id, stage, text }
//   'mission-done'  { id, title, reward } | 'mission-failed' { id, reason }
//   'toast' { text } | 'dialog' { lines } (untuk HUD/audio bila mendengarkan)
//   'game-complete' { money, missionsDone }
// Event bus yang didengarkan:
//   'mission-retry' | 'game-retry' -> ulang misi aktif dari checkpoint
//   'kill' { id } | 'ped-down' { id } -> penjaga misi tumbang
//   'game-restart' -> reset semua progres dan mulai dari M1

// ---------------------------------------------------------------------------
// Peta kota: titik-titik fallback bila state.city.spawns belum diisi builder A.
// Nilainya sama dengan spawn misi di city.js (semua di jalan/pasir yang bisa
// dicapai, di dalam kota -234..234 — BUKAN -400..400).
const FALLBACK_SPOTS = {
  player: { x: 0, z: 26 },
  miraWorkshop: { x: 0, z: -26 },
  sedan: { x: 52, z: 0 },
  packageDrop: { x: -208, z: -104 },
  ditoStart: { x: 208, z: 104 },
  shop: { x: -104, z: 208 },
  safehouse: { x: 156, z: 208 },
  harbor: { x: 0, z: 262 },
  briefcase: { x: 8, z: 300 },
};

const CITY_MIN = -230;
const CITY_MAX = 230;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function spot(state, name) {
  const spawns = (state.city && state.city.spawns) || {};
  if (spawns[name] && typeof spawns[name].x === 'number' && typeof spawns[name].z === 'number') {
    return { x: spawns[name].x, z: spawns[name].z };
  }
  return { ...FALLBACK_SPOTS[name] };
}

// ---------------------------------------------------------------------------
// Definisi misi. Setiap misi: intro (dialog), stages berurutan, outro, reward.
// Stage types:
//   goto          -> capai radius target
//   enter-vehicle -> player.vehicleId harus sama dengan targetVehicleId
//   deliver       -> goto target sambil berada di kendaraan target (timer opsional)
//   pickup        -> capai radius target, lalu ambil (otomatis)
//   approach      -> capai radius besar, memicu perilaku NPC (Dito kabur)
//   chase         -> bertahan dalam radius kecil dari target bergerak selama X detik
//   eliminate     -> kalahkan N penjaga (dihitung dari state.peds / event 'kill')
//   escape        -> capai safehouse; wanted direset saat tiba
// ---------------------------------------------------------------------------
const MISSIONS = [
  {
    id: 'm1',
    title: 'Kenalan Kota',
    reward: 100,
    intro: [
      { who: 'Mira', text: 'Raka! Akhirnya sampai juga di Solmar Bay. Kota ini keras, tapi penuh peluang.' },
      { who: 'Mira', text: 'Aku Mira, mekanik di bengkel sudut Teluk. Butuh apa pun soal mobil, cari aku.' },
      { who: 'Raka', text: 'Senang bertemu. Ke mana dulu?' },
      { who: 'Mira', text: 'Jalan dulu keliling blok. Ikuti penanda kuning di peta — aku tunggu di bengkel.' },
    ],
    outro: [
      { who: 'Mira', text: 'Nah, begitu. Kau cepat belajar. Ada kerjaan pertama buatmu...' },
    ],
    stages: [
      { type: 'goto', target: 'miraWorkshop', radius: 5, text: 'Temui Mira di bengkelnya' },
    ],
  },
  {
    id: 'm2',
    title: 'Mobil Pertama',
    reward: 250,
    intro: [
      { who: 'Mira', text: 'Ada sedan merah terparkir di dekat alun-alun. Pemiliknya... sedang tidak butuh mobilnya.' },
      { who: 'Mira', text: 'Bawa ke sini. Pelan-pelan, jangan sampai penyok.' },
      { who: 'Raka', text: 'Dipahami. Sedan merah, alun-alun, bawa ke bengkel.' },
    ],
    outro: [
      { who: 'Mira', text: 'Mulus! Mesinnya masih bagus. Kau punya bakat, Raka.' },
    ],
    stages: [
      { type: 'goto', target: 'sedan', radius: 6, text: 'Cari sedan merah di dekat alun-alun' },
      { type: 'enter-vehicle', targetVehicleId: 'm2-sedan', radius: 6, text: 'Naik ke sedan merah (tekan E di dekat mobil)' },
      { type: 'deliver', target: 'miraWorkshop', radius: 6, targetVehicleId: 'm2-sedan', text: 'Antar sedan ke bengkel Mira' },
    ],
  },
  {
    id: 'm3',
    title: 'Antar Paket',
    reward: 400,
    intro: [
      { who: 'Mira', text: 'Paket ini harus sampai ke kios di ujung barat sebelum 90 detik. Jalannya macet, jadi ngebutlah.' },
      { who: 'Raka', text: '90 detik? Baik, gas!' },
    ],
    outro: [
      { who: 'Pemilik Kios', text: 'Paket diterima, terima kasih! Tepat waktu pula.' },
    ],
    stages: [
      { type: 'pickup', target: 'miraWorkshop', radius: 4, text: 'Ambil paket di bengkel Mira' },
      { type: 'deliver', target: 'packageDrop', radius: 5, time: 90, text: 'Antar paket ke kios ujung barat' },
    ],
  },
  {
    id: 'm4',
    title: 'Tagih Utang',
    reward: 500,
    intro: [
      { who: 'Mira', text: 'Dito berutang padaku. Dia kabur naik mobil tiap kali ditagih. Kejar dia sampai dia berhenti.' },
      { who: 'Raka', text: 'Dito, ya? Biar kuurus.' },
    ],
    outro: [
      { who: 'Dito', text: 'Baik, baik! Ini uangnya. Jangan bilang Seno aku bersembunyi di sini.' },
    ],
    stages: [
      { type: 'approach', target: 'ditoStart', radius: 30, text: 'Datangi Dito di kawasan timur' },
      { type: 'chase', radius: 8, holdSeconds: 1.5, time: 150, text: 'Kejar mobil Dito sampai dia menyerah' },
    ],
  },
  {
    id: 'm5',
    title: 'Perampokan Mini',
    reward: 800,
    intro: [
      { who: 'Seno', text: 'Toko di jalan Pelabuhan menyimpan tas uang di brankas belakang. Ambil, lalu hilang sebelum polisi datang.' },
      { who: 'Raka', text: 'Tas uang, brankas belakang, lalu kabur. Siap.' },
    ],
    outro: [
      { who: 'Raka', text: 'Aman. Polisi kehilangan jejak.' },
    ],
    stages: [
      { type: 'goto', target: 'shop', radius: 5, text: 'Masuk ke toko di jalan Pelabuhan' },
      { type: 'pickup', target: 'shop', radius: 3, text: 'Ambil tas uang dari brankas belakang', onTake: 'wanted' },
      { type: 'escape', target: 'safehouse', radius: 6, text: 'Kabur dari polisi ke safehouse' },
    ],
  },
  {
    id: 'm6',
    title: 'Final: Rebut Pelabuhan',
    reward: 2000,
    intro: [
      { who: 'Seno', text: 'Pelabuhan dikuasai geng Pelaut Hitam. Rebut koper mereka, dan Solmar Bay jadi milik kita.' },
      { who: 'Raka', text: 'Empat penjaga, satu koper. Ayo selesaikan.' },
    ],
    outro: [
      { who: 'Seno', text: 'Kopernya di tangan kita. Mulai hari ini, kota ini mengenal namamu, Raka.' },
    ],
    stages: [
      { type: 'goto', target: 'harbor', radius: 10, text: 'Pergi ke pelabuhan' },
      { type: 'eliminate', count: 4, text: 'Kalahkan 4 penjaga pelabuhan' },
      { type: 'pickup', target: 'briefcase', radius: 3, text: 'Ambil koper di dermaga' },
      { type: 'escape', target: 'safehouse', radius: 6, text: 'Kabur ke safehouse dengan koper' },
    ],
  },
];

function dummyBus() {
  return { on() {}, emit() {} };
}

export function initSystem(state, scene, ctx) {
  const bus = (ctx && ctx.bus) || dummyBus();
  const THREE = (ctx && (ctx.THREE || ctx.three)) || null;

  // Runtime lokal (tidak disimpan ke save — hanya state.mission yang dipublikasi).
  const rt = {
    idx: 0,
    stageIdx: 0,
    active: false,
    allDone: false,
    timer: null, // detik tersisa, null bila stage tanpa timer
    catchTime: 0,
    guards: [], // { id, x, z, dead }
    dito: null, // { car, ped, target, fleeing }
    checkpoint: null, // { x, z, heading, health }
    dialogOpen: false,
    dialogQueue: [],
    dialogDone: null,
    prevMode: null,
    time: 0,
    marker: null, // { group, arrow } bila THREE tersedia
    toastCooldown: 0,
  };

  // Pastikan struktur state sesuai kontrak (defensif bila builder A belum jalan).
  if (!state.mission) state.mission = { index: 0, id: null, stage: 0, objectiveText: '', target: null, done: false };
  if (!Array.isArray(state.vehicles)) state.vehicles = [];
  if (!Array.isArray(state.peds)) state.peds = [];
  if (!Array.isArray(state.police)) state.police = [];
  if (!state.flags) state.flags = {};
  if (!state.stats) state.stats = { carsStolen: 0, missionsDone: 0, kills: 0 };
  if (typeof state.money !== 'number') state.money = 0;
  if (typeof state.health !== 'number') state.health = 100;

  // -------------------------------------------------------------------------
  // Marker 3D (beam cahaya + panah). Bila THREE tidak tersedia lewat ctx,
  // posisi marker dipublikasi di state.mission.marker agar renderer builder B
  // bisa menggambarnya sendiri.
  // -------------------------------------------------------------------------
  function createMarker() {
    if (!THREE || !scene || typeof scene.add !== 'function') return null;
    try {
      const group = new THREE.Group();
      const beamGeo = new THREE.CylinderGeometry(3, 3, 10, 24, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 5;
      const arrowGeo = new THREE.ConeGeometry(1.2, 2.4, 16);
      const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.rotation.x = Math.PI; // ujung mengarah ke bawah
      arrow.position.y = 12;
      group.add(beam);
      group.add(arrow);
      group.visible = false;
      scene.add(group);
      return { group, arrow };
    } catch {
      return null;
    }
  }

  function removeMarker() {
    if (rt.marker && scene && typeof scene.remove === 'function') {
      try { scene.remove(rt.marker.group); } catch { /* abaikan */ }
    }
    rt.marker = null;
    if (state.mission) state.mission.marker = null;
  }

  function placeMarker(x, z) {
    if (rt.marker) {
      rt.marker.group.position.set(x, 0, z);
      rt.marker.group.visible = true;
    }
    if (state.mission) state.mission.marker = { x, z, active: true };
  }

  function hideMarker() {
    if (rt.marker) rt.marker.group.visible = false;
    if (state.mission) state.mission.marker = null;
  }

  // -------------------------------------------------------------------------
  // Dialog (cutscene teks sederhana). Memakai elemen #dialog bila sudah ada
  // (dibuat hud.js); bila belum ada, dibuat di sini agar misi tetap jalan.
  // Selama dialog, state.mode = 'dialog' supaya world berhenti bergerak.
  // -------------------------------------------------------------------------
  function ensureDialogEl() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('dialog');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dialog';
    el.style.cssText = 'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);'
      + 'width:min(560px,90vw);background:rgba(10,14,24,.92);color:#f2f2f2;'
      + 'border:1px solid #ffd23f;border-radius:10px;padding:16px 18px;'
      + 'font-family:system-ui,sans-serif;z-index:60;display:none;cursor:pointer;';
    el.innerHTML = '<div id="dialog-who" style="color:#ffd23f;font-weight:700;margin-bottom:6px;"></div>'
      + '<div id="dialog-text" style="line-height:1.5;"></div>'
      + '<div style="text-align:right;color:#aaa;font-size:12px;margin-top:10px;">Klik / Enter untuk lanjut ▸</div>';
    document.body.appendChild(el);
    return el;
  }

  function showDialog(lines, onDone) {
    if (!lines || lines.length === 0) {
      if (onDone) onDone();
      return;
    }
    const el = ensureDialogEl();
    rt.dialogQueue = lines.slice();
    rt.dialogDone = onDone || null;
    rt.dialogOpen = true;
    rt.prevMode = state.mode;
    state.mode = 'dialog';
    state.flags.dialogOpen = true;
    renderDialogLine(el);
    bus.emit('dialog', { lines });
  }

  function renderDialogLine(el) {
    const line = rt.dialogQueue[0];
    if (!line) return;
    if (!el) el = ensureDialogEl();
    if (!el) return;
    el.style.display = 'block';
    const who = el.querySelector('#dialog-who');
    const text = el.querySelector('#dialog-text');
    if (who) who.textContent = line.who || '';
    if (text) text.textContent = line.text || '';
  }

  function advanceDialog() {
    if (!rt.dialogOpen) return;
    rt.dialogQueue.shift();
    const el = typeof document !== 'undefined' ? document.getElementById('dialog') : null;
    if (rt.dialogQueue.length === 0) {
      rt.dialogOpen = false;
      state.flags.dialogOpen = false;
      if (el) el.style.display = 'none';
      state.mode = rt.prevMode === 'dialog' ? 'playing' : (rt.prevMode || 'playing');
      const done = rt.dialogDone;
      rt.dialogDone = null;
      bus.emit('dialog-done', {});
      if (done) done();
    } else {
      renderDialogLine(el);
    }
  }

  function bindDialogInput() {
    if (typeof document === 'undefined' || rt._dialogBound) return;
    rt._dialogBound = true;
    document.addEventListener('click', (e) => {
      if (rt.dialogOpen && e.target && e.target.closest && e.target.closest('#dialog')) advanceDialog();
    });
    document.addEventListener('keydown', (e) => {
      if (rt.dialogOpen && (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'e')) {
        e.preventDefault();
        advanceDialog();
      }
    });
  }
  bindDialogInput();

  // -------------------------------------------------------------------------
  // Helper dunia: kendaraan & NPC misi.
  // -------------------------------------------------------------------------
  // Kendaraan misi memakai field yang sama dengan vehicles.js (kind, color,
  // hp, driver, ...) supaya mesh-nya tergambar dan bisa dinaiki. Bila sudah
  // ada (misal restart misi), posisinya di-reset ke titik stage.
  function ensureVehicle(def) {
    let v = state.vehicles.find((item) => item.id === def.id);
    if (!v) {
      v = { ...def };
      state.vehicles.push(v);
    } else {
      v.x = def.x;
      v.z = def.z;
      v.heading = def.heading;
      v.speed = 0;
      v.hp = 100;
      v.driver = def.driver || 'none';
    }
    return v;
  }

  function ensurePed(def) {
    let p = state.peds.find((item) => item.id === def.id);
    if (!p) {
      p = { ...def };
      state.peds.push(p);
    } else {
      p.x = def.x;
      p.z = def.z;
      p.heading = def.heading;
      p.health = 100;
      p.down = false;
      p.dead = false;
    }
    return p;
  }

  function removePedById(id) {
    const i = state.peds.findIndex((item) => item.id === id);
    if (i >= 0) state.peds.splice(i, 1);
  }

  function toast(text) {
    bus.emit('toast', { text });
  }

  // -------------------------------------------------------------------------
  // Mesin stage.
  // -------------------------------------------------------------------------
  function currentMission() {
    return MISSIONS[rt.idx] || null;
  }

  function currentStage() {
    const m = currentMission();
    if (!m) return null;
    return m.stages[rt.stageIdx] || null;
  }

  function stageTargetPos(stage) {
    if (!stage || !stage.target) return null;
    return spot(state, stage.target);
  }

  function syncMissionState() {
    const m = currentMission();
    const stage = currentStage();
    state.mission.index = rt.idx;
    state.mission.id = m ? m.id : null;
    state.mission.stage = rt.stageIdx;
    state.mission.done = rt.allDone;
    if (!m || rt.allDone) {
      state.mission.objectiveText = rt.allDone
        ? 'Semua misi selesai — free roam Solmar Bay!'
        : '';
      state.mission.target = null;
      return;
    }
    let text = stage ? stage.text : '';
    if (stage && stage.type === 'eliminate') {
      const left = rt.guards.filter((g) => !g.dead).length;
      text = `Kalahkan penjaga pelabuhan (${rt.guards.length - left}/${rt.guards.length})`;
    }
    if (rt.timer !== null && rt.timer !== undefined) {
      text += ` — ${Math.max(0, Math.ceil(rt.timer))} dtk`;
    }
    state.mission.objectiveText = text;
    const pos = stageTargetPos(stage);
    if (stage && stage.type === 'chase' && rt.dito && rt.dito.car) {
      state.mission.target = { x: rt.dito.car.x, z: rt.dito.car.z };
    } else if (stage && stage.type === 'eliminate') {
      const alive = rt.guards.find((g) => !g.dead);
      state.mission.target = alive ? { x: alive.x, z: alive.z } : null;
    } else {
      state.mission.target = pos;
    }
  }

  function setStage(i, announce) {
    const m = currentMission();
    if (!m) return;
    rt.stageIdx = i;
    rt.timer = null;
    rt.catchTime = 0;
    const stage = m.stages[i];
    if (!stage) return;
    if (typeof stage.time === 'number') rt.timer = stage.time;

    // Persiapan khusus per stage.
    if (m.id === 'm2' && i === 0) {
      const s = spot(state, 'sedan');
      ensureVehicle({ id: 'm2-sedan', kind: 'sedan', type: 'sedan', x: s.x, z: s.z, heading: 0.6, speed: 0, color: 0xd23c2e, driver: 'none', hp: 100, maxSpeed: 26, mission: 'm2-target' });
    }
    if (m.id === 'm4' && i === 0) {
      const s = spot(state, 'ditoStart');
      const car = ensureVehicle({ id: 'dito-car', kind: 'sedan', type: 'sedan', x: s.x, z: s.z, heading: 0, speed: 0, color: 0x2e86d2, driver: 'none', hp: 100, maxSpeed: 26, mission: 'm4-target' });
      const ped = ensurePed({ id: 'dito', x: s.x, z: s.z, heading: 0, speed: 0, health: 100, down: false, dead: false, kind: 'civilian', mission: 'm4-target' });
      rt.dito = { car, ped, target: null, fleeing: false };
    }
    if (m.id === 'm6' && i === 1) {
      spawnGuards();
    }
    const pos = stageTargetPos(stage);
    if (pos) placeMarker(pos.x, pos.z);
    else if (stage.type === 'enter-vehicle') {
      const v = state.vehicles.find((item) => item.id === stage.targetVehicleId);
      if (v) placeMarker(v.x, v.z);
    }
    syncMissionState();
    if (announce !== false) {
      bus.emit('mission-stage', { id: m.id, stage: i, text: stage.text });
    }
  }

  function spawnGuards() {
    const h = spot(state, 'harbor');
    const offsets = [
      { x: -12, z: -6 }, { x: 10, z: -10 }, { x: -6, z: 12 }, { x: 14, z: 8 },
    ];
    rt.guards = offsets.map((o, i) => {
      const id = `guard-${i + 1}`;
      ensurePed({
        id, x: h.x + o.x, z: h.z + o.z, heading: Math.random() * Math.PI * 2,
        speed: 0, health: 100, down: false, dead: false, kind: 'guard', mission: 'm6-target',
      });
      return { id, x: h.x + o.x, z: h.z + o.z, dead: false };
    });
  }

  function refreshGuards() {
    for (const g of rt.guards) {
      if (g.dead) continue;
      const ped = state.peds.find((p) => p.id === g.id);
      // combat.js menandai ped yang ditembak/dipukul dengan dead/down (bukan
      // health), jadi ketiganya dihitung sebagai tumbang.
      if (!ped || ped.dead || ped.down || (typeof ped.health === 'number' && ped.health <= 0)) {
        g.dead = true;
        state.stats.kills = (state.stats.kills || 0) + 1;
        bus.emit('toast', { text: `Penjaga tumbang (${rt.guards.filter((x) => x.dead).length}/${rt.guards.length})` });
      } else {
        g.x = ped.x;
        g.z = ped.z;
      }
    }
  }

  function startMission(idx, opts) {
    const m = MISSIONS[idx];
    if (!m) return;
    rt.idx = idx;
    rt.stageIdx = 0;
    rt.active = true;
    rt.allDone = false;
    rt.timer = null;
    rt.catchTime = 0;
    rt.guards = [];
    rt.dito = null;
    rt.checkpoint = {
      x: state.player.x, z: state.player.z,
      heading: state.player.heading || 0, health: state.health,
    };
    if (!rt.marker) rt.marker = createMarker();
    bus.emit('mission-start', { id: m.id, title: m.title });
    const skipIntro = opts && opts.skipIntro;
    if (skipIntro) {
      setStage(0);
    } else {
      showDialog(m.intro, () => setStage(0));
      // Tandai misi aktif walau dialog masih tampil; stage 0 dipasang setelah dialog.
      state.mission.index = idx;
      state.mission.id = m.id;
      state.mission.objectiveText = m.title + ' — baca dialog...';
    }
  }

  function completeStage() {
    const m = currentMission();
    if (!m) return;
    rt.stageIdx += 1;
    if (rt.stageIdx >= m.stages.length) {
      completeMission();
    } else {
      setStage(rt.stageIdx);
    }
  }

  function completeMission() {
    const m = currentMission();
    if (!m) return;
    state.money = (state.money || 0) + m.reward;
    state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
    hideMarker();
    bus.emit('mission-done', { id: m.id, title: m.title, reward: m.reward });
    toast(`Misi selesai: ${m.title} — +$${m.reward}`);
    const next = rt.idx + 1;
    const finish = () => {
      if (next >= MISSIONS.length) {
        rt.allDone = true;
        rt.active = false;
        state.mission.done = true;
        state.mission.objectiveText = 'Semua misi selesai — free roam Solmar Bay!';
        state.mission.target = null;
        state.mode = 'complete';
        bus.emit('game-complete', { money: state.money, missionsDone: state.stats.missionsDone });
      } else {
        startMission(next);
      }
    };
    if (m.outro && m.outro.length) showDialog(m.outro, finish);
    else finish();
  }

  function failMission(reason) {
    const m = currentMission();
    if (!m || !rt.active) return;
    rt.active = false;
    hideMarker();
    if (rt.dito) {
      rt.dito.fleeing = false;
      rt.dito = null;
    }
    bus.emit('mission-failed', { id: m.id, title: m.title, reason });
    toast(`Misi gagal: ${m.title} — ${reason}`);
    syncMissionState();
  }

  function restartMission() {
    const m = currentMission();
    if (!m) return;
    // Kembalikan player ke checkpoint awal misi.
    if (rt.checkpoint) {
      state.player.x = rt.checkpoint.x;
      state.player.z = rt.checkpoint.z;
      state.player.heading = rt.checkpoint.heading;
      state.health = Math.max(50, rt.checkpoint.health || 100);
      state.player.onFoot = true;
      state.player.vehicleId = null;
    }
    state.wanted = 0;
    state.wantedHeat = 0;
    // Bersihkan NPC misi sebelumnya.
    for (const g of rt.guards) removePedById(g.id);
    removePedById('dito');
    rt.guards = [];
    rt.dito = null;
    state.mode = 'playing';
    toast(`Mengulang misi: ${m.title}`);
    startMission(rt.idx, { skipIntro: true });
  }

  // -------------------------------------------------------------------------
  // Update per frame (dipanggil main.js saat mode 'playing').
  // -------------------------------------------------------------------------
  function update(dt) {
    rt.time += dt;
    if (rt.toastCooldown > 0) rt.toastCooldown -= dt;
    if (state.mode !== 'playing') return;
    if (!rt.active || rt.allDone) return;
    const m = currentMission();
    const stage = currentStage();
    if (!m || !stage) return;

    const p = state.player;

    // Timer stage: habis -> misi gagal.
    if (rt.timer !== null && rt.timer !== undefined) {
      rt.timer -= dt;
      if (rt.timer <= 0) {
        rt.timer = 0;
        syncMissionState();
        failMission('Waktu habis.');
        return;
      }
    }

    // Animasi marker (panah naik-turun, beam berputar pelan).
    if (rt.marker && rt.marker.group.visible) {
      rt.marker.arrow.position.y = 12 + Math.sin(rt.time * 3) * 1.2;
      rt.marker.group.rotation.y += dt * 0.8;
    }

    switch (stage.type) {
      case 'goto':
      case 'pickup':
      case 'escape': {
        const pos = stageTargetPos(stage);
        if (!pos) break;
        if (dist2d(p.x, p.z, pos.x, pos.z) <= stage.radius) {
          if (stage.onTake === 'wanted') {
            state.wanted = Math.min(5, (state.wanted || 0) + 3);
            state.wantedHeat = 100;
            bus.emit('siren', {});
            toast('Polisi mengejarmu! Kabur ke safehouse!');
          }
          if (stage.type === 'escape') {
            state.wanted = 0;
            state.wantedHeat = 0;
            toast('Jejak hilang. Aman untuk sekarang.');
          }
          completeStage();
        }
        break;
      }
      case 'enter-vehicle': {
        if (p.vehicleId === stage.targetVehicleId) {
          state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
          bus.emit('car-stolen', { vehicleId: p.vehicleId });
          toast('Sedan didapat. Antar ke bengkel Mira!');
          completeStage();
        } else if (p.vehicleId && rt.toastCooldown <= 0) {
          rt.toastCooldown = 8;
          toast('Itu bukan sedan merah target. Cari sedan merahnya.');
        }
        break;
      }
      case 'deliver': {
        const pos = stageTargetPos(stage);
        if (!pos) break;
        if (stage.targetVehicleId && p.vehicleId !== stage.targetVehicleId) {
          // Player turun dari mobil: tetap di stage, beri petunjuk berkala.
          if (rt.toastCooldown <= 0) {
            rt.toastCooldown = 8;
            toast('Kembali ke mobil target untuk melanjutkan antar.');
          }
          break;
        }
        if (dist2d(p.x, p.z, pos.x, pos.z) <= stage.radius) completeStage();
        break;
      }
      case 'approach': {
        const pos = stageTargetPos(stage);
        if (!pos) break;
        if (dist2d(p.x, p.z, pos.x, pos.z) <= stage.radius) {
          // Dito sadar lalu kabur dengan mobilnya.
          if (rt.dito) {
            rt.dito.fleeing = true;
            const ped = state.peds.find((x) => x.id === 'dito');
            if (ped) { ped.x = rt.dito.car.x; ped.z = rt.dito.car.z; }
          }
          const nextStage = rt.stageIdx + 1;
          showDialog([{ who: 'Dito', text: 'Jangan kejar aku! Aku bayar, aku bayar!' }], () => {
            setStage(nextStage);
          });
          // Jeda mesin stage sampai dialog selesai: tandai dengan stageIdx -1 sementara.
          rt.stageIdx = -1;
        }
        break;
      }
      case 'chase': {
        updateDito(dt);
        const car = rt.dito && rt.dito.car;
        if (!car) break;
        const d = dist2d(p.x, p.z, car.x, car.z);
        if (d <= stage.radius) {
          rt.catchTime += dt;
          if (rt.catchTime >= (stage.holdSeconds || 1.5)) {
            if (rt.dito) rt.dito.fleeing = false;
            completeStage();
          }
        } else {
          rt.catchTime = Math.max(0, rt.catchTime - dt * 0.5);
        }
        break;
      }
      case 'eliminate': {
        refreshGuards();
        if (rt.guards.length > 0 && rt.guards.every((g) => g.dead)) {
          toast('Pelabuhan bersih. Ambil kopernya!');
          completeStage();
        }
        break;
      }
      default:
        break;
    }

    syncMissionState();
  }

  // Dito kabur: mobilnya bergerak menjauhi player menuju titik acak.
  function updateDito(dt) {
    const d = rt.dito;
    if (!d || !d.fleeing || !d.car) return;
    const p = state.player;
    const car = d.car;
    if (!d.target || dist2d(car.x, car.z, d.target.x, d.target.z) < 15) {
      const awayX = car.x - p.x;
      const awayZ = car.z - p.z;
      const base = Math.atan2(awayX, awayZ);
      const ang = base + (Math.random() - 0.5) * 1.4;
      d.target = {
        x: clamp(car.x + Math.sin(ang) * 140, CITY_MIN, CITY_MAX),
        z: clamp(car.z + Math.cos(ang) * 140, CITY_MIN, CITY_MAX),
      };
    }
    const tx = d.target.x - car.x;
    const tz = d.target.z - car.z;
    const td = Math.hypot(tx, tz) || 1;
    const speed = 11; // m/detik — mobil player lebih cepat, jadi bisa terkejar
    car.x += (tx / td) * speed * dt;
    car.z += (tz / td) * speed * dt;
    car.heading = Math.atan2(tx, tz);
    const ped = state.peds.find((x) => x.id === 'dito');
    if (ped) {
      ped.x = car.x;
      ped.z = car.z;
      ped.heading = car.heading;
    }
    // Marker mengikuti mobil Dito.
    placeMarker(car.x, car.z);
  }

  // -------------------------------------------------------------------------
  // Event bus.
  // -------------------------------------------------------------------------
  bus.on('mission-retry', () => restartMission());
  bus.on('game-retry', () => restartMission());
  bus.on('kill', (payload) => {
    if (!payload || !payload.id) return;
    const g = rt.guards.find((x) => x.id === payload.id);
    if (g && !g.dead) {
      g.dead = true;
      removePedById(payload.id);
    }
  });
  bus.on('ped-down', (payload) => {
    if (!payload || !payload.id) return;
    const g = rt.guards.find((x) => x.id === payload.id);
    if (g && !g.dead) {
      g.dead = true;
      removePedById(payload.id);
    }
  });
  // Mulai dari save: lompat ke misi tersimpan (dipakai save.js setelah load).
  bus.on('save-loaded', (payload) => {
    if (!payload || typeof payload.missionIndex !== 'number') return;
    const idx = clamp(payload.missionIndex, 0, MISSIONS.length - 1);
    if (idx >= MISSIONS.length) {
      rt.allDone = true;
      syncMissionState();
      return;
    }
    startMission(idx, { skipIntro: true });
  });
  bus.on('game-start', () => {
    // Intro M1 sudah tampil (klik Start ganda / handler hud + main.js):
    // jangan mulai ulang.
    if (rt.active && rt.idx === 0 && state.mode === 'dialog') return;
    // Mulai baru / main lagi: bersihkan misi lama apa pun kondisinya,
    // lalu mulai M1 dari awal.
    for (const g of rt.guards) removePedById(g.id);
    removePedById('dito');
    rt.guards = [];
    rt.dito = null;
    rt.allDone = false;
    rt.active = false;
    hideMarker();
    startMission(0);
  });
  // "Ulang dari Awal" (pause menu): reset progres misi + ekonomi, kembali ke spawn.
  bus.on('game-restart', () => {
    for (const g of rt.guards) removePedById(g.id);
    removePedById('dito');
    rt.guards = [];
    rt.dito = null;
    rt.allDone = false;
    rt.active = false;
    state.money = 250;
    state.health = 100;
    state.armor = 0;
    state.wanted = 0;
    state.wantedHeat = 0;
    state.stats = { carsStolen: 0, missionsDone: 0, kills: 0 };
    const s = spot(state, 'player');
    state.player.x = s.x;
    state.player.z = s.z;
    state.player.heading = 0;
    state.player.onFoot = true;
    state.player.vehicleId = null;
    hideMarker();
    startMission(0);
  });

  // Daftarkan update ke registry main.js bila tersedia.
  if (ctx && typeof ctx.registerUpdate === 'function') {
    try { ctx.registerUpdate(update); } catch { /* abaikan */ }
  }

  return {
    update,
    startMission,
    restartMission,
    getCurrentMission: currentMission,
    getMissions: () => MISSIONS.map((m) => ({ id: m.id, title: m.title, reward: m.reward })),
    advanceDialog,
  };
}

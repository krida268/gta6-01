// hud.js — HUD, minimap, menu, pause, game over, dan dialog untuk "Solmar Bay".
// Semua update lewat DOM/canvas murni, tanpa library. Modul ini defensif:
// bila index.html (builder A) belum menyediakan elemen dengan id yang dikontrak
// (#hud, #minimap, #wanted, #objective, #money, #health-bar, #ammo, #speed,
// #message, #menu, #pause, #gameover), elemen itu dibuat di sini dengan gaya
// inline agar game tetap bisa jalan. Bila elemen sudah ada, dipakai apa adanya.
//
// Kontrak yang dipakai:
//   state = { mode, time, money, health, armor, wanted, wantedHeat,
//             player: { x, z, heading, speed, onFoot, vehicleId, weapon, ammo },
//             vehicles, peds, police,
//             mission: { index, id, stage, objectiveText, target: {x,z}|null, done },
//             city: { roads, spawns } }
//   ctx = { camera, renderer, input, bus }
//   ctx.save = (opsional, dipasang save.js) { saveGame, loadGame, hasSave }
//   ctx.audio = (opsional) { toggleMute } — bila tidak ada, mute lewat bus.
//
// Event bus yang didengarkan:
//   'toast'/'message' { text } -> toast 4 detik
//   'mission-failed' { title, reason } -> overlay retry
//   'game-over' { reason } / 'busted' -> overlay game over
//   'game-complete' -> overlay kemenangan
//   'save-loaded' / 'save-missing' -> respons tombol Continue
// Event bus yang di-emit:
//   'game-start' | 'game-restart' | 'game-retry' | 'mission-retry'
//   'save-request' | 'request-load' | 'audio-start' | 'toggle-mute'
//   'pause' | 'resume' | 'quit-to-menu' | 'free-roam'

function dummyBus() {
  return { on() {}, emit() {} };
}

function fmtMoney(n) {
  const v = Math.floor(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Normalisasi state.city.roads ke segmen {x1,z1,x2,z2}.
// Mendukung: {x1,z1,x2,z2}, {ax,az,bx,bz}, {from:{x,z},to:{x,z}},
// {points:[[x,z],...]} (polyline), dan {a:[x,z], b:[x,z]}.
function normalizeRoads(roads) {
  const out = [];
  if (!Array.isArray(roads)) return out;
  for (const r of roads) {
    if (!r) continue;
    if (typeof r.x1 === 'number' && typeof r.z1 === 'number'
      && typeof r.x2 === 'number' && typeof r.z2 === 'number') {
      out.push({ x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2 });
    } else if (typeof r.ax === 'number' && typeof r.az === 'number'
      && typeof r.bx === 'number' && typeof r.bz === 'number') {
      out.push({ x1: r.ax, z1: r.az, x2: r.bx, z2: r.bz });
    } else if (r.from && r.to) {
      out.push({ x1: r.from.x, z1: r.from.z, x2: r.to.x, z2: r.to.z });
    } else if (Array.isArray(r.a) && Array.isArray(r.b)) {
      out.push({ x1: r.a[0], z1: r.a[1], x2: r.b[0], z2: r.b[1] });
    } else if (Array.isArray(r.points) && r.points.length >= 2) {
      for (let i = 0; i < r.points.length - 1; i++) {
        out.push({ x1: r.points[i][0], z1: r.points[i][1], x2: r.points[i + 1][0], z2: r.points[i + 1][1] });
      }
    }
  }
  return out;
}

export function initSystem(state, scene, ctx) {
  const bus = (ctx && ctx.bus) || dummyBus();

  if (!state.flags) state.flags = {};
  if (!state.mission) state.mission = { index: 0, id: null, stage: 0, objectiveText: '', target: null, done: false };

  const rt = {
    last: {}, // cache nilai terakhir supaya DOM hanya ditulis saat berubah
    toastTimer: null,
    minimapTime: 0,
    howtoOpen: false,
    bound: false,
  };

  // -------------------------------------------------------------------------
  // Pembuatan elemen (hanya bila belum ada di index.html).
  // -------------------------------------------------------------------------
  function ensureEl(id, tag, parent, css) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement(tag || 'div');
    el.id = id;
    if (css) el.style.cssText = css;
    (parent || document.body).appendChild(el);
    return el;
  }

  function ensureStyles() {
    if (document.getElementById('solmar-hud-style')) return;
    const s = document.createElement('style');
    s.id = 'solmar-hud-style';
    s.textContent = [
      '#hud{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:system-ui,sans-serif;color:#fff;}',
      '#hud .panel{background:rgba(8,12,20,.72);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:6px 10px;}',
      '#minimap{position:absolute;top:12px;right:12px;border:2px solid rgba(255,255,255,.35);border-radius:50%;background:rgba(6,10,18,.85);}',
      '#wanted{position:absolute;top:12px;left:50%;transform:translateX(-50%);font-size:22px;letter-spacing:4px;text-shadow:0 2px 6px #000;}',
      '#objective{position:absolute;top:52px;left:12px;transform:none;max-width:46vw;font-size:14px;line-height:1.4;}',
      '#money{position:absolute;top:12px;left:12px;font-size:20px;font-weight:700;color:#7dff8a;text-shadow:0 2px 4px #000;}',
      '#health-wrap{position:absolute;right:12px;bottom:12px;width:220px;}',
      '#health-bar{height:14px;background:#222;border:1px solid #555;border-radius:7px;overflow:hidden;}',
      '#health-fill{height:100%;background:linear-gradient(90deg,#37d67a,#7dff8a);width:100%;}',
      '#armor-bar{height:8px;background:#222;border:1px solid #555;border-radius:4px;overflow:hidden;margin-top:4px;}',
      '#armor-fill{height:100%;background:#6db7ff;width:0%;}',
      '#ammo{position:absolute;right:12px;bottom:96px;font-size:16px;text-shadow:0 2px 4px #000;}',
      '#speed{position:absolute;right:12px;bottom:64px;font-size:18px;text-shadow:0 2px 4px #000;}',
      '#message{position:absolute;left:50%;bottom:18%;transform:translateX(-50%);background:rgba(8,12,20,.85);border:1px solid rgba(255,210,63,.6);border-radius:8px;padding:8px 14px;font-size:15px;display:none;max-width:80vw;text-align:center;}',
      '#crosshair{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font-size:22px;color:#fff;text-shadow:0 0 4px #000;display:none;z-index:21;pointer-events:none;}',
      '.overlay{position:fixed;inset:0;background:rgba(4,6,12,.82);display:flex;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;}',
      '.overlay .card{background:#101828;border:1px solid #ffd23f;border-radius:12px;padding:28px 32px;max-width:520px;width:90vw;text-align:center;}',
      '.overlay h1{margin:0 0 4px;font-size:34px;letter-spacing:2px;color:#ffd23f;}',
      '.overlay h2{margin:0 0 16px;font-size:15px;font-weight:400;color:#c8d0de;}',
      '.overlay button{display:block;width:100%;margin:8px 0;padding:12px;font-size:16px;border-radius:8px;border:1px solid #ffd23f;background:#1c2942;color:#fff;cursor:pointer;}',
      '.overlay button:hover{background:#2a3a5c;}',
      '.overlay button.primary{background:#ffd23f;color:#111;font-weight:700;}',
      '#howto{text-align:left;font-size:14px;line-height:1.7;color:#dbe2ee;margin:10px 0;}',
      '#howto b{color:#ffd23f;}',
      '#dialog{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);width:min(560px,90vw);background:rgba(10,14,24,.92);color:#f2f2f2;border:1px solid #ffd23f;border-radius:10px;padding:16px 18px;font-family:system-ui,sans-serif;z-index:60;display:none;cursor:pointer;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildHud() {
    if (typeof document === 'undefined') return;
    ensureStyles();
    const hud = ensureEl('hud', 'div', document.body, 'position:fixed;inset:0;pointer-events:none;z-index:20;font-family:system-ui,sans-serif;color:#fff;');
    ensureEl('money', 'div', hud, 'position:absolute;top:12px;left:12px;font-size:20px;font-weight:700;color:#7dff8a;text-shadow:0 2px 4px #000;');
    ensureEl('wanted', 'div', hud, 'position:absolute;top:12px;left:50%;transform:translateX(-50%);font-size:22px;letter-spacing:4px;text-shadow:0 2px 6px #000;');
    ensureEl('objective', 'div', hud, 'position:absolute;top:52px;left:12px;max-width:46vw;font-size:14px;line-height:1.4;background:rgba(8,12,20,.72);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:6px 10px;');
    const mm = ensureEl('minimap', 'canvas', hud, 'position:absolute;top:12px;right:12px;border:2px solid rgba(255,255,255,.35);border-radius:50%;background:rgba(6,10,18,.85);');
    if (!mm.width) mm.width = 180;
    if (!mm.height) mm.height = 180;
    mm.width = 180;
    mm.height = 180;
    const hw = ensureEl('health-wrap', 'div', hud, 'position:absolute;right:12px;bottom:12px;width:220px;');
    const hb = ensureEl('health-bar', 'div', hw, 'height:14px;background:#222;border:1px solid #555;border-radius:7px;overflow:hidden;');
    let hf = document.getElementById('health-fill');
    if (!hf) {
      hf = document.createElement('div');
      hf.id = 'health-fill';
      hf.style.cssText = 'height:100%;background:linear-gradient(90deg,#37d67a,#7dff8a);width:100%;';
      hb.appendChild(hf);
    }
    const ab = ensureEl('armor-bar', 'div', hw, 'height:8px;background:#222;border:1px solid #555;border-radius:4px;overflow:hidden;margin-top:4px;');
    let af = document.getElementById('armor-fill');
    if (!af) {
      af = document.createElement('div');
      af.id = 'armor-fill';
      af.style.cssText = 'height:100%;background:#6db7ff;width:0%;';
      ab.appendChild(af);
    }
    ensureEl('ammo', 'div', hud, 'position:absolute;right:12px;bottom:96px;font-size:16px;text-shadow:0 2px 4px #000;');
    ensureEl('speed', 'div', hud, 'position:absolute;right:12px;bottom:64px;font-size:18px;text-shadow:0 2px 4px #000;');
    ensureEl('message', 'div', hud, 'position:absolute;left:50%;bottom:18%;transform:translateX(-50%);background:rgba(8,12,20,.85);border:1px solid rgba(255,210,63,.6);border-radius:8px;padding:8px 14px;font-size:15px;display:none;max-width:80vw;text-align:center;');
    ensureEl('crosshair', 'div', document.body, 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font-size:22px;color:#fff;text-shadow:0 0 4px #000;display:none;z-index:21;pointer-events:none;');
    const ch = document.getElementById('crosshair');
    if (ch && !ch.textContent) ch.textContent = '+';
  }

  function buildMenu() {
    const menu = ensureEl('menu', 'div', document.body,
      'position:fixed;inset:0;background:rgba(4,6,12,.82);display:flex;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;');
    menu.classList.add('overlay');
    if (menu.dataset.built || menu.children.length > 0) return menu;
    menu.dataset.built = '1';
    menu.innerHTML = '<div class="card">'
      + '<h1>SOLMAR BAY</h1>'
      + '<h2>Kota fiktif di tepi teluk. Enam misi. Satu nama yang harus diingat: Raka.</h2>'
      + '<button id="btn-start" class="primary">▶ Mulai Baru</button>'
      + '<button id="btn-continue">↻ Lanjutkan</button>'
      + '<button id="btn-howto">? Cara Bermain</button>'
      + '<div id="howto">'
      + '<b>WASD / Panah</b> — jalan &amp; mengemudi<br>'
      + '<b>Mouse</b> — arahkan pandangan &amp; bidik<br>'
      + '<b>Klik kiri</b> — tembak<br>'
      + '<b>E</b> — masuk / keluar mobil, ambil barang<br>'
      + '<b>Shift</b> — lari<br>'
      + '<b>Spasi</b> — rem tangan<br>'
      + '<b>M</b> — mute / unmute suara<br>'
      + '<b>Esc</b> — jeda<br>'
      + 'Ikuti penanda <b style="color:#ffd23f">kuning</b> dan panah di minimap. '
      + 'Bintang wanted naik kalau polisi melihat aksimu — kabur ke safehouse untuk menghilang.'
      + '</div>'
      + '</div>';
    return menu;
  }

  function buildPause() {
    const pause = ensureEl('pause', 'div', document.body,
      'position:fixed;inset:0;background:rgba(4,6,12,.78);display:none;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;');
    pause.classList.add('overlay');
    if (pause.dataset.built || pause.children.length > 0) return pause;
    pause.dataset.built = '1';
    pause.innerHTML = '<div class="card">'
      + '<h1>JEDA</h1><h2>Istirahat sebentar, Raka.</h2>'
      + '<button id="btn-resume" class="primary">▶ Lanjut Main</button>'
      + '<button id="btn-save">💾 Simpan Game</button>'
      + '<button id="btn-restart">↻ Ulang dari Awal</button>'
      + '<button id="btn-quit">🏠 Kembali ke Menu</button>'
      + '</div>';
    return pause;
  }

  function buildGameOver() {
    const go = ensureEl('gameover', 'div', document.body,
      'position:fixed;inset:0;background:rgba(20,4,6,.85);display:none;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;');
    go.classList.add('overlay');
    if (go.dataset.built || go.children.length > 0) return go;
    go.dataset.built = '1';
    go.innerHTML = '<div class="card">'
      + '<h1 id="gameover-title">GAME OVER</h1><h2 id="gameover-sub">Raka tumbang di jalanan Solmar Bay.</h2>'
      + '<button id="btn-retry" class="primary">↻ Coba Lagi</button>'
      + '<button id="btn-go-menu">🏠 Kembali ke Menu</button>'
      + '</div>';
    return go;
  }

  function buildMissionFailed() {
    const mf = ensureEl('mission-failed', 'div', document.body,
      'position:fixed;inset:0;background:rgba(20,10,4,.82);display:none;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;');
    mf.classList.add('overlay');
    if (mf.dataset.built || mf.children.length > 0) return mf;
    mf.dataset.built = '1';
    mf.innerHTML = '<div class="card">'
      + '<h1>MISI GAGAL</h1><h2 id="mission-failed-reason">Waktu habis.</h2>'
      + '<button id="btn-mission-retry" class="primary">↻ Ulang Misi</button>'
      + '<button id="btn-mf-menu">🏠 Kembali ke Menu</button>'
      + '</div>';
    return mf;
  }

  function buildVictory() {
    const v = ensureEl('victory', 'div', document.body,
      'position:fixed;inset:0;background:rgba(4,16,8,.85);display:none;align-items:center;justify-content:center;z-index:50;font-family:system-ui,sans-serif;color:#fff;');
    v.classList.add('overlay');
    if (v.dataset.built || v.children.length > 0) return v;
    v.dataset.built = '1';
    v.innerHTML = '<div class="card">'
      + '<h1>🏆 SOLMAR BAY MILIKMU!</h1>'
      + '<h2 id="victory-stats">Semua 6 misi selesai. Pelabuhan direbut, kota mengenal namamu, Raka.</h2>'
      + '<button id="btn-freeroam" class="primary">▶ Lanjut Free Roam</button>'
      + '<button id="btn-victory-menu">🏠 Kembali ke Menu</button>'
      + '</div>';
    return v;
  }

  function ensureDialogEl() {
    let el = document.getElementById('dialog');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dialog';
    el.innerHTML = '<div id="dialog-who" style="color:#ffd23f;font-weight:700;margin-bottom:6px;"></div>'
      + '<div id="dialog-text" style="line-height:1.5;"></div>'
      + '<div style="text-align:right;color:#aaa;font-size:12px;margin-top:10px;">Klik / Enter untuk lanjut ▸</div>';
    document.body.appendChild(el);
    return el;
  }

  // -------------------------------------------------------------------------
  // Tampilkan / sembunyikan overlay.
  // -------------------------------------------------------------------------
  function show(el) { if (el) el.style.display = 'flex'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function showMenu() {
    const menu = buildMenu();
    show(menu);
    hide(buildPause());
    hide(buildGameOver());
    hide(buildMissionFailed());
    hide(buildVictory());
    const cont = document.getElementById('btn-continue');
    if (cont) {
      const has = ctx.save && typeof ctx.save.hasSave === 'function' ? ctx.save.hasSave() : false;
      cont.style.opacity = has ? '1' : '0.45';
      cont.title = has ? 'Lanjutkan dari save terakhir' : 'Belum ada save';
    }
  }

  function hideMenu() {
    hide(document.getElementById('menu'));
  }

  function showPause() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    bus.emit('pause', {});
    show(buildPause());
  }

  function hidePause() {
    hide(document.getElementById('pause'));
    if (state.mode === 'paused') {
      state.mode = 'playing';
      bus.emit('resume', {});
    }
  }

  function showGameOver(reason) {
    const go = buildGameOver();
    const title = document.getElementById('gameover-title');
    const sub = document.getElementById('gameover-sub');
    if (reason === 'busted') {
      if (title) title.textContent = 'TERTANGKAP!';
      if (sub) sub.textContent = 'Polisi Solmar Bay menangkap Raka. Misi bisa diulang dari checkpoint.';
    } else {
      if (title) title.textContent = 'GAME OVER';
      if (sub) sub.textContent = 'Raka tumbang di jalanan Solmar Bay.';
    }
    show(go);
  }

  function showMissionFailed(payload) {
    const mf = buildMissionFailed();
    const reason = document.getElementById('mission-failed-reason');
    if (reason) {
      reason.textContent = payload && payload.title
        ? `${payload.title} — ${payload.reason || 'gagal.'}`
        : (payload && payload.reason) || 'Misi gagal.';
    }
    show(mf);
  }

  function showVictory(payload) {
    const v = buildVictory();
    const stats = document.getElementById('victory-stats');
    if (stats && payload) {
      stats.textContent = `Semua 6 misi selesai. Uang: ${fmtMoney(payload.money)} — Misi selesai: ${payload.missionsDone}. Pelabuhan direbut, kota mengenal namamu, Raka.`;
    }
    show(v);
  }

  function showToast(text) {
    const el = document.getElementById('message');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    if (rt.toastTimer) clearTimeout(rt.toastTimer);
    rt.toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // -------------------------------------------------------------------------
  // Binding tombol & keyboard.
  // -------------------------------------------------------------------------
  function bindButtons() {
    if (rt.bound || typeof document === 'undefined') return;
    rt.bound = true;

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.id) return;
      switch (t.id) {
        case 'btn-start':
          bus.emit('audio-start', {});
          bus.emit('game-start', {});
          // Mode 'playing' diatur main.js (startGame); JANGAN set di sini,
          // supaya dialog intro M1 (mode 'dialog') tidak tertimpa.
          hideMenu();
          showToast('Selamat datang di Solmar Bay, Raka!');
          break;
        case 'btn-continue':
          bus.emit('audio-start', {});
          bus.emit('request-load', {});
          break;
        case 'btn-howto': {
          const h = document.getElementById('howto');
          if (h) {
            rt.howtoOpen = !rt.howtoOpen;
            h.style.display = rt.howtoOpen ? 'block' : 'none';
          }
          break;
        }
        case 'btn-resume':
          hidePause();
          break;
        case 'btn-save':
          bus.emit('save-request', {});
          break;
        case 'btn-restart':
          hidePause();
          // Jangan set state.mode di sini: handler 'game-restart' (missions.js)
          // mungkin membuka dialog intro (mode 'dialog') — mode diatur di sana.
          bus.emit('game-restart', {});
          break;
        case 'btn-quit':
          hidePause();
          state.mode = 'menu';
          bus.emit('quit-to-menu', {});
          showMenu();
          break;
        case 'btn-retry':
          hide(document.getElementById('gameover'));
          bus.emit('game-retry', {});
          state.mode = 'playing';
          break;
        case 'btn-go-menu':
          hide(document.getElementById('gameover'));
          state.mode = 'menu';
          bus.emit('quit-to-menu', {});
          showMenu();
          break;
        case 'btn-mission-retry':
          hide(document.getElementById('mission-failed'));
          bus.emit('mission-retry', {});
          state.mode = 'playing';
          break;
        case 'btn-mf-menu':
          hide(document.getElementById('mission-failed'));
          state.mode = 'menu';
          bus.emit('quit-to-menu', {});
          showMenu();
          break;
        case 'btn-freeroam':
          hide(document.getElementById('victory'));
          state.mode = 'playing';
          state.flags.freeRoam = true;
          bus.emit('free-roam', {});
          showToast('Free roam — nikmati Solmar Bay!');
          break;
        case 'btn-victory-menu':
          hide(document.getElementById('victory'));
          state.mode = 'menu';
          bus.emit('quit-to-menu', {});
          showMenu();
          break;
        default:
          break;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.mode === 'playing') showPause();
        else if (state.mode === 'paused') hidePause();
      } else if (e.key && (e.key === 'm' || e.key === 'M')) {
        if (ctx.audio && typeof ctx.audio.toggleMute === 'function') ctx.audio.toggleMute();
        else bus.emit('toggle-mute', {});
      }
    });
  }

  // -------------------------------------------------------------------------
  // Minimap 2D: utara di atas, zoom mengikuti player.
  // -------------------------------------------------------------------------
  function drawMinimap(now) {
    const canvas = document.getElementById('minimap');
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const W = canvas.width;
    const H = canvas.height;
    const p = state.player || { x: 0, z: 0, heading: 0 };
    const VIEW = 260; // meter yang terlihat dari ujung ke ujung
    const scale = W / VIEW;
    const toX = (x) => (x - p.x) * scale + W / 2;
    const toY = (z) => (z - p.z) * scale + H / 2;

    g.clearRect(0, 0, W, H);
    // Latar: lingkaran kota.
    g.fillStyle = 'rgba(16,24,40,0.9)';
    g.beginPath();
    g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    g.fill();
    // Jalan.
    const roads = normalizeRoads(state.city && state.city.roads);
    g.strokeStyle = 'rgba(160,170,190,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    for (const r of roads) {
      g.moveTo(toX(r.x1), toY(r.z1));
      g.lineTo(toX(r.x2), toY(r.z2));
    }
    g.stroke();
    // Kendaraan (titik putih).
    g.fillStyle = '#ffffff';
    for (const v of state.vehicles || []) {
      if (v.id === (p.vehicleId || null)) continue;
      g.fillRect(toX(v.x) - 1.5, toY(v.z) - 1.5, 3, 3);
    }
    // Polisi (titik merah berkedip).
    const blink = Math.sin(now / 180) > 0;
    g.fillStyle = blink ? '#ff4444' : '#4488ff';
    for (const c of state.police || []) {
      g.beginPath();
      g.arc(toX(c.x), toY(c.z), 3, 0, Math.PI * 2);
      g.fill();
    }
    // Target misi (titik kuning berkedip).
    const tgt = state.mission && state.mission.target;
    if (tgt && state.mode === 'playing') {
      if (Math.sin(now / 200) > -0.2) {
        g.fillStyle = '#ffd23f';
        g.beginPath();
        g.arc(toX(tgt.x), toY(tgt.z), 4.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#ffd23f';
        g.beginPath();
        g.arc(toX(tgt.x), toY(tgt.z), 7, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Player: panah kuning menghadap heading (utara = -z di atas).
    const hx = Math.sin(p.heading || 0);
    const hz = Math.cos(p.heading || 0);
    const cx = W / 2;
    const cy = H / 2;
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(cx + hx * 8, cy + hz * 8);
    g.lineTo(cx - hz * 5 - hx * 4, cy + hx * 5 - hz * 4);
    g.lineTo(cx + hz * 5 - hx * 4, cy - hx * 5 - hz * 4);
    g.closePath();
    g.fill();
    // Huruf N (utara) di atas.
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', W / 2, 13);
  }

  // -------------------------------------------------------------------------
  // Update HUD per frame. Tulis DOM hanya saat nilai berubah.
  // -------------------------------------------------------------------------
  function setText(id, value) {
    if (rt.last[id] === value) return;
    rt.last[id] = value;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function update(dt) {
    if (typeof document === 'undefined') return;
    rt.minimapTime += dt * 1000;

    const mode = state.mode || 'menu';
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = (mode === 'menu') ? 'none' : 'block';

    // Uang.
    setText('money', fmtMoney(state.money));

    // Wanted: bintang 0-5, warna naik seiring level.
    const w = clamp(Math.round(state.wanted || 0), 0, 5);
    const stars = '★'.repeat(w) + '☆'.repeat(5 - w);
    setText('wanted', stars);
    const wEl = document.getElementById('wanted');
    if (wEl) {
      wEl.style.color = w >= 4 ? '#ff4444' : w >= 2 ? '#ff9933' : w >= 1 ? '#ffd23f' : 'rgba(255,255,255,0.45)';
    }

    // Objektif + jarak ke target.
    let obj = '';
    if (state.mission && state.mission.objectiveText) {
      obj = state.mission.objectiveText;
      const tgt = state.mission.target;
      const p = state.player;
      if (tgt && p && mode === 'playing') {
        const d = Math.round(Math.hypot(p.x - tgt.x, p.z - tgt.z));
        obj += `  ·  ${d} m`;
      }
    }
    setText('objective', obj);
    const objEl = document.getElementById('objective');
    if (objEl) objEl.style.display = obj ? 'block' : 'none';

    // Health & armor bar.
    const hp = clamp(Math.round(state.health || 0), 0, 100);
    const hf = document.getElementById('health-fill');
    if (hf && rt.last.hp !== hp) {
      rt.last.hp = hp;
      hf.style.width = hp + '%';
      hf.style.background = hp > 50
        ? 'linear-gradient(90deg,#37d67a,#7dff8a)'
        : hp > 25 ? 'linear-gradient(90deg,#e0a53a,#ffd23f)' : 'linear-gradient(90deg,#d63a3a,#ff6b6b)';
    }
    const ar = clamp(Math.round(state.armor || 0), 0, 100);
    const af = document.getElementById('armor-fill');
    if (af && rt.last.ar !== ar) {
      rt.last.ar = ar;
      af.style.width = ar + '%';
    }

    // Ammo & kecepatan.
    const p = state.player || {};
    let ammoText = '';
    if (p.weapon && p.weapon !== 'fists' && p.weapon !== 'tangan kosong') {
      ammoText = `🔫 ${p.weapon}  ·  ${p.ammo === Infinity ? '∞' : (p.ammo ?? 0)} peluru`;
    } else if (p.weapon) {
      ammoText = '👊 tangan kosong';
    }
    setText('ammo', ammoText);
    const speedKmh = Math.round(Math.abs(p.speed || 0) * 3.6);
    setText('speed', p.onFoot ? '' : `${speedKmh} km/jam`);

    // Crosshair: hanya saat bermain dan memegang senjata api.
    const ch = document.getElementById('crosshair');
    if (ch) {
      const armed = mode === 'playing' && p.weapon && p.weapon !== 'fists' && p.weapon !== 'tangan kosong';
      ch.style.display = armed ? 'block' : 'none';
    }

    // Minimap (digambar tiap frame; murah di 180x180).
    if (mode !== 'menu') drawMinimap(rt.minimapTime);

    // Game over otomatis bila health habis saat bermain ('dead' adalah mode
    // yang dikenal main.js; overlay ditampilkan lewat watcher mode di sana).
    if (mode === 'playing' && (state.health || 0) <= 0) {
      state.mode = 'dead';
      bus.emit('game-over', { reason: 'health' });
      showGameOver('health');
    }
  }

  // -------------------------------------------------------------------------
  // Event bus.
  // -------------------------------------------------------------------------
  bus.on('toast', (payload) => { if (payload && payload.text) showToast(payload.text); });
  bus.on('message', (payload) => { if (payload && payload.text) showToast(payload.text); });
  bus.on('mission-failed', (payload) => showMissionFailed(payload));
  bus.on('game-over', (payload) => showGameOver(payload && payload.reason));
  bus.on('busted', () => showGameOver('busted'));
  bus.on('game-complete', (payload) => showVictory(payload));
  bus.on('save-loaded', () => {
    hideMenu();
    state.mode = 'playing';
    showToast('Save dimuat. Selamat datang kembali, Raka!');
  });
  bus.on('save-missing', () => showToast('Belum ada save. Mulai game baru dulu.'));
  bus.on('game-restart', () => {
    hide(document.getElementById('gameover'));
    hide(document.getElementById('mission-failed'));
    hideMenu();
    state.mode = 'playing';
  });

  // Bangun semua elemen & binding sekali.
  if (typeof document !== 'undefined') {
    buildHud();
    buildMenu();
    buildPause();
    buildGameOver();
    buildMissionFailed();
    buildVictory();
    ensureDialogEl();
    bindButtons();
    if ((state.mode || 'menu') === 'menu') showMenu();
    else hideMenu();
  }

  if (ctx && typeof ctx.registerUpdate === 'function') {
    try { ctx.registerUpdate(update); } catch { /* abaikan */ }
  }

  return {
    update,
    showToast,
    showMenu,
    hideMenu,
    showPause,
    hidePause,
    showGameOver,
    showMissionFailed,
    showVictory,
  };
}

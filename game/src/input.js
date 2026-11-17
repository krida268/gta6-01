// input.js — Keyboard + mouse untuk SOLMAR BAY.
// WASD / panah gerak, Shift lari, E masuk/keluar mobil, F atau klik kiri
// tembak, R reload, M mute, Esc pause, Space rem tangan / aksi.
// Mouse drag mengorbit kamera, wheel zoom. Dipanggil sekali per frame
// lewat input.update() supaya state "pressed" (sekali tekan) bersih.

export const input = {
  keys: new Set(), // kode tombol yang sedang ditekan (e.code)
  _pressed: new Set(), // kode yang ditekan sejak update() terakhir
  mouse: {
    dx: 0, // akumulasi gerakan drag sejak update() terakhir
    dy: 0,
    clicked: false, // klik kiri sejak update() terakhir
    down: false,
    wheel: 0, // akumulasi delta wheel sejak update() terakhir
  },
  _dragging: false,
  _lastX: 0,
  _lastY: 0,

  // True bila tombol ditekan sejak update() terakhir (sekali tekan).
  pressed(code) {
    return this._pressed.has(code);
  },

  // True bila tombol sedang ditahan.
  held(code) {
    return this.keys.has(code);
  },

  // Arah gerak gabungan dari WASD/panah: { x: -1..1 (kanan), z: -1..1 (maju) }.
  // z = -1 berarti maju (W / ArrowUp).
  moveAxis() {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    return { x, z };
  },

  // Bersihkan state sekali-tekan; dipanggil di akhir tiap frame.
  update() {
    this._pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.clicked = false;
    this.mouse.wheel = 0;
  },

  // Lepas semua tombol (misal saat blur / pause).
  clearAll() {
    this.keys.clear();
    this._pressed.clear();
    this.mouse.down = false;
    this._dragging = false;
  },
};

let _listenersAttached = false;

export function attachInput(canvas) {
  if (_listenersAttached) return;
  _listenersAttached = true;

  window.addEventListener('keydown', (e) => {
    // Jangan dobel catat saat tombol ditahan (key repeat).
    if (!e.repeat) {
      input._pressed.add(e.code);
      input.keys.add(e.code);
    }
    // Cegah scroll halaman oleh panah / spasi saat bermain.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });
  window.addEventListener('blur', () => input.clearAll());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.clearAll();
  });

  const el = canvas || document.getElementById('game') || window;
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      input.mouse.down = true;
      input.mouse.clicked = true;
      input._dragging = true;
      input._lastX = e.clientX;
      input._lastY = e.clientY;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      input.mouse.down = false;
      input._dragging = false;
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (input._dragging) {
      input.mouse.dx += e.clientX - input._lastX;
      input.mouse.dy += e.clientY - input._lastY;
      input._lastX = e.clientX;
      input._lastY = e.clientY;
    }
  });
  el.addEventListener('wheel', (e) => {
    input.mouse.wheel += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  // Jangan biarkan menu konteks muncul saat klik kanan di canvas.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export default input;

// Solmar Bay — entry gta6-01 ("Make GTA 6") untuk make.fun.
//
// Game ini adalah open-world crime original yang dimainkan langsung di browser
// desktop tanpa koneksi internet: game/index.html beserta modul-modulnya adalah
// file statis biasa, dan program ini bertugas menyerahkannya ke penilai.
// Tugasnya tiga langkah: (1) memeriksa isi entry sudah lengkap, (2) menyalin
// game/ dan screenshots/ dari samping file ini ke direktori keluaran, dan
// (3) menulis dossier.json, ringkasan entry yang dibaca juri, memakai
// pustaka make.fun yang sudah di-vendor di ./vendor/makefun-game.ts.
//
// Direktori keluaran dibaca dari MAKEFUN_OUTPUT_DIR; kalau variabel itu tidak
// ada, dipakai /output, seperti yang dilakukan penilai di dalam container.
// Di luar container, jalankan misalnya:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// lalu buka gamenya sendiri dengan `node serve.ts` di http://localhost:8080.
//
// Hanya memakai standard library Node (node:fs, node:path, node:url) dan
// file TypeScript ini bisa dihapus tipenya begitu saja (erasable TypeScript),
// jadi `node main.ts` langsung jalan tanpa build dan tanpa install.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

// ---- Validasi ringan sebelum menyalin apa pun ---------------------------
// Kalau salah satu syarat ini tidak terpenuhi, lebih baik gagal sekarang
// dengan pesan yang jelas daripada menyerahkan entry yang tidak lengkap.

if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('game/index.html tidak ditemukan: entry butuh halaman utama game di game/');
}
if (!statSync(join(gameDir, 'index.html')).isFile()) {
  throw new Error('game/index.html bukan file biasa: entry butuh halaman utama game di game/');
}

if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
  throw new Error('screenshots/ tidak ditemukan: entry butuh 3 atau 4 tangkapan layar game');
}
const shots = readdirSync(shotsDir).filter((name) => !name.startsWith('.'));
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`screenshots/ berisi ${shots.length} file, entry butuh 3 atau 4 tangkapan layar`);
}

// ---- Menyalin game dan tangkapan layar ke direktori keluaran ------------

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// ---- Menulis dossier.json ------------------------------------------------
// Batas-batas ini diambil dari gate bounty (reference/gate.json): hanya
// text_max_bytes yang membentuk isi dossier; batas lainnya menolak entry
// yang memang akan ditolak penilai (lebih dari 4 screenshot atau satu
// screenshot di atas 256 KiB; lebih dari 993 file di game/ atau total di
// atas 48 MiB, atau ada path di game/ yang lebih dari 1000 byte — game/
// dihitung bersama batas 1000 entri /output milik penilai, bersama
// screenshots/ dan dossier.json itu sendiri).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

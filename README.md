# SOLMAR BAY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/krida268/gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/krida268/gta6-01/reward.svg)](https://make.fun/c/gta6-01)

Game open-world crime 3D yang dimainkan langsung di browser — tanpa install,
tanpa koneksi internet. Kamu Raka, pendatang baru di kota pantai fiktif
**Solmar Bay**. Curi mobil, kabur dari polisi, dan selesaikan 6 misi untuk
menguasai kota.

Dibuat untuk bounty make.fun **gta6-01 ("Make GTA 6")**:
https://make.fun/c/gta6-01 — masuk lewat referral:
https://make.fun/r/enzt809f

## Fitur

- **Kota Solmar Bay** — grid jalan 9×9 blok dengan gedung prosedural warna-warni,
  taman pusat + air mancur, pantai berpasir + laut di selatan, dermaga dan
  mercusuar, lampu jalan, pohon palem, dan tempat parkir. Semua aset dibuat
  dari geometri dasar three.js, tanpa file eksternal.
- **Mobil** — sedan, taksi, truk, dan sport; masuk/keluar mobil, mengemudi
  dengan gas/rem/rem tangan, tabrakan gedung dan antar-mobil, kerusakan + asap.
- **Traffic & pejalan kaki** — ~14 mobil lalu-lintas mengikuti jalan, berhenti
  di persimpangan, menghindar; ~24 pejalan kaki berjalan di trotoar dan lari
  saat ada tembakan.
- **Polisi & wanted 0–5 bintang** — curi mobil, tabrak pejalan kaki, atau
  tembak dan panasmu naik. Polisi jalan kaki mengejar dan menangkapmu, mobil
  patroli mengejar dan menabrak mobilmu, roadblock dan tembakan polisi di
  level 3+. Bersembunyi untuk mendinginkan wanted.
- **6 misi cerita** — M1 Kenalan Kota, M2 Mobil Pertama, M3 Antar Paket
  (timer 90 detik), M4 Tagih Utang (kejar-kejaran mobil), M5 Perampokan Mini
  (kabur ke safehouse), M6 Final: Rebut Pelabuhan (kalahkan 4 penjaga, ambil
  koper). Dialog cerita, penanda beam kuning, dan hadiah uang tiap misi.
- **Combat** — tinju jarak dekat dan pistol (isi ulang, crosshair, partikel
  darah, polisi bisa ditembak jatuh).
- **HUD & minimap** — uang, nyawa + armor, bintang wanted, objektif + jarak
  ke target, kecepatan, amunisi, pesan/toast, dan minimap lingkaran dengan
  jalan, kendaraan, polisi, dan target misi.
- **Save** — progress (uang, nyawa, misi, statistik, posisi) tersimpan di
  localStorage; tombol Lanjutkan di menu utama dan Simpan di menu jeda.
- **Audio** — semua suara sintetis WebAudio: musik synthwave, mesin mobil,
  sirene, tembakan, tabrakan. M = bisu.

## Cara main

| Kontrol | Aksi |
| --- | --- |
| WASD / panah | Jalan / mengemudi |
| Shift | Lari |
| E | Masuk / keluar mobil |
| F atau klik kiri | Tembak / pukul |
| 1 / 2 | Ganti senjata (tinju / pistol) |
| R | Isi ulang peluru |
| Space | Rem tangan |
| Seret mouse | Putar kamera |
| Roda mouse | Zoom kamera |
| Esc | Jeda / lanjut |
| M | Bisu |
| Enter | Lanjut dialog / main lagi |

Ikuti penanda kuning (beam cahaya + panah di minimap). Semakin banyak bintang
buronan, semakin agresif polisi Solmar Bay mengejarmu — kabur ke safehouse
untuk menghilangkan jejak.

## Cara jalanin

Butuh Node.js (v22). Dari folder repo ini:

```bash
node serve.ts
```

Lalu buka http://localhost:8080 di browser desktop. Tidak ada build step
dan tidak ada dependensi: `game/` hanya file statis (HTML + modul JS +
three.js yang di-vendor).

## Struktur

```text
game/
  index.html            halaman utama + HUD + menu
  src/
    main.js             bootstrap, loop, registry sistem
    state.js            state bersama + event bus
    input.js            keyboard + mouse
    city.js             kota Solmar Bay (prosedural)
    player.js           jalan kaki + kamera third-person
    vehicles.js         mobil + mengemudi
    traffic.js          lalu-lintas AI
    pedestrians.js      pejalan kaki
    police.js           wanted + AI polisi
    combat.js           tinju + pistol
    missions.js         rantai 6 misi + dialog + marker
    hud.js              HUD, minimap, menu, pause
    audio.js            SFX + musik (WebAudio murni)
    save.js             save/load localStorage
  vendor/
    three.module.min.js three.js (di-vendor, tanpa CDN)
screenshots/            4 tangkapan layar gameplay (1280x720)
main.ts                 entry make.fun: validasi + dossier.json
serve.ts                server statis lokal (pengembangan)
```

## Credit

Game orisinal karya Alxxprm untuk bounty make.fun gta6-01. Kota, tokoh
(Raka, Mira, Dito, Seno), dan cerita Solmar Bay adalah fiktif — dibuat dari
nol, bukan tiruan aset atau kode game lain. three.js dipakai di bawah
lisensinya (lihat `LICENSE`). Referral: https://make.fun/r/enzt809f

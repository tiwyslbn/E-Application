# Memasang Medan Smart Tourism sebagai aplikasi

Aplikasi ini adalah **PWA** (Progressive Web App): satu kode yang bisa dipasang di laptop (Windows, macOS, Linux) dan HP (Android, iPhone) dengan ikon sendiri, tampil tanpa bilah alamat, dan membuka e-tiket tanpa sinyal.

## Syarat penting
Browser hanya menawarkan "pasang" jika aplikasi dibuka lewat **HTTPS** atau **localhost**.

| Perangkat | Cara membuka | Bisa dipasang? |
|---|---|---|
| Laptop yang menjalankan server | `http://localhost:3000` | Ya, langsung |
| HP / laptop lain via Wi-Fi (`http://192.168.x.x:3000`) | HTTP biasa | **Tidak** (bukan HTTPS) |
| HP / laptop mana pun via alamat HTTPS | `https://...` | Ya |

## Cara 1 - Laptop (paling cepat)
1. `npm install` lalu `npm start`
2. Buka `http://localhost:3000` di **Chrome atau Edge**
3. Klik tombol **Pasang aplikasi** (di menu akun / bagian bawah beranda) atau ikon pasang di ujung kanan bilah alamat
4. Aplikasi terbuka di jendela sendiri dan muncul di menu Start / Launchpad

## Cara 2 - HP, untuk uji coba (tanpa hosting)
Jalankan server di laptop, lalu buat alamat HTTPS sementara:
```bash
npm start
# terminal lain, salah satu:
cloudflared tunnel --url http://localhost:3000
ngrok http 3000
```
Buka alamat `https://...` yang ditampilkan di HP, lalu pasang (lihat bawah). Alamat berubah setiap sesi dan hanya aktif selama laptop menyala.

## Cara 3 - Dipakai sungguhan (hosting)
Taruh di server dengan HTTPS (Render, Railway, Fly.io, atau VPS dengan Caddy/Nginx). Pengaturan:
- `NODE_ENV=production`, supaya cookie sesi berstatus secure di balik proxy HTTPS
- `SESSION_SECRET=<teks acak panjang>`
- Node.js 22 atau lebih baru, perintah start `npm start`
- Database SQLite (`database/smarttour.db`) harus berada di **disk persisten**. Atur lokasinya dengan `DB_FILE=/path/ke/disk/smarttour.db`. Tanpa disk persisten, data hilang setiap deploy.
- Ganti password akun demo.

## Memasang di HP
- **Android (Chrome):** buka alamat HTTPS, ketuk **Pasang aplikasi** (atau menu ⋮ → *Instal aplikasi*).
- **iPhone/iPad (Safari):** ketuk **Bagikan** → **Tambah ke Layar Utama**. (Safari tidak punya tombol pasang otomatis; aplikasi menampilkan petunjuknya.)

## Perilaku offline
- Halaman biasa butuh internet. Tanpa sinyal akan tampil halaman "Anda sedang offline".
- **E-tiket yang pernah dibuka** dan daftar **Tiket Saya** tetap bisa dibuka tanpa sinyal, termasuk QR-nya, jadi berguna di lokasi wisata yang sinyalnya lemah.
- Saat **Keluar** (logout), salinan e-tiket di perangkat ikut dihapus.
- Pemesanan, pembayaran, scan petugas, dan admin tetap butuh koneksi.

## Memperbarui aplikasi
Aplikasi terpasang memperbarui diri saat dibuka dengan koneksi. Jika mengubah daftar berkas di `public/sw.js`, naikkan nilai `V` (mis. `v4`) agar cache lama dibuang. Jika mengubah nama cache, ubah juga `PAGES_CACHE` di `public/js/main.js`.

## Berkas PWA
`public/manifest.json` (identitas, ikon, pintasan, screenshot) · `public/sw.js` (cache & offline) · `public/offline.html` · `public/js/main.js` (tombol pasang) · `public/img/` (ikon biasa, maskable, apple-touch, screenshot).

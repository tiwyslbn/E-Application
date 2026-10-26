# Medan Smart Tourism — E-Ticketing & E-Queue Wisata Kota Medan

Project UTS Mata Kuliah E-Application · D3 Teknik Informatika, Fakultas Vokasi USU.

Aplikasi web (PWA, bisa dipasang di laptop dan HP, lihat [PANDUAN-PWA.md](PANDUAN-PWA.md)) untuk memesan e-tiket destinasi wisata Kota Medan, membayar secara elektronik (simulasi
payment gateway), mendapatkan nomor antrian digital, dan check-in dengan memindai QR Code oleh petugas.

## Fitur
- Login multi-role: **Admin**, **Petugas**, **Pengunjung (User)** + registrasi pengunjung
- Daftar wisata (harga dewasa/anak, jam buka, sisa kuota) dengan pencarian & filter kategori
- Pemesanan tiket (tanggal, sesi, jumlah) dengan validasi kuota & aturan bisnis
- Pembayaran elektronik simulasi (QRIS, Virtual Account BCA/BRI, GoPay, OVO, DANA) + batas waktu 30 menit
- E-tiket ber-QR Code (dapat dicetak) dan **e-queue** (nomor antrian per destinasi/hari, status real-time)
- Petugas: scan QR (kamera / input manual), kelola antrian (panggil/lewati), dashboard loket
- Admin: CRUD destinasi & pengguna, data transaksi, dashboard kunjungan harian/mingguan (Chart.js), laporan + ekspor CSV
- Tampilan baru bertema Melayu Deli (motif pucuk rebung), navigasi tab bawah di HP, e-tiket dapat dibuka offline
- Beranda dengan slideshow destinasi (foto asli), mode terang/gelap, tampilan admin/petugas dengan sidebar
- Admin dan petugas dapat mengelola status pesanan (lunas, batal, aktifkan kembali, check-in manual) dengan riwayat perubahan; petugas punya halaman Pesanan loket
- Admin dapat menjadwal ulang pesanan (tanggal/sesi, kuota diperiksa, nomor antrian dibuat ulang bila perlu)
- Admin dapat mengunggah foto destinasi (JPG, maks 4 MB) dari menu Ubah
- Halaman Akun saya: ubah nama/HP dan ganti password (semua peran); kamera scan petugas dapat dinyalakan dan dimatikan
- Keamanan: password bcrypt, sesi, proteksi CSRF, escape output (anti-XSS), pembatasan percobaan login

## Teknologi
Node.js v22 atau lebih baru (dibutuhkan better-sqlite3 v13) · Express · EJS · SQLite (better-sqlite3) · Bootstrap 5 · Chart.js · qrcode · html5-qrcode

## Menjalankan
```bash
npm install
npm start            # http://localhost:3000
```
Berkas `.npmrc` (ignore-scripts) memastikan npm memakai binary SQLite bawaan tanpa kompilasi ulang. Database `database/smarttour.db` dibuat otomatis beserta data contoh saat pertama kali dijalankan (berkasnya tidak disertakan di repositori).
Reset data: `npm run seed`. Pengujian black box otomatis: `npm test` (memakai database sementara).

## Akun uji
Hanya tiga akun, masing-masing satu peran. Akun ini tidak ditampilkan di halaman login. Hapus bagian ini jika repositori dipublikasikan.
| Akun | Peran | Email | Password |
|---|---|---|---|
| Tiwy as Admin | Admin | admin@smarttour.id | admin123 |
| Tiwy as Petugas | Petugas | petugas@smarttour.id | petugas123 |
| Tiwy as Pengunjung | Pengunjung | pengunjung@smarttour.id | pengunjung123 |

Data awal sengaja ringkas: 6 destinasi (Istana Maimun, Masjid Raya Al-Mashun, Museum Negeri Sumut, Tjong A Fie Mansion, Rahmat Wildlife Museum, Tur Danau Toba) dan 18 pesanan contoh milik akun pengunjung. Dua tiket hari ini masih valid (untuk dicoba scan dan antrian), dua tiket untuk besok dan lusa (scan akan ditolak karena bukan hari ini). Tanggal data dihitung dari hari saat database dibuat, jadi jalankan `npm run seed` agar tiket "hari ini" kembali segar.

> Ganti password akun uji dan variabel `SESSION_SECRET` sebelum dipakai di luar keperluan demo.

## Catatan
- Harga, kuota, dan riwayat transaksi pada data contoh bersifat **simulasi** untuk keperluan demo.
- Pembayaran adalah **simulasi sandbox internal**, bukan integrasi payment gateway sungguhan.
- Kamera pada halaman scan memerlukan `localhost` atau HTTPS; input kode manual tersedia sebagai alternatif.
- `database/schema_mysql.sql` adalah skema setara untuk MySQL (belum diuji).

## Struktur
```
server.js            titik masuk aplikasi
db.js                koneksi SQLite, skema, data contoh
lib/                 util, middleware (auth/CSRF), logika bisnis (booking.js)
routes/              public, auth, user, staff, admin
views/               template EJS
public/              CSS, font, ikon, manifest PWA, service worker, halaman offline
database/            schema.sql, schema_mysql.sql
tests/blackbox.js    pengujian black box otomatis
docs/                diagram & screenshot untuk laporan
```

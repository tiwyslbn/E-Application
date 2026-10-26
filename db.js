process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const U = require('./lib/util');

const FILE = process.env.DB_FILE || path.join(__dirname, 'database', 'smarttour.db');
if (process.argv.includes('--reset') && fs.existsSync(FILE)) {
  for (const f of [FILE, FILE + '-wal', FILE + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = new Database(FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8'));

// ---------- DATA AWAL (SEED) ----------
// Data sengaja dibuat ringkas: 3 akun uji (satu per peran), 6 destinasi, dan sedikit riwayat transaksi.
function seed() {
  const now = U.nowStr();
  const insUser = db.prepare('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)');
  const users = [
    ['Tiwy as Admin', 'admin@smarttour.id', '081200000001', 'admin123', 'admin'],
    ['Tiwy as Petugas', 'petugas@smarttour.id', '081200000002', 'petugas123', 'petugas'],
    ['Tiwy as Pengunjung', 'pengunjung@smarttour.id', '081200000003', 'pengunjung123', 'user'],
  ];
  for (const u of users) insUser.run(u[0], u[1], u[2], bcrypt.hashSync(u[3], 10), u[4], now);

  // Data destinasi bersifat simulasi (harga & kuota dummy untuk keperluan demo).
  const insDest = db.prepare(`INSERT INTO destinations
    (code,name,category,description,address,open_time,close_time,slot_hours,price_adult,price_child,daily_quota,icon,color,is_active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const dests = [
    ['IM', 'Istana Maimun', 'Budaya & Sejarah',
      'Istana peninggalan Kesultanan Deli yang dibangun pada akhir abad ke-19. Arsitekturnya memadukan unsur Melayu, Islam, dan Eropa, dengan ruang singgasana serta koleksi foto dan benda bersejarah.',
      'Jl. Brigjend Katamso, Medan Maimun, Kota Medan', '08:00', '17:00', 2, 10000, 5000, 400, 'bi-bank2', '#c98a00'],
    ['MR', 'Masjid Raya Al-Mashun', 'Religi & Arsitektur',
      'Masjid bersejarah yang dibangun pada awal abad ke-20 oleh Sultan Deli. Kubah dan interiornya menampilkan perpaduan arsitektur Timur Tengah, India, dan Eropa. Pengunjung wajib berpakaian sopan.',
      'Jl. Sisingamangaraja No. 61, Medan Kota, Kota Medan', '08:00', '18:00', 2, 5000, 2500, 500, 'bi-moon-stars-fill', '#0f5c4d'],
    ['MN', 'Museum Negeri Sumatera Utara', 'Museum & Edukasi',
      'Museum yang menyimpan koleksi etnografi, sejarah, dan budaya berbagai suku di Sumatera Utara. Cocok untuk kunjungan keluarga dan study tour pelajar.',
      'Jl. H.M. Joni No. 51, Medan Amplas, Kota Medan', '08:00', '16:00', 2, 5000, 3000, 300, 'bi-archive-fill', '#7a4e2d'],
    ['TF', 'Tjong A Fie Mansion', 'Budaya & Sejarah',
      'Rumah kediaman saudagar Tionghoa Tjong A Fie di kawasan Kesawan dengan perpaduan arsitektur Tiongkok, Melayu, dan Eropa. Tersedia pemandu untuk menjelaskan sejarah rumah.',
      'Jl. Jend. Ahmad Yani No. 105, Kesawan, Kota Medan', '09:00', '17:00', 2, 35000, 20000, 200, 'bi-house-heart-fill', '#a3262a'],
    ['RW', 'Rahmat International Wildlife Museum', 'Museum & Edukasi',
      'Museum satwa dengan ribuan koleksi hewan awetan dari berbagai belahan dunia, dilengkapi galeri seni dan koleksi batu alam.',
      'Jl. S. Parman, Medan Petisah, Kota Medan', '09:00', '17:00', 2, 50000, 30000, 250, 'bi-feather', '#3f6f2a'],
    ['DT', 'Paket Tour Danau Toba (Sehari dari Medan)', 'Wisata Alam & Tour',
      'Paket tur sehari ke kawasan Danau Toba dengan keberangkatan dari titik kumpul di Medan. Termasuk transportasi, pemandu, dan waktu bebas menikmati panorama danau. Pilih sesi keberangkatan pagi atau siang.',
      'Titik kumpul: Jl. Imam Bonjol, Medan Polonia, Kota Medan', '06:00', '18:00', 6, 350000, 250000, 60, 'bi-water', '#1d6fa5'],
  ];
  for (const d of dests) insDest.run(...d, now);

  seedHistory();
}

// Riwayat singkat agar dashboard, laporan, antrian, dan scan langsung bisa dicoba.
// Semua pesanan milik akun "Tiwy as Pengunjung". Tanggal dihitung relatif terhadap hari ini.
// Format: [selisih hari kunjungan, kode destinasi, dewasa, anak, status]
//   paid  = lunas (sudah lewat -> sudah check-in; hari ini/besok -> tiket belum dipakai)
function seedHistory() {
  const rows = [
    [-26, 'IM', 2, 1, 'paid'], [-22, 'MR', 2, 0, 'paid'], [-19, 'MN', 1, 0, 'paid'], [-15, 'IM', 3, 1, 'paid'],
    [-12, 'DT', 2, 1, 'paid'], [-10, 'MR', 2, 0, 'cancelled'], [-9, 'RW', 2, 1, 'paid'], [-7, 'IM', 2, 0, 'paid'],
    [-6, 'IM', 1, 0, 'expired'], [-5, 'TF', 2, 1, 'paid'], [-4, 'MR', 1, 0, 'paid'], [-3, 'IM', 2, 2, 'paid'],
    [-2, 'DT', 2, 0, 'paid'], [-1, 'TF', 2, 0, 'paid'],
    [0, 'IM', 2, 1, 'paid'], [0, 'MR', 2, 0, 'paid'],   // hari ini: tiket valid untuk dicoba scan & antrian
    [1, 'TF', 2, 1, 'paid'], [2, 'MN', 2, 0, 'paid'],   // mendatang: scan akan ditolak (bukan hari ini)
  ];
  const destByCode = Object.fromEntries(db.prepare('SELECT * FROM destinations').all().map((d) => [d.code, d]));
  const visitorId = db.prepare("SELECT id FROM users WHERE role='user' ORDER BY id LIMIT 1").get().id;
  const staffId = db.prepare("SELECT id FROM users WHERE role='petugas' ORDER BY id LIMIT 1").get().id;
  const methods = ['QRIS', 'Virtual Account BCA', 'GoPay', 'DANA'];
  const today = U.todayStr();

  const insB = db.prepare(`INSERT INTO bookings (code,user_id,destination_id,visit_date,visit_slot,qty_adult,qty_child,total,status,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insP = db.prepare('INSERT INTO payments (booking_id,method,amount,reference,status,paid_at,created_at) VALUES (?,?,?,?,?,?,?)');
  const insT = db.prepare('INSERT INTO tickets (booking_id,ticket_code,status,checkin_at,checked_by,created_at) VALUES (?,?,?,?,?,?)');
  const insQ = db.prepare('INSERT INTO queues (booking_id,destination_id,queue_date,queue_number,status,called_at) VALUES (?,?,?,?,?,?)');
  const qNum = {};

  db.transaction(() => {
    rows.forEach(([off, code, adult, child, status], i) => {
      const d = destByCode[code];
      const date = U.dateOffset(off);
      const slot = U.slots(d.open_time, d.close_time, d.slot_hours)[0];
      const total = adult * d.price_adult + child * d.price_child;
      const createdAt = `${U.dateOffset(Math.min(off, 0) - 1)} ${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00`;
      const bcode = 'MST-' + date.slice(2).replace(/-/g, '') + '-' + U.randCode(4);
      const b = insB.run(bcode, visitorId, d.id, date, slot, adult, child, total, status, createdAt, createdAt);
      if (status !== 'paid') return;
      const bid = b.lastInsertRowid;
      insP.run(bid, methods[i % methods.length], total, 'PAY-' + U.randCode(10), 'success', createdAt, createdAt);
      const used = date < today;
      const checkin = used ? `${date} ${slot.slice(0, 2)}:15:00` : null;
      insT.run(bid, 'TKT-' + U.randCode(10), used ? 'used' : 'valid', checkin, used ? staffId : null, createdAt);
      const key = d.id + '|' + date;
      qNum[key] = (qNum[key] || 0) + 1;
      insQ.run(bid, d.id, date, qNum[key], used ? 'done' : 'waiting', null);
    });
  })();
}

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) seed();
if (require.main === module) console.log('Database siap:', FILE);

module.exports = db;

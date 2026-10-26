const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const U = require('../lib/util');
const B = require('../lib/booking');
const { requireRole } = require('../lib/middleware');

router.use(requireRole('admin'));

// ---------- DASHBOARD ----------
router.get('/', (req, res) => {
  const today = U.todayStr();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const cards = {
    pendapatanHariIni: one("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE status='success' AND substr(paid_at,1,10)=?", today).c,
    pendapatanBulanIni: one("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE status='success' AND substr(paid_at,1,7)=?", today.slice(0, 7)).c,
    tiketHariIni: one("SELECT COALESCE(SUM(qty_adult+qty_child),0) c FROM bookings WHERE status='paid' AND visit_date=?", today).c,
    checkinHariIni: one(`SELECT COALESCE(SUM(b.qty_adult+b.qty_child),0) c FROM tickets t JOIN bookings b ON b.id=t.booking_id
      WHERE t.status='used' AND b.visit_date=?`, today).c,
    wisatawan: one("SELECT COUNT(*) c FROM users WHERE role='user'").c,
    menunggu: one("SELECT COUNT(*) c FROM bookings WHERE status='pending'").c,
  };

  // Harian: 7 hari terakhir
  const harian = { labels: [], terjual: [], hadir: [] };
  for (let i = 6; i >= 0; i--) {
    const d = U.dateOffset(-i);
    harian.labels.push(U.tanggalPendek(d).replace(/ \d{4}$/, ''));
    harian.terjual.push(one("SELECT COALESCE(SUM(qty_adult+qty_child),0) c FROM bookings WHERE status='paid' AND visit_date=?", d).c);
    harian.hadir.push(one(`SELECT COALESCE(SUM(b.qty_adult+b.qty_child),0) c FROM tickets t JOIN bookings b ON b.id=t.booking_id
      WHERE t.status='used' AND b.visit_date=?`, d).c);
  }
  // Mingguan: 4 minggu terakhir (blok 7 hari)
  const mingguan = { labels: [], pengunjung: [], pendapatan: [] };
  for (let w = 3; w >= 0; w--) {
    const from = U.dateOffset(-(w * 7 + 6)), to = U.dateOffset(-(w * 7));
    mingguan.labels.push(w === 0 ? 'Minggu ini' : `${w} mgg lalu`);
    mingguan.pengunjung.push(one("SELECT COALESCE(SUM(qty_adult+qty_child),0) c FROM bookings WHERE status='paid' AND visit_date BETWEEN ? AND ?", from, to).c);
    mingguan.pendapatan.push(one("SELECT COALESCE(SUM(total),0) c FROM bookings WHERE status='paid' AND visit_date BETWEEN ? AND ?", from, to).c);
  }
  const perDest = db.prepare(`SELECT d.code, d.icon, d.color, d.name, COALESCE(SUM(b.qty_adult+b.qty_child),0) n FROM destinations d
    LEFT JOIN bookings b ON b.destination_id=d.id AND b.status='paid' AND b.visit_date BETWEEN ? AND ?
    GROUP BY d.id ORDER BY n DESC`).all(U.dateOffset(-29), today);
  const recent = db.prepare(`SELECT b.code,b.total,b.status,b.created_at,d.name dest_name,u.name visitor
    FROM bookings b JOIN destinations d ON d.id=b.destination_id JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT 8`).all();
  res.render('admin/dashboard', { title: 'Dashboard Admin', cards, harian, mingguan, perDest, recent, today });
});

// ---------- CRUD DESTINASI ----------
const ICONS = ['bi-bank2', 'bi-moon-stars-fill', 'bi-archive-fill', 'bi-house-heart-fill', 'bi-feather', 'bi-water', 'bi-tree-fill', 'bi-camera-fill', 'bi-geo-alt-fill'];

function readDest(body) {
  const f = {
    code: String(body.code || '').trim().toUpperCase(), name: String(body.name || '').trim(), category: String(body.category || '').trim(),
    description: String(body.description || '').trim(), address: String(body.address || '').trim(),
    open_time: String(body.open_time || ''), close_time: String(body.close_time || ''),
    slot_hours: parseInt(body.slot_hours, 10), price_adult: parseInt(body.price_adult, 10), price_child: parseInt(body.price_child, 10),
    daily_quota: parseInt(body.daily_quota, 10), icon: ICONS.includes(body.icon) ? body.icon : 'bi-geo-alt-fill',
    color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#0f5c4d', is_active: body.is_active ? 1 : 0,
  };
  const errors = [];
  if (!/^[A-Z]{2,4}$/.test(f.code)) errors.push('Kode destinasi harus 2-4 huruf (mis. IM).');
  if (f.name.length < 3) errors.push('Nama destinasi minimal 3 karakter.');
  if (!f.category) errors.push('Kategori wajib diisi.');
  if (!/^\d{2}:\d{2}$/.test(f.open_time) || !/^\d{2}:\d{2}$/.test(f.close_time) || f.open_time >= f.close_time) errors.push('Jam buka harus lebih awal dari jam tutup.');
  if (!(f.slot_hours >= 1 && f.slot_hours <= 12)) errors.push('Durasi sesi 1-12 jam.');
  if (!(f.price_adult >= 0) || !(f.price_child >= 0)) errors.push('Harga tiket tidak boleh negatif.');
  if (!(f.daily_quota >= 1)) errors.push('Kuota harian minimal 1.');
  return { f, errors };
}

router.get('/wisata', (req, res) => {
  const rows = db.prepare('SELECT * FROM destinations ORDER BY id').all();
  res.render('admin/wisata_list', { title: 'Kelola Destinasi', rows });
});
router.get('/wisata/baru', (req, res) => res.render('admin/wisata_form', {
  title: 'Tambah Destinasi', f: { slot_hours: 2, open_time: '08:00', close_time: '17:00', price_adult: 0, price_child: 0, daily_quota: 100, icon: 'bi-geo-alt-fill', color: '#0f5c4d', is_active: 1 },
  errors: [], icons: ICONS, editId: null }));
router.post('/wisata', (req, res) => {
  const { f, errors } = readDest(req.body);
  if (!errors.length && db.prepare('SELECT 1 FROM destinations WHERE code=?').get(f.code)) errors.push('Kode destinasi sudah dipakai.');
  if (errors.length) return res.status(400).render('admin/wisata_form', { title: 'Tambah Destinasi', f, errors, icons: ICONS, editId: null });
  db.prepare(`INSERT INTO destinations (code,name,category,description,address,open_time,close_time,slot_hours,price_adult,price_child,daily_quota,icon,color,is_active,created_at)
    VALUES (@code,@name,@category,@description,@address,@open_time,@close_time,@slot_hours,@price_adult,@price_child,@daily_quota,@icon,@color,@is_active,@created_at)`)
    .run({ ...f, created_at: U.nowStr() });
  req.session.flash = { type: 'success', text: 'Destinasi berhasil ditambahkan.' };
  res.redirect('/admin/wisata');
});
router.get('/wisata/:id/edit', (req, res) => {
  const f = db.prepare('SELECT * FROM destinations WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Destinasi tidak ditemukan.' });
  res.render('admin/wisata_form', { title: 'Ubah Destinasi', f, errors: [], icons: ICONS, editId: f.id });
});
router.post('/wisata/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM destinations WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Destinasi tidak ditemukan.' });
  const { f, errors } = readDest(req.body);
  if (!errors.length && db.prepare('SELECT 1 FROM destinations WHERE code=? AND id<>?').get(f.code, cur.id)) errors.push('Kode destinasi sudah dipakai.');
  if (errors.length) return res.status(400).render('admin/wisata_form', { title: 'Ubah Destinasi', f, errors, icons: ICONS, editId: cur.id });
  db.prepare(`UPDATE destinations SET code=@code,name=@name,category=@category,description=@description,address=@address,open_time=@open_time,
    close_time=@close_time,slot_hours=@slot_hours,price_adult=@price_adult,price_child=@price_child,daily_quota=@daily_quota,icon=@icon,color=@color,is_active=@is_active WHERE id=@id`)
    .run({ ...f, id: cur.id });
  req.session.flash = { type: 'success', text: 'Destinasi berhasil diperbarui.' };
  res.redirect('/admin/wisata');
});
router.post('/wisata/:id/hapus', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM bookings WHERE destination_id=?').get(req.params.id).c;
  if (used > 0) req.session.flash = { type: 'warning', text: 'Destinasi sudah memiliki riwayat transaksi sehingga tidak dapat dihapus. Nonaktifkan saja melalui menu Ubah.' };
  else { db.prepare('DELETE FROM destinations WHERE id=?').run(req.params.id); req.session.flash = { type: 'success', text: 'Destinasi dihapus.' }; }
  res.redirect('/admin/wisata');
});

// ---------- CRUD PENGGUNA ----------
router.get('/pengguna', (req, res) => {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id) bookings FROM users u ORDER BY u.role, u.id`).all();
  res.render('admin/users', { title: 'Kelola Pengguna', rows });
});
router.get('/pengguna/baru', (req, res) => res.render('admin/user_form', { title: 'Tambah Pengguna', f: { role: 'petugas' }, errors: [], editId: null }));
router.post('/pengguna', (req, res) => {
  const f = { name: String(req.body.name || '').trim(), email: String(req.body.email || '').trim().toLowerCase(), phone: String(req.body.phone || '').trim(), role: req.body.role };
  const pw = String(req.body.password || '');
  const errors = [];
  if (f.name.length < 3) errors.push('Nama minimal 3 karakter.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.push('Format email tidak valid.');
  if (!['admin', 'petugas', 'user'].includes(f.role)) errors.push('Peran tidak valid.');
  if (pw.length < 6) errors.push('Password minimal 6 karakter.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=?').get(f.email)) errors.push('Email sudah terdaftar.');
  if (errors.length) return res.status(400).render('admin/user_form', { title: 'Tambah Pengguna', f, errors, editId: null });
  db.prepare('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)').run(f.name, f.email, f.phone, bcrypt.hashSync(pw, 10), f.role, U.nowStr());
  req.session.flash = { type: 'success', text: 'Pengguna berhasil ditambahkan.' };
  res.redirect('/admin/pengguna');
});
router.get('/pengguna/:id/edit', (req, res) => {
  const f = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Pengguna tidak ditemukan.' });
  res.render('admin/user_form', { title: 'Ubah Pengguna', f, errors: [], editId: f.id });
});
router.post('/pengguna/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Pengguna tidak ditemukan.' });
  const f = { id: cur.id, name: String(req.body.name || '').trim(), email: String(req.body.email || '').trim().toLowerCase(), phone: String(req.body.phone || '').trim(), role: req.body.role };
  const pw = String(req.body.password || '');
  const errors = [];
  if (f.name.length < 3) errors.push('Nama minimal 3 karakter.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.push('Format email tidak valid.');
  if (!['admin', 'petugas', 'user'].includes(f.role)) errors.push('Peran tidak valid.');
  if (pw && pw.length < 6) errors.push('Password baru minimal 6 karakter.');
  if (cur.id === req.session.user.id && f.role !== 'admin') errors.push('Anda tidak dapat menurunkan peran akun Anda sendiri.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(f.email, cur.id)) errors.push('Email sudah terdaftar.');
  if (errors.length) return res.status(400).render('admin/user_form', { title: 'Ubah Pengguna', f, errors, editId: cur.id });
  db.prepare('UPDATE users SET name=?,email=?,phone=?,role=? WHERE id=?').run(f.name, f.email, f.phone, f.role, cur.id);
  if (pw) db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), cur.id);
  req.session.flash = { type: 'success', text: 'Data pengguna diperbarui.' };
  res.redirect('/admin/pengguna');
});
router.post('/pengguna/:id/hapus', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) req.session.flash = { type: 'warning', text: 'Anda tidak dapat menghapus akun Anda sendiri.' };
  else if (db.prepare('SELECT COUNT(*) c FROM bookings WHERE user_id=?').get(id).c > 0 || db.prepare('SELECT COUNT(*) c FROM tickets WHERE checked_by=?').get(id).c > 0 || db.prepare('SELECT COUNT(*) c FROM booking_logs WHERE actor_id=?').get(id).c > 0)
    req.session.flash = { type: 'warning', text: 'Pengguna memiliki riwayat transaksi/check-in sehingga tidak dapat dihapus.' };
  else { db.prepare('DELETE FROM users WHERE id=?').run(id); req.session.flash = { type: 'success', text: 'Pengguna dihapus.' }; }
  res.redirect('/admin/pengguna');
});

// ---------- TRANSAKSI ----------
function txFilter(q) {
  let where = '1=1'; const p = [];
  if (q.status && ['pending', 'paid', 'cancelled', 'expired'].includes(q.status)) { where += ' AND b.status=?'; p.push(q.status); }
  if (q.dest) { where += ' AND b.destination_id=?'; p.push(Number(q.dest)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where += ' AND b.visit_date>=?'; p.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where += ' AND b.visit_date<=?'; p.push(q.to); }
  return { where, p };
}
const TX_SQL = `SELECT b.*, d.name dest_name, u.name visitor, p.method, p.reference, t.status ticket_status
  FROM bookings b JOIN destinations d ON d.id=b.destination_id JOIN users u ON u.id=b.user_id
  LEFT JOIN payments p ON p.booking_id=b.id LEFT JOIN tickets t ON t.booking_id=b.id`;

router.get('/transaksi', (req, res) => {
  const { where, p } = txFilter(req.query);
  let w = where; const params = [...p];
  const term = String(req.query.q || '').trim();
  if (term) {
    w += ' AND (b.code LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR t.ticket_code LIKE ?)';
    const like = `%${term}%`; params.push(like, like, like, like, like);
  }
  const rows = db.prepare(`${TX_SQL} WHERE ${w} ORDER BY b.id DESC LIMIT 200`).all(...params);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM bookings GROUP BY status').all().map((r) => [r.status, r.c]));
  const dests = db.prepare('SELECT id,name FROM destinations ORDER BY id').all();
  res.render('admin/transaksi', { title: 'Data Transaksi', rows, dests, q: req.query, counts });
});

function bookingDetail(code) {
  const b = db.prepare(`${TX_SQL} WHERE b.code=?`).get(code);
  if (!b) return null;
  const d = db.prepare('SELECT code, icon, color FROM destinations WHERE id=?').get(b.destination_id);
  const ticket = db.prepare('SELECT * FROM tickets WHERE booking_id=?').get(b.id);
  const queue = db.prepare('SELECT * FROM queues WHERE booking_id=?').get(b.id);
  const logs = db.prepare(`SELECT l.*, u.name actor, u.role actor_role FROM booking_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE l.booking_id=? ORDER BY l.id DESC`).all(b.id);
  const visitor = db.prepare('SELECT name,email,phone FROM users WHERE id=?').get(b.user_id);
  return { b, d, ticket, queue, logs, visitor };
}

router.get('/transaksi/:code', (req, res) => {
  const x = bookingDetail(req.params.code);
  if (!x) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Pesanan tidak ditemukan.' });
  res.render('admin/transaksi_detail', { title: 'Pesanan ' + x.b.code, ...x, actions: B.availableActions(x.b, x.ticket && x.ticket.status, 'admin'), canReschedule: B.canReschedule(x.b, x.ticket && x.ticket.status, 'admin'), windowDays: B.BOOKING_WINDOW_DAYS, today: U.todayStr(), ACTION_LABEL: B.ACTION_LABEL });
});

router.post('/transaksi/:code/aksi', (req, res) => {
  const r = B.manageBooking(req.params.code, String(req.body.aksi || ''), req.session.user, String(req.body.catatan || '').trim().slice(0, 200));
  req.session.flash = r.ok ? { type: 'success', text: r.message } : { type: 'warning', text: r.error };
  res.redirect('/admin/transaksi/' + encodeURIComponent(req.params.code));
});

router.post('/transaksi/:code/jadwal', (req, res) => {
  const r = B.rescheduleBooking(req.params.code, { date: String(req.body.date || ''), slot: String(req.body.slot || '') }, req.session.user, String(req.body.catatan || '').trim().slice(0, 150));
  req.session.flash = r.ok ? { type: 'success', text: r.message } : { type: 'warning', text: r.error };
  res.redirect('/admin/transaksi/' + encodeURIComponent(req.params.code));
});

// ---------- FOTO DESTINASI (unggah / hapus) ----------
const DEST_DIR = path.join(__dirname, '..', 'public', 'img', 'dest');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } }).single('foto');
const isJpeg = (buf) => buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

router.post('/wisata/:id/foto', (req, res) => {
  const d = db.prepare('SELECT code FROM destinations WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ ok: false, message: 'Destinasi tidak ditemukan.' });
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran foto maksimal 4 MB.' : 'Gagal membaca berkas foto.' });
    if (!req.file) return res.status(400).json({ ok: false, message: 'Pilih berkas foto terlebih dahulu.' });
    if (!isJpeg(req.file.buffer)) return res.status(400).json({ ok: false, message: 'Format foto harus JPG/JPEG.' });
    fs.writeFileSync(path.join(DEST_DIR, d.code + '.jpg'), req.file.buffer);
    res.json({ ok: true, url: '/img/dest/' + d.code + '.jpg?v=' + Date.now(), message: 'Foto berhasil diperbarui.' });
  });
});
router.post('/wisata/:id/foto/hapus', (req, res) => {
  const d = db.prepare('SELECT code FROM destinations WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ ok: false });
  try { fs.unlinkSync(path.join(DEST_DIR, d.code + '.jpg')); } catch (e) { /* belum ada foto */ }
  res.json({ ok: true, message: 'Foto dihapus. Ilustrasi bawaan dipakai kembali.' });
});

// ---------- LAPORAN ----------
router.get('/laporan', (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : U.dateOffset(-29);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : U.todayStr();
  const destId = Number(req.query.dest) || null;
  const extra = destId ? ' AND b.destination_id=?' : '';
  const params = destId ? [from, to, destId] : [from, to];
  const rows = db.prepare(`${TX_SQL} WHERE b.status='paid' AND b.visit_date BETWEEN ? AND ?${extra} ORDER BY b.visit_date, b.id`).all(...params);

  if (req.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Kode Pesanan', 'Tanggal Kunjungan', 'Sesi', 'Destinasi', 'Pengunjung', 'Dewasa', 'Anak', 'Total (Rp)', 'Metode Bayar', 'Status Tiket'];
    const lines = [head.map(esc).join(',')].concat(rows.map((r) => [r.code, r.visit_date, r.visit_slot, r.dest_name, r.visitor, r.qty_adult, r.qty_child, r.total, r.method, r.ticket_status === 'used' ? 'Sudah check-in' : 'Belum check-in'].map(esc).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-kunjungan_${from}_${to}.csv"`);
    return res.send('\ufeff' + lines.join('\r\n'));
  }

  const summary = {
    transaksi: rows.length,
    pengunjung: rows.reduce((a, r) => a + r.qty_adult + r.qty_child, 0),
    pendapatan: rows.reduce((a, r) => a + r.total, 0),
    checkin: rows.filter((r) => r.ticket_status === 'used').reduce((a, r) => a + r.qty_adult + r.qty_child, 0),
  };
  const byDest = {};
  rows.forEach((r) => {
    const x = (byDest[r.dest_name] = byDest[r.dest_name] || { name: r.dest_name, transaksi: 0, pengunjung: 0, pendapatan: 0 });
    x.transaksi++; x.pengunjung += r.qty_adult + r.qty_child; x.pendapatan += r.total;
  });
  const dests = db.prepare('SELECT id,name FROM destinations ORDER BY id').all();
  res.render('admin/laporan', { title: 'Laporan Kunjungan', rows, summary, byDest: Object.values(byDest).sort((a, b) => b.pendapatan - a.pendapatan), from, to, destId, dests });
});

module.exports = router;

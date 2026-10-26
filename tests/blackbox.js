// Pengujian Black Box otomatis. Menjalankan server pada DB sementara lalu menembak endpoint HTTP.
const os = require('os'), path = require('path'), fs = require('fs');
process.env.TZ = 'Asia/Jakarta';
process.env.DB_FILE = path.join(os.tmpdir(), 'mst-test-' + Date.now() + '.db');
const app = require('../server');
const db = require('../db');
const U = require('../lib/util');

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async req(method, url, { form, json, noCsrf } = {}) {
    const headers = { cookie: this.cookie };
    let body;
    if (form) {
      const f = { ...form };
      if (!noCsrf) f._csrf = this.csrf;
      body = new URLSearchParams(f).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (json) {
      body = JSON.stringify(json);
      headers['content-type'] = 'application/json';
      headers['x-csrf-token'] = this.csrf;
    }
    const r = await fetch(this.base + url, { method, headers, body, redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    const m = text.match(/name="_csrf" value="([a-f0-9]+)"/);
    if (m) this.csrf = m[1];
    return { status: r.status, loc: r.headers.get('location'), text, headers: r.headers };
  }
  get(url) { return this.req('GET', url); }
  post(url, form, o = {}) { return this.req('POST', url, { form, ...o }); }
  async follow(r) { return r.loc ? this.get(r.loc) : r; }
  async login(email, password) { await this.get('/login'); return this.post('/login', { email, password }); }
}

const results = [];
function rec(id, modul, skenario, input, harapan, aktual, lulus) {
  results.push({ id, modul, skenario, input, harapan, aktual, status: lulus ? 'Berhasil' : 'GAGAL' });
}

(async () => {
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const tomorrow = U.dateOffset(1);
  const dest = db.prepare("SELECT * FROM destinations WHERE code='IM'").get();

  // ---- Autentikasi ----
  let c = new Client(base);
  let r = await c.login('admin@smarttour.id', 'admin123');
  rec('BB-01', 'Login', 'Login admin dengan data valid', 'admin@smarttour.id / admin123', 'Diarahkan ke /admin', `HTTP ${r.status} → ${r.loc}`, r.status === 302 && r.loc === '/admin');
  const admin = c;

  c = new Client(base);
  r = await c.login('admin@smarttour.id', 'salahsekali');
  rec('BB-02', 'Login', 'Login dengan password salah', 'admin@smarttour.id / salahsekali', 'Ditolak, pesan kesalahan tampil', `HTTP ${r.status}, pesan "Email atau password salah" ${r.text.includes('Email atau password salah') ? 'tampil' : 'tidak tampil'}`, r.status === 401 && r.text.includes('Email atau password salah'));

  c = new Client(base);
  r = await c.login('', '');
  rec('BB-03', 'Login', 'Login dengan form kosong', 'email & password kosong', 'Ditolak, validasi wajib isi', `HTTP ${r.status}, ${r.text.includes('wajib diisi') ? 'pesan validasi tampil' : 'tanpa pesan'}`, r.status === 400 && r.text.includes('wajib diisi'));

  c = new Client(base); await c.get('/register');
  const regEmail = 'uji' + Date.now() + '@mail.com';
  r = await c.post('/register', { name: 'Penguji Satu', email: regEmail, phone: '081200000000', password: 'rahasia1', confirm: 'rahasia1' });
  rec('BB-04', 'Registrasi', 'Registrasi wisatawan data valid', 'nama, email baru, password 8 karakter', 'Akun dibuat, diarahkan ke /login', `HTTP ${r.status} → ${r.loc}`, r.status === 302 && r.loc === '/login');

  await c.get('/register');
  r = await c.post('/register', { name: 'Penguji Dua', email: regEmail, phone: '', password: 'rahasia1', confirm: 'rahasia1' });
  rec('BB-05', 'Registrasi', 'Registrasi dengan email yang sudah terdaftar', regEmail, 'Ditolak, pesan email sudah terdaftar', `HTTP ${r.status}, ${r.text.includes('Email sudah terdaftar') ? 'pesan tampil' : 'tidak ada pesan'}`, r.status === 400 && r.text.includes('Email sudah terdaftar'));

  await c.get('/register');
  r = await c.post('/register', { name: 'Penguji', email: 'x@mail.com', phone: '', password: '123', confirm: '456' });
  rec('BB-06', 'Registrasi', 'Password pendek & konfirmasi tidak sama', 'password 123 / konfirmasi 456', 'Ditolak dengan pesan validasi', `HTTP ${r.status}`, r.status === 400 && r.text.includes('minimal 6') && r.text.includes('tidak sama'));

  // ---- Hak akses ----
  c = new Client(base); await c.get('/');
  r = await c.get('/admin');
  rec('BB-07', 'Hak akses', 'Akses /admin tanpa login', 'GET /admin (guest)', 'Diarahkan ke halaman login', `HTTP ${r.status} → ${r.loc}`, r.status === 302 && r.loc === '/login');

  const user = new Client(base);
  await user.login('pengunjung@smarttour.id', 'pengunjung123');
  r = await user.get('/admin');
  rec('BB-08', 'Hak akses', 'Wisatawan membuka /admin', 'GET /admin (role user)', 'Ditolak (403)', `HTTP ${r.status}`, r.status === 403);

  // ---- Pemesanan ----
  r = await user.get('/wisata/' + dest.id);
  rec('BB-09', 'Katalog', 'Membuka detail destinasi', `GET /wisata/${dest.id}`, 'Tampil nama, harga, jam buka', `HTTP ${r.status}, ${r.text.includes(dest.name) && r.text.includes('Rp 10.000') ? 'data tampil' : 'data tidak lengkap'}`, r.status === 200 && r.text.includes(dest.name) && r.text.includes('Rp 10.000'));

  const slot = U.slots(dest.open_time, dest.close_time, dest.slot_hours, tomorrow)[0];
  r = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 2, qty_child: 1 });
  const m = (r.loc || '').match(/^\/bayar\/(MST-[\w-]+)$/);
  const code1 = m && m[1];
  const b1 = code1 && db.prepare('SELECT * FROM bookings WHERE code=?').get(code1);
  rec('BB-10', 'Booking', 'Pesan tiket valid (2 dewasa, 1 anak)', `${dest.name}, ${tomorrow}, ${slot}`, 'Pesanan pending, total Rp 25.000, ke halaman bayar', `HTTP ${r.status} → ${r.loc}; total=${b1 ? b1.total : '-'}; status=${b1 ? b1.status : '-'}`, !!b1 && b1.total === 25000 && b1.status === 'pending');

  const bad = async (form) => {
    const x = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 1, qty_child: 0, ...form });
    const p = await user.follow(x);
    return p.text;
  };
  let t = await bad({ visit_date: U.dateOffset(-1) });
  rec('BB-11', 'Booking', 'Pesan tiket dengan tanggal kemarin', 'visit_date = kemarin', 'Ditolak: tanggal tidak boleh masa lalu', t.includes('masa lalu') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('masa lalu'));
  t = await bad({ qty_adult: 0, qty_child: 2 });
  rec('BB-12', 'Booking', 'Pesan hanya tiket anak (tanpa dewasa)', 'dewasa 0, anak 2', 'Ditolak: wajib didampingi dewasa', t.includes('didampingi') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('didampingi'));
  t = await bad({ qty_adult: 11 });
  rec('BB-13', 'Booking', 'Pesan melebihi batas 10 tiket', 'dewasa 11', 'Ditolak: maksimal 10 tiket', t.includes('Maksimal 10') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('Maksimal 10'));
  t = await bad({ visit_date: U.dateOffset(45) });
  rec('BB-14', 'Booking', 'Pesan lebih dari 30 hari ke depan', 'visit_date = +45 hari', 'Ditolak: maksimal 30 hari', t.includes('30 hari') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('30 hari'));

  // Kuota: buat destinasi uji berkuota 3 melalui CRUD admin
  await admin.get('/admin/wisata/baru');
  r = await admin.post('/admin/wisata', { code: 'UJ', name: 'Destinasi Uji Kuota', category: 'Uji', description: 'x', address: 'x', open_time: '00:00', close_time: '12:00', slot_hours: 12, price_adult: 1000, price_child: 500, daily_quota: 3, icon: 'bi-geo-alt-fill', color: '#112233', is_active: 'on' });
  const tdest = db.prepare("SELECT * FROM destinations WHERE code='UJ'").get();
  rec('BB-15', 'CRUD Destinasi', 'Admin menambah destinasi baru', 'kode UJ, kuota 3', 'Tersimpan, kembali ke daftar', `HTTP ${r.status} → ${r.loc}; data ${tdest ? 'tersimpan' : 'tidak tersimpan'}`, r.status === 302 && !!tdest);

  const tslot = U.slots('00:00', '12:00', 12, tomorrow)[0];
  r = await user.post('/pesan', { destination_id: tdest.id, visit_date: tomorrow, visit_slot: tslot, qty_adult: 4, qty_child: 0 });
  t = (await user.follow(r)).text;
  rec('BB-16', 'Booking', 'Pesan melebihi sisa kuota (kuota 3, pesan 4)', 'dewasa 4', 'Ditolak: kuota tidak mencukupi', t.includes('Kuota tidak mencukupi') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('Kuota tidak mencukupi'));

  // ---- Pembayaran ----
  r = await user.get('/bayar/' + code1);
  rec('BB-17', 'Pembayaran', 'Membuka halaman pembayaran', 'GET /bayar/' + code1, 'Tampil ringkasan & metode bayar', `HTTP ${r.status}`, r.status === 200 && r.text.includes('Pilih Metode Pembayaran'));
  r = await user.post('/bayar/' + code1, { method: 'QRIS' });
  const g = await user.follow(r);
  rec('BB-18', 'Pembayaran', 'Memilih metode QRIS', 'method = QRIS', 'Halaman gateway sandbox + QR tampil', `HTTP ${g.status}, ${g.text.includes('data:image/png') ? 'QR tampil' : 'QR tidak tampil'}`, g.status === 200 && g.text.includes('data:image/png'));
  r = await user.post('/bayar/' + code1, { method: 'BITCOIN' });
  t = (await user.follow(r)).text;
  rec('BB-19', 'Pembayaran', 'Metode pembayaran tidak valid', 'method = BITCOIN', 'Ditolak', t.includes('tidak valid') ? 'Pesan penolakan tampil' : 'Tidak ditolak', t.includes('tidak valid'));

  r = await user.post('/bayar/' + code1 + '/konfirmasi', {});
  const tp = await user.follow(r);
  const tk = db.prepare('SELECT t.*, q.queue_number FROM tickets t JOIN bookings b ON b.id=t.booking_id LEFT JOIN queues q ON q.booking_id=b.id WHERE b.code=?').get(code1);
  rec('BB-20', 'Pembayaran', 'Konfirmasi pembayaran sukses', 'POST /bayar/{kode}/konfirmasi', 'Status lunas, e-tiket QR & nomor antrian terbit', `status=${db.prepare('SELECT status FROM bookings WHERE code=?').get(code1).status}; tiket=${tk ? tk.ticket_code : '-'}; antrian=${tk ? tk.queue_number : '-'}`, !!tk && tp.text.includes('data:image/png') && /IM-\d{3}/.test(tp.text));

  await user.post('/bayar/' + code1 + '/konfirmasi', {});
  const cnt = db.prepare('SELECT COUNT(*) c FROM tickets t JOIN bookings b ON b.id=t.booking_id WHERE b.code=?').get(code1).c;
  rec('BB-21', 'Pembayaran', 'Konfirmasi dua kali pada pesanan yang sama', 'POST konfirmasi (ulang)', 'Ditolak, tiket tidak dobel', `jumlah tiket = ${cnt}`, cnt === 1);

  // Pesanan lain: batal & kedaluwarsa
  r = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 1, qty_child: 0 });
  const code2 = r.loc.split('/').pop();
  await user.get(r.loc);
  await user.post('/bayar/' + code2 + '/batal', {});
  const st2 = db.prepare('SELECT status FROM bookings WHERE code=?').get(code2).status;
  rec('BB-22', 'Pembayaran', 'Membatalkan pesanan yang belum dibayar', 'POST /bayar/{kode}/batal', 'Status menjadi cancelled', `status=${st2}`, st2 === 'cancelled');

  r = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 1, qty_child: 0 });
  const code3 = r.loc.split('/').pop();
  await user.post('/bayar/' + code3, { method: 'DANA' });
  db.prepare("UPDATE bookings SET expires_at='2000-01-01 00:00:00' WHERE code=?").run(code3);
  await user.get('/tiket');
  const st3 = db.prepare('SELECT status FROM bookings WHERE code=?').get(code3).status;
  rec('BB-23', 'Pembayaran', 'Pesanan melewati batas waktu bayar 30 menit', 'expires_at diset ke masa lalu', 'Status otomatis menjadi expired', `status=${st3}`, st3 === 'expired');

  // Kepemilikan
  const other = new Client(base);
  const otherEmail = 'lain' + Date.now() + '@mail.com';
  await other.get('/register'); await other.post('/register', { name: 'Pengunjung Lain', email: otherEmail, phone: '', password: 'rahasia1', confirm: 'rahasia1' });
  await other.post('/login', { email: otherEmail, password: 'rahasia1' });
  r = await other.get('/tiket/' + code1);
  rec('BB-24', 'Hak akses', 'Pengunjung lain membuka e-tiket milik orang lain', 'GET /tiket/' + code1 + ' (akun pengunjung lain)', 'Ditolak (404)', `HTTP ${r.status}`, r.status === 404);

  // ---- Check-in & antrian ----
  const staff = new Client(base); await staff.login('petugas@smarttour.id', 'petugas123');
  await staff.get('/petugas/scan');
  const todayTicket = db.prepare("SELECT t.ticket_code FROM tickets t JOIN bookings b ON b.id=t.booking_id WHERE b.visit_date=? AND t.status='valid' LIMIT 1").get(U.todayStr());
  let j = await staff.req('POST', '/api/checkin', { json: { code: todayTicket.ticket_code } });
  let jj = JSON.parse(j.text);
  rec('BB-25', 'Check-in', 'Petugas scan tiket valid untuk hari ini', todayTicket.ticket_code, 'Check-in berhasil, status tiket used', `ok=${jj.ok}; ${jj.message}`, jj.ok === true && db.prepare('SELECT status FROM tickets WHERE ticket_code=?').get(todayTicket.ticket_code).status === 'used');
  j = await staff.req('POST', '/api/checkin', { json: { code: todayTicket.ticket_code } });
  jj = JSON.parse(j.text);
  rec('BB-26', 'Check-in', 'Scan ulang tiket yang sudah digunakan', todayTicket.ticket_code, 'Ditolak: tiket sudah digunakan', `code=${jj.code}`, jj.ok === false && jj.code === 'USED');
  j = await staff.req('POST', '/api/checkin', { json: { code: 'TKT-PALSU12345' } });
  jj = JSON.parse(j.text);
  rec('BB-27', 'Check-in', 'Scan QR dengan kode palsu', 'TKT-PALSU12345', 'Ditolak: tiket tidak ditemukan', `HTTP ${j.status}, code=${jj.code}`, j.status === 404 && jj.code === 'NOT_FOUND');
  j = await staff.req('POST', '/api/checkin', { json: { code: tk.ticket_code } });
  jj = JSON.parse(j.text);
  rec('BB-28', 'Check-in', 'Scan tiket untuk tanggal kunjungan besok', tk.ticket_code, 'Ditolak: bukan tanggal kunjungan', `code=${jj.code}`, jj.ok === false && jj.code === 'WRONG_DATE');
  j = await user.req('POST', '/api/checkin', { json: { code: tk.ticket_code } });
  rec('BB-29', 'Hak akses', 'Wisatawan memanggil API check-in', 'POST /api/checkin (role user)', 'Ditolak (403)', `HTTP ${j.status}`, j.status === 403);

  await staff.get('/petugas/antrian');
  const dToday = db.prepare("SELECT destination_id d FROM queues WHERE queue_date=? AND status='waiting' LIMIT 1").get(U.todayStr());
  await staff.post('/petugas/antrian/panggil', { dest: dToday.d });
  const called = db.prepare("SELECT COUNT(*) c FROM queues WHERE destination_id=? AND queue_date=? AND status='called'").get(dToday.d, U.todayStr()).c;
  rec('BB-30', 'E-Queue', 'Petugas memanggil antrian berikutnya', 'POST /petugas/antrian/panggil', 'Satu antrian berstatus called', `antrian dipanggil = ${called}`, called === 1);
  j = await user.get('/api/antrian');
  jj = JSON.parse(j.text);
  rec('BB-31', 'E-Queue', 'Papan antrian publik menampilkan nomor dipanggil', 'GET /api/antrian', 'Ada destinasi dengan nomor "sedang dilayani"', `${jj.rows.filter((x) => x.serving).length} destinasi menampilkan nomor`, jj.rows.some((x) => x.serving));

  // ---- CRUD & laporan ----
  r = await admin.post('/admin/wisata', { code: 'ZZ', name: 'X', category: 'Uji', open_time: '17:00', close_time: '08:00', slot_hours: 2, price_adult: 1, price_child: 1, daily_quota: 1 });
  rec('BB-32', 'CRUD Destinasi', 'Tambah destinasi dengan jam tutup lebih awal dari jam buka', 'buka 17:00, tutup 08:00', 'Ditolak dengan pesan validasi', `HTTP ${r.status}`, r.status === 400 && r.text.includes('Jam buka'));
  await admin.get('/admin/wisata/' + tdest.id + '/edit');
  await admin.post('/admin/wisata/' + tdest.id, { code: 'UJ', name: 'Destinasi Uji Diubah', category: 'Uji', open_time: '00:00', close_time: '12:00', slot_hours: 12, price_adult: 2000, price_child: 500, daily_quota: 3, is_active: 'on' });
  const pa = db.prepare('SELECT price_adult p FROM destinations WHERE id=?').get(tdest.id).p;
  rec('BB-33', 'CRUD Destinasi', 'Admin mengubah destinasi', 'harga dewasa 1000 → 2000', 'Data terbarui', `harga=${pa}`, pa === 2000);
  await admin.post('/admin/wisata/' + dest.id + '/hapus', {});
  const stillThere = !!db.prepare('SELECT 1 FROM destinations WHERE id=?').get(dest.id);
  rec('BB-34', 'CRUD Destinasi', 'Hapus destinasi yang sudah punya transaksi', 'DELETE Istana Maimun', 'Ditolak (data historis dilindungi)', `masih ada = ${stillThere}`, stillThere);
  await admin.post('/admin/wisata/' + tdest.id + '/hapus', {});
  const gone = !db.prepare('SELECT 1 FROM destinations WHERE id=?').get(tdest.id);
  rec('BB-35', 'CRUD Destinasi', 'Hapus destinasi tanpa transaksi', 'DELETE destinasi uji', 'Terhapus', `terhapus = ${gone}`, gone);
  r = await admin.get('/admin/laporan?format=csv');
  rec('BB-36', 'Laporan', 'Ekspor laporan kunjungan ke CSV', 'GET /admin/laporan?format=csv', 'File CSV terunduh dengan header kolom', `HTTP ${r.status}; ${r.headers.get('content-type')}`, r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv') && r.text.includes('Kode Pesanan'));
  r = await admin.get('/admin');
  rec('BB-37', 'Dashboard', 'Dashboard admin menampilkan grafik harian & mingguan', 'GET /admin', 'Halaman memuat 3 grafik', `HTTP ${r.status}; canvas=${(r.text.match(/<canvas/g) || []).length}`, r.status === 200 && (r.text.match(/<canvas/g) || []).length === 3);

  // ---- Pengelolaan status pesanan (admin & petugas) ----
  const mk = async () => { // buat pesanan baru berstatus pending oleh wisatawan
    const x = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 1, qty_child: 0 });
    return decodeURIComponent((x.loc || '').split('/').pop());
  };
  const st = (code) => db.prepare('SELECT status FROM bookings WHERE code=?').get(code);
  let kodeKelola = await mk();
  r = await staff.post('/petugas/pesanan/' + kodeKelola + '/aksi', { aksi: 'lunas' });
  const lunasKelola = st(kodeKelola).status === 'paid' && !!db.prepare('SELECT 1 FROM tickets t JOIN bookings b ON b.id=t.booking_id WHERE b.code=?').get(kodeKelola) && !!db.prepare('SELECT 1 FROM queues q JOIN bookings b ON b.id=q.booking_id WHERE b.code=?').get(kodeKelola);
  rec('BB-41', 'Kelola Pesanan', 'Petugas melunasi pesanan (bayar tunai di loket)', 'POST /petugas/pesanan/:kode/aksi aksi=lunas', 'Status lunas, e-tiket dan nomor antrian terbit', `status = ${st(kodeKelola).status}`, lunasKelola);
  r = await staff.post('/petugas/pesanan/' + kodeKelola + '/aksi', { aksi: 'batal' });
  rec('BB-42', 'Kelola Pesanan', 'Petugas tidak boleh membatalkan pesanan yang sudah lunas', 'aksi=batal pada pesanan lunas', 'Ditolak, status tetap lunas', `status = ${st(kodeKelola).status}`, st(kodeKelola).status === 'paid');
  r = await admin.post('/admin/transaksi/' + kodeKelola + '/aksi', { aksi: 'batal', catatan: 'Pengunjung batal datang' });
  const tiketGone = !db.prepare('SELECT 1 FROM tickets t JOIN bookings b ON b.id=t.booking_id WHERE b.code=?').get(kodeKelola);
  rec('BB-43', 'Kelola Pesanan', 'Admin membatalkan pesanan lunas (refund)', 'POST /admin/transaksi/:kode/aksi aksi=batal', 'Status batal, e-tiket dan antrian dicabut, pembayaran tidak dihitung', `status = ${st(kodeKelola).status}; tiket dicabut = ${tiketGone}`, st(kodeKelola).status === 'cancelled' && tiketGone);
  r = await admin.post('/admin/transaksi/' + kodeKelola + '/aksi', { aksi: 'aktifkan' });
  rec('BB-44', 'Kelola Pesanan', 'Admin mengaktifkan kembali pesanan yang dibatalkan', 'aksi=aktifkan', 'Status kembali menunggu pembayaran', `status = ${st(kodeKelola).status}`, st(kodeKelola).status === 'pending');
  await staff.post('/petugas/pesanan/' + kodeKelola + '/aksi', { aksi: 'batal' }); // petugas boleh membatalkan yang belum dibayar
  const sebelum = st(kodeKelola).status;
  await staff.post('/petugas/pesanan/' + kodeKelola + '/aksi', { aksi: 'aktifkan' });
  rec('BB-45', 'Kelola Pesanan', 'Petugas tidak boleh mengaktifkan kembali pesanan', 'aksi=aktifkan oleh petugas pada pesanan batal', 'Ditolak, status tetap batal', `sebelum = ${sebelum}; sesudah = ${st(kodeKelola).status}`, sebelum === 'cancelled' && st(kodeKelola).status === 'cancelled');
  await admin.post('/admin/transaksi/' + kodeKelola + '/aksi', { aksi: 'aktifkan' });
  r = await admin.get('/admin/transaksi/' + kodeKelola);
  const logCount = db.prepare('SELECT COUNT(*) c FROM booking_logs l JOIN bookings b ON b.id=l.booking_id WHERE b.code=?').get(kodeKelola).c;
  rec('BB-46', 'Kelola Pesanan', 'Setiap perubahan status tercatat di riwayat', 'GET /admin/transaksi/:kode', 'Halaman detail memuat riwayat perubahan', `HTTP ${r.status}; log = ${logCount}`, r.status === 200 && logCount >= 3 && r.text.includes('Riwayat perubahan'));
  r = await user.post('/admin/transaksi/' + kodeKelola + '/aksi', { aksi: 'lunas' });
  rec('BB-47', 'Kelola Pesanan', 'Wisatawan tidak boleh mengubah status pesanan', 'POST /admin/transaksi/:kode/aksi oleh wisatawan', 'Ditolak (403/redirect)', `HTTP ${r.status}; status = ${st(kodeKelola).status}`, st(kodeKelola).status === 'pending');
  r = await staff.get('/petugas/pesanan?q=' + encodeURIComponent(kodeKelola));
  rec('BB-48', 'Kelola Pesanan', 'Petugas mencari pesanan berdasarkan kode', 'GET /petugas/pesanan?q=kode', 'Pesanan ditemukan dan tombol aksi tampil', `HTTP ${r.status}`, r.status === 200 && r.text.includes(kodeKelola) && r.text.includes('Tandai lunas'));
  r = await admin.get('/admin/transaksi?q=' + encodeURIComponent(kodeKelola));
  rec('BB-49', 'Kelola Pesanan', 'Admin mencari transaksi berdasarkan kode', 'GET /admin/transaksi?q=kode', 'Hanya pesanan terkait yang tampil', `HTTP ${r.status}`, r.status === 200 && r.text.includes(kodeKelola));

  // ---- Jadwal ulang pesanan (admin) ----
  const hari2 = U.dateOffset(2), slot2 = U.slots(dest.open_time, dest.close_time, dest.slot_hours, hari2)[0];
  const kodeJ = await mk();
  r = await admin.post('/admin/transaksi/' + kodeJ + '/jadwal', { date: hari2, slot: slot2 });
  let bj = db.prepare('SELECT visit_date,visit_slot FROM bookings WHERE code=?').get(kodeJ);
  rec('BB-60', 'Jadwal Ulang', 'Admin menjadwal ulang pesanan yang menunggu bayar', 'POST /admin/transaksi/:kode/jadwal', 'Tanggal dan sesi berubah', `jadwal = ${bj.visit_date} ${bj.visit_slot}`, bj.visit_date === hari2 && bj.visit_slot === slot2);
  await admin.post('/admin/transaksi/' + kodeJ + '/aksi', { aksi: 'lunas' });
  const q1 = db.prepare('SELECT q.queue_date, q.queue_number FROM queues q JOIN bookings b ON b.id=q.booking_id WHERE b.code=?').get(kodeJ);
  r = await admin.post('/admin/transaksi/' + kodeJ + '/jadwal', { date: tomorrow, slot });
  const q2 = db.prepare('SELECT q.queue_date, q.queue_number FROM queues q JOIN bookings b ON b.id=q.booking_id WHERE b.code=?').get(kodeJ);
  rec('BB-61', 'Jadwal Ulang', 'Jadwal ulang pesanan lunas memindahkan nomor antrian ke tanggal baru', 'jadwal pada pesanan lunas', 'Antrian dibuat ulang di tanggal baru, e-tiket tetap', `antrian ${q1.queue_date} -> ${q2.queue_date}`, q1.queue_date === hari2 && q2.queue_date === tomorrow);
  r = await admin.post('/admin/transaksi/' + kodeJ + '/jadwal', { date: U.dateOffset(-1), slot });
  bj = db.prepare('SELECT visit_date FROM bookings WHERE code=?').get(kodeJ);
  rec('BB-62', 'Jadwal Ulang', 'Jadwal ulang ke tanggal yang sudah lewat ditolak', 'date = kemarin', 'Ditolak, jadwal tetap', `jadwal = ${bj.visit_date}`, bj.visit_date === tomorrow);
  r = await admin.post('/admin/transaksi/' + kodeJ + '/jadwal', { date: hari2, slot: '03:00 - 04:00' });
  bj = db.prepare('SELECT visit_date FROM bookings WHERE code=?').get(kodeJ);
  rec('BB-63', 'Jadwal Ulang', 'Sesi di luar jam operasional ditolak', 'slot = 03:00 - 04:00', 'Ditolak, jadwal tetap', `jadwal = ${bj.visit_date}`, bj.visit_date === tomorrow);
  r = await staff.post('/admin/transaksi/' + kodeJ + '/jadwal', { date: hari2, slot: slot2 });
  bj = db.prepare('SELECT visit_date FROM bookings WHERE code=?').get(kodeJ);
  rec('BB-64', 'Jadwal Ulang', 'Petugas tidak boleh menjadwal ulang pesanan', 'POST jadwal oleh petugas', 'Ditolak (403), jadwal tetap', `HTTP ${r.status}; jadwal = ${bj.visit_date}`, bj.visit_date === tomorrow);

  // ---- Foto destinasi ----
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  const up = async (cl, buf, type) => { const fd = new FormData(); fd.append('foto', new Blob([buf], { type }), 'x.jpg'); const x = await fetch(base + '/admin/wisata/' + tdest2.id + '/foto', { method: 'POST', headers: { cookie: cl.cookie, 'x-csrf-token': cl.csrf }, body: fd }); return { status: x.status, json: await x.json().catch(() => ({})) }; };
  await admin.post('/admin/wisata', { code: 'ZZ', name: 'Destinasi Foto Uji', category: 'Uji', description: '', address: '', open_time: '08:00', close_time: '17:00', slot_hours: 2, price_adult: 1000, price_child: 500, daily_quota: 10, icon: 'bi-camera-fill', color: '#0f5c4d', is_active: 'on' });
  const tdest2 = db.prepare("SELECT * FROM destinations WHERE code='ZZ'").get();
  let u1 = await up(admin, jpg, 'image/jpeg');
  const photoPath = path.join(__dirname, '..', 'public', 'img', 'dest', 'ZZ.jpg');
  rec('BB-50', 'Foto Destinasi', 'Admin mengunggah foto JPG destinasi', 'POST /admin/wisata/:id/foto (JPEG)', 'Foto tersimpan sebagai ZZ.jpg', `HTTP ${u1.status}; berkas ada = ${fs.existsSync(photoPath)}`, u1.status === 200 && fs.existsSync(photoPath));
  u1 = await up(admin, Buffer.from('bukan gambar, hanya teks'), 'image/jpeg');
  rec('BB-51', 'Foto Destinasi', 'Unggah berkas yang bukan JPEG ditolak', 'Berkas teks bernama .jpg', 'Ditolak (400)', `HTTP ${u1.status}`, u1.status === 400);
  u1 = await up(user, jpg, 'image/jpeg');
  rec('BB-52', 'Foto Destinasi', 'Wisatawan tidak boleh mengunggah foto destinasi', 'POST foto oleh wisatawan', 'Ditolak (403/redirect)', `HTTP ${u1.status}`, u1.status !== 200);
  await admin.post('/admin/wisata/' + tdest2.id + '/foto/hapus', {}, { noCsrf: false });
  rec('BB-53', 'Foto Destinasi', 'Admin menghapus foto destinasi', 'POST /admin/wisata/:id/foto/hapus', 'Berkas foto terhapus', `berkas ada = ${fs.existsSync(photoPath)}`, !fs.existsSync(photoPath));
  await admin.post('/admin/wisata/' + tdest2.id + '/hapus', {});

  // ---- Tampilan: akun demo tidak boleh tampil di halaman login ----
  r = await new Client(base).get('/login');
  rec('BB-54', 'Keamanan', 'Halaman login tidak membocorkan akun demo', 'GET /login', 'Tidak ada email/password demo di HTML', `HTTP ${r.status}`, r.status === 200 && !/admin123|petugas123|pengunjung123|@smarttour\.id/.test(r.text));


  // ---- Akun saya ----
  const ak = new Client(base); await ak.get('/register');
  await ak.post('/register', { name: 'Akun Uji', email: 'akun.uji@mail.com', phone: '', password: 'lama123', confirm: 'lama123' });
  await ak.post('/login', { email: 'akun.uji@mail.com', password: 'lama123' });
  await ak.get('/akun'); // segarkan token CSRF setelah sesi baru
  r = await ak.post('/akun/profil', { name: 'Akun Uji Baru', phone: '081234567890' });
  const urow = db.prepare("SELECT name,phone FROM users WHERE email='akun.uji@mail.com'").get();
  rec('BB-55', 'Akun Saya', 'Pengguna mengubah nama dan nomor HP', 'POST /akun/profil', 'Data profil tersimpan', `HTTP ${r.status}; nama = ${urow.name}; hp = ${urow.phone}`, urow.name === 'Akun Uji Baru' && urow.phone === '081234567890');
  r = await ak.post('/akun/profil', { name: 'Ab', phone: 'huruf' });
  rec('BB-56', 'Akun Saya', 'Validasi profil: nama pendek dan HP bukan angka', 'POST /akun/profil nama="Ab"', 'Ditolak (400), data tidak berubah', `HTTP ${r.status}`, r.status === 400 && db.prepare("SELECT name FROM users WHERE email='akun.uji@mail.com'").get().name === 'Akun Uji Baru');
  r = await ak.post('/akun/password', { current: 'salah999', password: 'baru1234', confirm: 'baru1234' });
  rec('BB-57', 'Akun Saya', 'Ganti password dengan password lama yang salah ditolak', 'POST /akun/password current salah', 'Ditolak (400), password tidak berubah', `HTTP ${r.status}`, r.status === 400);
  r = await ak.post('/akun/password', { current: 'lama123', password: 'baru1234', confirm: 'baru1234' });
  const relog = new Client(base); await relog.get('/login');
  const lamaGagal = await relog.post('/login', { email: 'akun.uji@mail.com', password: 'lama123' });
  const baruOk = await relog.post('/login', { email: 'akun.uji@mail.com', password: 'baru1234' });
  rec('BB-58', 'Akun Saya', 'Ganti password berhasil, password lama tidak berlaku lagi', 'POST /akun/password lalu login ulang', 'Login password lama gagal, password baru berhasil', `lama = HTTP ${lamaGagal.status}; baru = HTTP ${baruOk.status}`, lamaGagal.status === 401 && baruOk.status === 302);
  r = await new Client(base).get('/akun');
  rec('BB-59', 'Akun Saya', 'Halaman akun tidak dapat dibuka tanpa login', 'GET /akun tanpa sesi', 'Diarahkan ke halaman login', `HTTP ${r.status}; ke ${r.loc}`, r.status === 302 && /login/.test(r.loc || ''));

  // ---- Tiga akun uji & data awal ----
  const roleCases = [['admin@smarttour.id', 'admin123', '/admin', 'Admin'], ['petugas@smarttour.id', 'petugas123', '/petugas', 'Petugas'], ['pengunjung@smarttour.id', 'pengunjung123', '/', 'Pengunjung']];
  const roleLogins = [];
  for (const [em, pw, to, label] of roleCases) {
    const rc = new Client(base); const rr = await rc.login(em, pw); roleLogins.push(rc);
    rec('BB-65' + label[0], 'Akun uji', `Login "Tiwy as ${label}"`, `${em} / ${pw}`, `Diarahkan ke ${to}`, `HTTP ${rr.status} → ${rr.loc}`, rr.status === 302 && rr.loc === to);
  }
  const cn = (sql) => db.prepare(sql).get().c;
  const nUsers = cn("SELECT COUNT(*) c FROM users WHERE email IN ('admin@smarttour.id','petugas@smarttour.id','pengunjung@smarttour.id')");
  rec('BB-66', 'Data awal', 'Tiga akun uji tersedia dengan peran berbeda', 'admin, petugas, user', '3 akun, peran admin/petugas/user', `${nUsers} akun`, nUsers === 3 && cn("SELECT COUNT(DISTINCT role) c FROM users WHERE email LIKE '%@smarttour.id'") === 3);
  rec('BB-67', 'Data awal', 'Data awal ringkas', 'seed', 'Destinasi bawaan 6 buah', `destinasi bawaan: ${cn("SELECT COUNT(*) c FROM destinations WHERE code IN ('IM','MR','MN','TF','RW','DT')")}`, cn("SELECT COUNT(*) c FROM destinations WHERE code IN ('IM','MR','MN','TF','RW','DT')") === 6);
  const [, staffC, userC] = roleLogins;
  r = await staffC.get('/petugas/pesanan'); const r2 = await userC.get('/tiket');
  rec('BB-68', 'Akun uji', 'Halaman utama tiap peran terbuka (petugas: pesanan, pengunjung: tiket)', 'GET /petugas/pesanan, GET /tiket', 'HTTP 200 keduanya', `petugas ${r.status}; pengunjung ${r2.status}`, r.status === 200 && r2.status === 200);
  r = await userC.get('/petugas'); const r3 = await staffC.get('/admin');
  rec('BB-69', 'Hak akses', 'Pengunjung ke /petugas dan petugas ke /admin ditolak', 'GET /petugas (pengunjung), GET /admin (petugas)', 'HTTP 403 keduanya', `${r.status}; ${r3.status}`, r.status === 403 && r3.status === 403);

  // ---- Sesi mengikuti database ----
  const tmpEmail = 'sesi' + Date.now() + '@mail.com';
  await admin.post('/admin/pengguna', { name: 'Petugas Sementara', email: tmpEmail, phone: '', role: 'petugas', password: 'sementara1' });
  const tmpUser = new Client(base); await tmpUser.login(tmpEmail, 'sementara1');
  const tmpId = db.prepare('SELECT id FROM users WHERE email=?').get(tmpEmail).id;
  r = await tmpUser.get('/petugas');
  const before = r.status;
  await admin.post('/admin/pengguna/' + tmpId, { name: 'Petugas Sementara', email: tmpEmail, phone: '', role: 'user', password: '' });
  r = await tmpUser.get('/petugas');
  rec('BB-70', 'Hak akses', 'Peran diturunkan admin langsung berlaku tanpa login ulang', 'ubah petugas → pengunjung, akses /petugas', 'Sebelum 200, sesudah 403', `sebelum ${before}; sesudah ${r.status}`, before === 200 && r.status === 403);
  await admin.post('/admin/pengguna/' + tmpId + '/hapus', {});
  r = await tmpUser.get('/tiket');
  rec('BB-71', 'Hak akses', 'Akun yang dihapus admin otomatis keluar', 'hapus akun lalu GET /tiket', 'Diarahkan ke /login', `HTTP ${r.status} → ${r.loc}`, r.status === 302 && /login/.test(r.loc || ''));

  // ---- Keamanan ----
  r = await user.post('/pesan', { destination_id: dest.id, visit_date: tomorrow, visit_slot: slot, qty_adult: 1 }, { noCsrf: true });
  rec('BB-38', 'Keamanan', 'POST tanpa token CSRF', 'POST /pesan tanpa _csrf', 'Ditolak (403)', `HTTP ${r.status}`, r.status === 403);
  const xss = '<script>alert(1)</script>';
  const xc = new Client(base); await xc.get('/register');
  await xc.post('/register', { name: xss + ' Tester', email: 'xss' + Date.now() + '@mail.com', phone: '', password: 'rahasia1', confirm: 'rahasia1' });
  r = await admin.get('/admin/pengguna');
  const esc = r.text.includes('&lt;script&gt;') && !r.text.includes(xss);
  rec('BB-39', 'Keamanan', 'Input mengandung tag script (XSS)', xss, 'Output di-escape, script tidak dieksekusi', esc ? 'Tag di-escape' : 'Tag lolos', esc);
  const sc = new Client(base);
  for (let i = 0; i < 5; i++) await sc.login('pengunjung@smarttour.id', 'salah' + i);
  r = await sc.login('pengunjung@smarttour.id', 'pengunjung123');
  rec('BB-40', 'Keamanan', 'Brute force: 5x gagal lalu login benar', '5 kali password salah', 'Akun dikunci sementara (429)', `HTTP ${r.status}`, r.status === 429);

  server.close();
  const fail = results.filter((x) => x.status !== 'Berhasil');
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  console.log(results.map((x) => `${x.id}  ${x.status.padEnd(9)} ${x.skenario}  [${x.aktual}]`).join('\n'));
  console.log(`\nTotal ${results.length} kasus, berhasil ${results.length - fail.length}, gagal ${fail.length}`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

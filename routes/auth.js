const router = require('express').Router();
const { requireLogin } = require('../lib/middleware');
const bcrypt = require('bcryptjs');
const db = require('../db');
const U = require('../lib/util');

const attempts = new Map(); // pembatasan percobaan login sederhana
function tooMany(key) {
  const rec = attempts.get(key);
  return rec && rec.count >= 5 && Date.now() - rec.first < 15 * 60 * 1000;
}
function addFail(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count++;
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'Masuk', email: '' });
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = email + '|' + req.ip;
  if (tooMany(key)) return res.status(429).render('auth/login', { title: 'Masuk', email, error: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.' });
  if (!email || !password) return res.status(400).render('auth/login', { title: 'Masuk', email, error: 'Email dan password wajib diisi.' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !bcrypt.compareSync(password, u.password)) {
    addFail(key);
    return res.status(401).render('auth/login', { title: 'Masuk', email, error: 'Email atau password salah.' });
  }
  attempts.delete(key);
  const returnTo = req.session.returnTo;
  req.session.regenerate(() => {
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    req.session.flash = { type: 'success', text: `Selamat datang, ${u.name}!` };
    if (u.role === 'admin') return res.redirect('/admin');
    if (u.role === 'petugas') return res.redirect('/petugas');
    res.redirect(returnTo && returnTo.startsWith('/') ? returnTo : '/');
  });
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'Daftar Akun', form: {}, errors: [] });
});

router.post('/register', (req, res) => {
  const f = { name: String(req.body.name || '').trim(), email: String(req.body.email || '').trim().toLowerCase(), phone: String(req.body.phone || '').trim() };
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const errors = [];
  if (f.name.length < 3) errors.push('Nama minimal 3 karakter.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.push('Format email tidak valid.');
  if (f.phone && !/^[0-9+]{8,15}$/.test(f.phone)) errors.push('Nomor HP hanya boleh angka (8-15 digit).');
  if (password.length < 6) errors.push('Password minimal 6 karakter.');
  if (password !== confirm) errors.push('Konfirmasi password tidak sama.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email=?').get(f.email)) errors.push('Email sudah terdaftar.');
  if (errors.length) return res.status(400).render('auth/register', { title: 'Daftar Akun', form: f, errors });
  db.prepare("INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?, 'user', ?)")
    .run(f.name, f.email, f.phone, bcrypt.hashSync(password, 10), U.nowStr());
  req.session.flash = { type: 'success', text: 'Pendaftaran berhasil. Silakan login.' };
  res.redirect('/login');
});


// ---------- Akun saya: ubah profil & ganti password (semua peran) ----------
const akunView = (req, res, extra = {}) => {
  const me = db.prepare('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?').get(req.session.user.id);
  res.status(extra.status || 200).render('akun', { title: 'Akun Saya', me, errProfil: [], errPass: [], ...extra });
};
router.get('/akun', requireLogin, (req, res) => akunView(req, res));

router.post('/akun/profil', requireLogin, (req, res) => {
  const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim();
  const errors = [];
  if (name.length < 3) errors.push('Nama minimal 3 karakter.');
  if (phone && !/^[0-9+]{8,15}$/.test(phone)) errors.push('Nomor HP hanya boleh angka (8-15 digit).');
  if (errors.length) return akunView(req, res, { status: 400, errProfil: errors, form: { name, phone } });
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.session.user.id);
  req.session.user.name = name;
  req.session.flash = { type: 'success', text: 'Profil berhasil diperbarui.' };
  res.redirect('/akun');
});

router.post('/akun/password', requireLogin, (req, res) => {
  const cur = String(req.body.current || ''), pw = String(req.body.password || ''), confirm = String(req.body.confirm || '');
  const key = 'pw|' + req.session.user.id;
  if (tooMany(key)) return akunView(req, res, { status: 429, errPass: ['Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.'] });
  const u = db.prepare('SELECT password FROM users WHERE id=?').get(req.session.user.id);
  const errors = [];
  if (!bcrypt.compareSync(cur, u.password)) { addFail(key); errors.push('Password saat ini salah.'); }
  if (pw.length < 6) errors.push('Password baru minimal 6 karakter.');
  if (pw !== confirm) errors.push('Konfirmasi password baru tidak sama.');
  if (!errors.length && pw === cur) errors.push('Password baru tidak boleh sama dengan password lama.');
  if (errors.length) return akunView(req, res, { status: 400, errPass: errors });
  attempts.delete(key);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.session.user.id);
  req.session.flash = { type: 'success', text: 'Password berhasil diganti.' };
  res.redirect('/akun');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;

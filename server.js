process.env.TZ = process.env.TZ || 'Asia/Jakarta';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const db = require('./db');
const U = require('./lib/util');
const B = require('./lib/booking');
const { csrf, flash } = require('./lib/middleware');

const app = express();
const nm = (p) => path.join(__dirname, 'node_modules', p);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
// Di balik proxy HTTPS (Render, Railway, Nginx, Caddy, dsb.) cookie sesi ditandai secure otomatis.
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use('/vendor/bootstrap', express.static(nm('bootstrap/dist')));
app.use('/vendor/icons', express.static(nm('bootstrap-icons/font')));
app.use('/vendor/chart', express.static(nm('chart.js/dist')));
app.use('/vendor/qrscan', express.static(nm('html5-qrcode')));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (/\.(css|js)$/.test(file) || /manifest\.json$/.test(file) || /offline\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    if (/manifest\.json$/.test(file)) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    if (/\.woff2$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ganti-secret-ini-saat-produksi',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 },
}));

app.use((req, res, next) => {
  B.expireOldBookings();
  // Sinkronkan sesi dengan database: akun yang dihapus langsung keluar, perubahan peran langsung berlaku.
  if (req.session.user) {
    const fresh = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.session.user.id);
    if (fresh) req.session.user = fresh; else delete req.session.user;
  }
  res.locals.currentUser = req.session.user || null;
  res.locals.U = U;
  res.locals.hero = false;
  res.locals.pendingCount = 0;
  if (req.session.user && ['admin', 'petugas'].includes(req.session.user.role)) {
    try { res.locals.pendingCount = require('./db').prepare("SELECT COUNT(*) c FROM bookings WHERE status='pending'").get().c; } catch (e) { /* abaikan */ }
  }
  res.locals.hasPhoto = (code) => fs.existsSync(path.join(__dirname, 'public', 'img', 'dest', code + '.jpg'));
  // alamat foto + versi (waktu ubah file) agar foto yang baru diunggah langsung tampil, bukan dari cache
  res.locals.photoUrl = (code) => {
    try { return '/img/dest/' + code + '.jpg?v=' + Math.round(fs.statSync(path.join(__dirname, 'public', 'img', 'dest', code + '.jpg')).mtimeMs); } catch (e) { return null; }
  };
  res.locals.B = B;
  res.locals.path = req.path;
  res.locals.title = 'Medan Smart Tourism';
  next();
});
app.use(flash); // flash harus sebelum csrf agar halaman error 403 dapat dirender
app.use(csrf);

app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/user'));
app.use('/', require('./routes/staff'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Halaman yang Anda cari tidak ditemukan.' }));
app.use((err, req, res, next) => { // eslint-disable-line
  console.error(err);
  if (req.originalUrl.startsWith('/api/')) return res.status(500).json({ ok: false, message: 'Terjadi kesalahan server.' });
  res.status(500).render('error', { title: 'Kesalahan Server', code: 500, message: 'Terjadi kesalahan pada server. Silakan coba lagi.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Medan Smart Tourism berjalan di http://localhost:${PORT}`));
}
module.exports = app;

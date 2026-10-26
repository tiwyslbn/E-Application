const crypto = require('crypto');

exports.requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.session.flash = { type: 'warning', text: 'Silakan login terlebih dahulu.' };
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ ok: false, message: 'Belum login.' });
  res.redirect('/login');
};

exports.requireRole = (...roles) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return exports.requireLogin(req, res, next);
  if (roles.includes(u.role)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ ok: false, message: 'Akses ditolak.' });
  res.status(403).render('error', { title: 'Akses Ditolak', code: 403, message: 'Anda tidak memiliki hak akses ke halaman ini.' });
};

// Proteksi CSRF sederhana berbasis token sesi
exports.csrf = (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  res.locals.csrfField = `<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (sent !== req.session.csrf) {
      if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ ok: false, message: 'Token CSRF tidak valid.' });
      return res.status(403).render('error', { title: 'Permintaan Ditolak', code: 403, message: 'Token keamanan (CSRF) tidak valid. Muat ulang halaman dan coba lagi.' });
    }
  }
  next();
};

exports.flash = (req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
};

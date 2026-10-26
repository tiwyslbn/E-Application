const router = require('express').Router();
const db = require('../db');
const U = require('../lib/util');
const B = require('../lib/booking');

function destList(q, kategori) {
  let sql = 'SELECT * FROM destinations WHERE is_active=1';
  const p = [];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  if (kategori) { sql += ' AND category=?'; p.push(kategori); }
  sql += ' ORDER BY id';
  const today = U.todayStr();
  return db.prepare(sql).all(...p).map((d) => ({ ...d, remaining: B.remainingQuota(d.id, today) }));
}

router.get('/', (req, res) => {
  const destinations = destList();
  const today = U.todayStr();
  const stats = {
    destinasi: db.prepare('SELECT COUNT(*) c FROM destinations WHERE is_active=1').get().c,
    tiketHariIni: db.prepare("SELECT COALESCE(SUM(qty_adult+qty_child),0) c FROM bookings WHERE status='paid' AND visit_date=?").get(today).c,
    wisatawan: db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
  };
  const categories = db.prepare('SELECT DISTINCT category FROM destinations WHERE is_active=1 ORDER BY category').all().map((r) => r.category);
  res.render('index', { title: 'Medan Smart Tourism', destinations, stats, categories, hero: true });
});

router.get('/wisata', (req, res) => {
  const q = (req.query.q || '').trim();
  const kategori = (req.query.kategori || '').trim();
  const categories = db.prepare('SELECT DISTINCT category FROM destinations WHERE is_active=1 ORDER BY category').all().map((r) => r.category);
  res.render('wisata/list', { title: 'Daftar Wisata', destinations: destList(q, kategori), categories, q, kategori });
});

router.get('/wisata/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM destinations WHERE id=? AND is_active=1').get(req.params.id);
  if (!d) return res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Destinasi tidak ditemukan.' });
  res.render('wisata/detail', {
    title: d.name, d, today: U.todayStr(), maxDate: U.dateOffset(B.BOOKING_WINDOW_DAYS),
    remaining: B.remainingQuota(d.id, U.todayStr()),
  });
});

// Info kuota & sesi untuk tanggal tertentu (dipakai form pemesanan)
router.get('/api/kuota', (req, res) => {
  const d = db.prepare('SELECT * FROM destinations WHERE id=? AND is_active=1').get(req.query.dest);
  const date = req.query.date;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ ok: false });
  res.json({ ok: true, remaining: B.remainingQuota(d.id, date), slots: U.slots(d.open_time, d.close_time, d.slot_hours, date) });
});

function board(date) {
  return db.prepare('SELECT * FROM destinations WHERE is_active=1 ORDER BY id').all().map((d) => {
    const serving = db.prepare("SELECT queue_number n FROM queues WHERE destination_id=? AND queue_date=? AND status='called' ORDER BY called_at DESC, queue_number DESC LIMIT 1").get(d.id, date);
    const waiting = db.prepare("SELECT COUNT(*) c FROM queues WHERE destination_id=? AND queue_date=? AND status='waiting'").get(d.id, date).c;
    const total = db.prepare('SELECT COUNT(*) c FROM queues WHERE destination_id=? AND queue_date=?').get(d.id, date).c;
    return { id: d.id, code: d.code, name: d.name, icon: d.icon, color: d.color, serving: serving ? B.queueLabel(d.code, serving.n) : null, waiting, total };
  });
}

router.get('/antrian', (req, res) => res.render('antrian/board', { title: 'Papan Antrian', rows: board(U.todayStr()), today: U.todayStr() }));
router.get('/api/antrian', (req, res) => res.json({ ok: true, rows: board(U.todayStr()) }));

module.exports = router;
module.exports.board = board;

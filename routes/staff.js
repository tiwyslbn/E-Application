const router = require('express').Router();
const db = require('../db');
const U = require('../lib/util');
const B = require('../lib/booking');
const { requireRole } = require('../lib/middleware');
const { board } = require('./public');

const staff = requireRole('petugas', 'admin');

router.get('/petugas', staff, (req, res) => {
  const today = U.todayStr();
  const rows = db.prepare('SELECT * FROM destinations WHERE is_active=1 ORDER BY id').all().map((d) => {
    const sold = db.prepare("SELECT COALESCE(SUM(qty_adult+qty_child),0) c FROM bookings WHERE destination_id=? AND visit_date=? AND status='paid'").get(d.id, today).c;
    const inside = db.prepare(`SELECT COALESCE(SUM(b.qty_adult+b.qty_child),0) c FROM tickets t JOIN bookings b ON b.id=t.booking_id
      WHERE b.destination_id=? AND b.visit_date=? AND t.status='used'`).get(d.id, today).c;
    const waiting = db.prepare("SELECT COUNT(*) c FROM queues WHERE destination_id=? AND queue_date=? AND status='waiting'").get(d.id, today).c;
    return { ...d, sold, inside, waiting };
  });
  const recent = db.prepare(`SELECT t.checkin_at, t.ticket_code, d.name dest_name, u.name visitor, b.qty_adult+b.qty_child persons
    FROM tickets t JOIN bookings b ON b.id=t.booking_id JOIN destinations d ON d.id=b.destination_id JOIN users u ON u.id=b.user_id
    WHERE t.status='used' AND t.checkin_at >= ? ORDER BY t.checkin_at DESC LIMIT 8`).all(today + ' 00:00:00');
  res.render('petugas/dashboard', { title: 'Dashboard Petugas', rows, recent, today, pendingCount: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='pending'").get().c });
});

router.get('/petugas/scan', staff, (req, res) => res.render('petugas/scan', { title: 'Scan Check-in' }));

router.post('/api/checkin', staff, (req, res) => {
  const r = B.checkIn(req.body.code, req.session.user.id);
  const t = r.ticket;
  res.status(r.ok || r.code !== 'NOT_FOUND' ? 200 : 404).json({
    ok: r.ok, code: r.code || 'OK', message: r.message,
    ticket: t ? {
      booking_code: t.booking_code, visitor: t.visitor, destination: t.dest_name, visit_date: U.tanggalPendek(t.visit_date),
      visit_slot: t.visit_slot, adult: t.qty_adult, child: t.qty_child, queue: t.queue_number ? B.queueLabel(t.dest_code, t.queue_number) : null,
    } : null,
  });
});

// ---- Manajemen antrian ----
router.get('/petugas/antrian', staff, (req, res) => {
  const dests = db.prepare('SELECT id,code,name FROM destinations WHERE is_active=1 ORDER BY id').all();
  if (!dests.length) { req.session.flash = { type: 'info', text: 'Belum ada destinasi aktif.' }; return res.redirect('/petugas'); }
  const destId = Number(req.query.dest) || dests[0].id;
  const dest = dests.find((d) => d.id === destId) || dests[0];
  const today = U.todayStr();
  const list = db.prepare(`SELECT q.*, b.code booking_code, b.visit_slot, b.qty_adult+b.qty_child persons, u.name visitor, t.status ticket_status
    FROM queues q JOIN bookings b ON b.id=q.booking_id JOIN users u ON u.id=b.user_id LEFT JOIN tickets t ON t.booking_id=b.id
    WHERE q.destination_id=? AND q.queue_date=? ORDER BY q.queue_number`).all(dest.id, today);
  const serving = db.prepare("SELECT queue_number n FROM queues WHERE destination_id=? AND queue_date=? AND status='called' ORDER BY called_at DESC, queue_number DESC LIMIT 1").get(dest.id, today);
  res.render('petugas/antrian', { title: 'Manajemen Antrian', dests, dest, list, servingLabel: serving ? B.queueLabel(dest.code, serving.n) : null, today });
});

router.post('/petugas/antrian/panggil', staff, (req, res) => {
  const destId = Number(req.body.dest);
  if (!destId) { req.session.flash = { type: 'warning', text: 'Destinasi tidak valid.' }; return res.redirect('/petugas/antrian'); }
  const next = db.prepare("SELECT id FROM queues WHERE destination_id=? AND queue_date=? AND status='waiting' ORDER BY queue_number LIMIT 1").get(destId, U.todayStr());
  if (!next) req.session.flash = { type: 'info', text: 'Tidak ada antrian yang menunggu.' };
  else {
    db.prepare("UPDATE queues SET status='called', called_at=? WHERE id=?").run(U.nowStr(), next.id);
    req.session.flash = { type: 'success', text: 'Antrian berikutnya dipanggil.' };
  }
  res.redirect('/petugas/antrian?dest=' + destId);
});

router.post('/petugas/antrian/:id/lewati', staff, (req, res) => {
  const q = db.prepare('SELECT * FROM queues WHERE id=?').get(req.params.id);
  if (q && ['waiting', 'called'].includes(q.status)) db.prepare("UPDATE queues SET status='skipped' WHERE id=?").run(q.id);
  req.session.flash = { type: 'info', text: 'Antrian dilewati.' };
  res.redirect('/petugas/antrian?dest=' + (q ? q.destination_id : ''));
});

// ---- Pesanan: cari, lunasi (bayar tunai di loket), batalkan, check-in manual ----
router.get('/petugas/pesanan', staff, (req, res) => {
  const term = String(req.query.q || '').trim();
  const f = ['today', 'pending', 'all'].includes(req.query.f) ? req.query.f : (term ? 'all' : 'today');
  let where = '1=1'; const p = [];
  if (f === 'today') { where += ' AND b.visit_date=?'; p.push(U.todayStr()); }
  if (f === 'pending') where += " AND b.status='pending'";
  if (term) {
    where += ' AND (b.code LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR t.ticket_code LIKE ?)';
    const like = `%${term}%`; p.push(like, like, like, like, like);
  }
  const rows = db.prepare(`SELECT b.*, d.name dest_name, d.code dest_code, d.icon, d.color, u.name visitor, u.phone, t.status ticket_status, q.queue_number
    FROM bookings b JOIN destinations d ON d.id=b.destination_id JOIN users u ON u.id=b.user_id
    LEFT JOIN tickets t ON t.booking_id=b.id LEFT JOIN queues q ON q.booking_id=b.id
    WHERE ${where} ORDER BY (b.status='pending') DESC, b.id DESC LIMIT 100`).all(...p)
    .map((r) => ({ ...r, actions: B.availableActions(r, r.ticket_status, 'petugas') }));
  const pendingCount = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='pending'").get().c;
  res.render('petugas/pesanan', { title: 'Pesanan', rows, q: term, f, pendingCount, ACTION_LABEL: B.ACTION_LABEL });
});

router.post('/petugas/pesanan/:code/aksi', staff, (req, res) => {
  const r = B.manageBooking(req.params.code, String(req.body.aksi || ''), req.session.user);
  req.session.flash = r.ok ? { type: 'success', text: r.message } : { type: 'warning', text: r.error };
  const back = '/petugas/pesanan' + (req.body.back && /^\?[\w=&%.+-]*$/.test(req.body.back) ? req.body.back : '');
  res.redirect(back);
});

module.exports = router;

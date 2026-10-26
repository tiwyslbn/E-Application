const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db');
const U = require('../lib/util');
const B = require('../lib/booking');
const { requireRole } = require('../lib/middleware');

const onlyUser = requireRole('user');

function getOwnBooking(req, res) {
  const b = db.prepare(`SELECT b.*, d.name dest_name, d.code dest_code, d.icon, d.color FROM bookings b
    JOIN destinations d ON d.id=b.destination_id WHERE b.code=? AND b.user_id=?`).get(req.params.code, req.session.user.id);
  if (!b) res.status(404).render('error', { title: 'Tidak Ditemukan', code: 404, message: 'Pesanan tidak ditemukan.' });
  return b;
}

// ---- Pemesanan ----
router.post('/pesan', onlyUser, (req, res) => {
  const r = B.createBooking({
    userId: req.session.user.id, destId: req.body.destination_id, date: req.body.visit_date,
    slot: req.body.visit_slot, adult: req.body.qty_adult, child: req.body.qty_child,
  });
  if (!r.ok) {
    req.session.flash = { type: 'danger', text: r.error };
    return res.redirect('/wisata/' + encodeURIComponent(req.body.destination_id || ''));
  }
  res.redirect('/bayar/' + r.code);
});

// ---- Pembayaran (simulasi payment gateway) ----
router.get('/bayar/:code', onlyUser, (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  if (b.status === 'paid') return res.redirect('/tiket/' + b.code);
  const pay = db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
  res.render('booking/payment', { title: 'Pembayaran', b, pay, methods: B.PAYMENT_METHODS });
});

router.post('/bayar/:code', onlyUser, (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  const r = B.startPayment(b, String(req.body.method || ''));
  if (!r.ok) { req.session.flash = { type: 'danger', text: r.error }; return res.redirect('/bayar/' + b.code); }
  res.redirect(`/bayar/${b.code}/gateway`);
});

router.get('/bayar/:code/gateway', onlyUser, async (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  const pay = db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
  if (b.status === 'paid') return res.redirect('/tiket/' + b.code);
  if (b.status !== 'pending' || !pay) { req.session.flash = { type: 'warning', text: 'Silakan pilih metode pembayaran.' }; return res.redirect('/bayar/' + b.code); }
  const qr = pay.method === 'QRIS' ? await QRCode.toDataURL(`QRIS-SANDBOX|${pay.reference}|${pay.amount}`, { width: 240, margin: 1 }) : null;
  res.render('booking/gateway', { title: 'Gateway Pembayaran (Sandbox)', b, pay, qr });
});

router.post('/bayar/:code/konfirmasi', onlyUser, (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  const r = B.confirmPayment(b.id);
  if (!r.ok) { req.session.flash = { type: 'danger', text: r.error }; return res.redirect('/bayar/' + b.code); }
  req.session.flash = { type: 'success', text: 'Pembayaran berhasil! E-tiket dan nomor antrian Anda sudah terbit.' };
  res.redirect('/tiket/' + b.code);
});

router.post('/bayar/:code/batal', onlyUser, (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  const r = B.cancelBooking(b);
  req.session.flash = r.ok ? { type: 'info', text: 'Pesanan dibatalkan.' } : { type: 'danger', text: r.error };
  res.redirect('/tiket');
});

// ---- Tiket Saya ----
router.get('/tiket', onlyUser, (req, res) => {
  const rows = db.prepare(`SELECT b.*, d.name dest_name, d.code dest_code, d.icon, d.color, t.status ticket_status, q.queue_number
    FROM bookings b JOIN destinations d ON d.id=b.destination_id
    LEFT JOIN tickets t ON t.booking_id=b.id LEFT JOIN queues q ON q.booking_id=b.id
    WHERE b.user_id=? ORDER BY b.id DESC LIMIT 50`).all(req.session.user.id);
  res.render('tiket/list', { title: 'Tiket Saya', rows });
});

router.get('/tiket/:code', onlyUser, async (req, res) => {
  const b = getOwnBooking(req, res); if (!b) return;
  if (b.status === 'pending') return res.redirect('/bayar/' + b.code);
  const t = db.prepare('SELECT * FROM tickets WHERE booking_id=?').get(b.id);
  const q = db.prepare('SELECT * FROM queues WHERE booking_id=?').get(b.id);
  const pay = db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
  const qr = t ? await QRCode.toDataURL(t.ticket_code, { width: 260, margin: 1, errorCorrectionLevel: 'M' }) : null;
  res.render('tiket/detail', { title: 'E-Tiket ' + b.code, b, t, q, pay, qr, queueLabel: q ? B.queueLabel(b.dest_code, q.queue_number) : null });
});

// Status antrian milik user (polling)
router.get('/api/antrian/saya/:code', onlyUser, (req, res) => {
  const b = db.prepare('SELECT b.*, d.code dest_code FROM bookings b JOIN destinations d ON d.id=b.destination_id WHERE b.code=? AND b.user_id=?')
    .get(req.params.code, req.session.user.id);
  if (!b) return res.status(404).json({ ok: false });
  const q = db.prepare('SELECT * FROM queues WHERE booking_id=?').get(b.id);
  if (!q) return res.json({ ok: true, hasQueue: false });
  const serving = db.prepare("SELECT queue_number n FROM queues WHERE destination_id=? AND queue_date=? AND status IN ('called','done') ORDER BY queue_number DESC LIMIT 1").get(q.destination_id, q.queue_date);
  const ahead = db.prepare("SELECT COUNT(*) c FROM queues WHERE destination_id=? AND queue_date=? AND status='waiting' AND queue_number<?").get(q.destination_id, q.queue_date, q.queue_number).c;
  res.json({ ok: true, hasQueue: true, status: q.status, mine: B.queueLabel(b.dest_code, q.queue_number),
    serving: serving ? B.queueLabel(b.dest_code, serving.n) : null, ahead, isToday: q.queue_date === U.todayStr() });
});

module.exports = router;

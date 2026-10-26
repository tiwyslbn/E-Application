const db = require('../db');
const U = require('./util');

const PAYMENT_METHODS = ['QRIS', 'Virtual Account BCA', 'Virtual Account BRI', 'GoPay', 'OVO', 'DANA'];
const BOOKING_WINDOW_DAYS = 30;
const MAX_PERSONS_PER_BOOKING = 10;
const PAY_TIMEOUT_MIN = 30;

function expireOldBookings() {
  db.prepare("UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at < ?").run(U.nowStr());
}

function remainingQuota(destId, date) {
  const dest = db.prepare('SELECT daily_quota FROM destinations WHERE id=?').get(destId);
  if (!dest) return 0;
  const used = db.prepare(`SELECT COALESCE(SUM(qty_adult+qty_child),0) n FROM bookings
    WHERE destination_id=? AND visit_date=? AND status IN ('paid','pending')`).get(destId, date).n;
  return Math.max(0, dest.daily_quota - used);
}

function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00')); }

// Membuat pesanan (status pending). Mengembalikan {ok, code|error}
function createBooking({ userId, destId, date, slot, adult, child }) {
  adult = parseInt(adult, 10) || 0;
  child = parseInt(child, 10) || 0;
  const dest = db.prepare('SELECT * FROM destinations WHERE id=? AND is_active=1').get(destId);
  if (!dest) return { ok: false, error: 'Destinasi tidak ditemukan atau sedang tidak aktif.' };
  if (!isValidDate(date)) return { ok: false, error: 'Tanggal kunjungan tidak valid.' };
  if (date < U.todayStr()) return { ok: false, error: 'Tanggal kunjungan tidak boleh di masa lalu.' };
  if (date > U.dateOffset(BOOKING_WINDOW_DAYS)) return { ok: false, error: `Pemesanan maksimal ${BOOKING_WINDOW_DAYS} hari ke depan.` };
  if (adult < 0 || child < 0) return { ok: false, error: 'Jumlah tiket tidak valid.' };
  if (adult + child < 1) return { ok: false, error: 'Pilih minimal 1 tiket.' };
  if (adult + child > MAX_PERSONS_PER_BOOKING) return { ok: false, error: `Maksimal ${MAX_PERSONS_PER_BOOKING} tiket per pemesanan.` };
  if (adult < 1) return { ok: false, error: 'Anak-anak harus didampingi minimal 1 pengunjung dewasa.' };
  const validSlots = U.slots(dest.open_time, dest.close_time, dest.slot_hours, date);
  if (!validSlots.includes(slot)) return { ok: false, error: 'Sesi kunjungan tidak tersedia.' };

  const run = db.transaction(() => {
    const rem = remainingQuota(destId, date);
    if (adult + child > rem) return { ok: false, error: `Kuota tidak mencukupi. Sisa kuota ${rem} tiket pada tanggal tersebut.` };
    const total = adult * dest.price_adult + child * dest.price_child;
    const code = 'MST-' + date.slice(2).replace(/-/g, '') + '-' + U.randCode(4);
    db.prepare(`INSERT INTO bookings (code,user_id,destination_id,visit_date,visit_slot,qty_adult,qty_child,total,status,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)`)
      .run(code, userId, destId, date, slot, adult, child, total, U.plusMinutes(PAY_TIMEOUT_MIN), U.nowStr());
    return { ok: true, code };
  });
  return run();
}

function paymentReference(method, bookingId) {
  if (method.startsWith('Virtual Account')) {
    const bank = method.includes('BCA') ? '39201' : '88810';
    return bank + String(bookingId).padStart(5, '0') + U.randCode(4, '0123456789');
  }
  return 'PAY-' + U.randCode(10);
}

function startPayment(booking, method) {
  if (!PAYMENT_METHODS.includes(method)) return { ok: false, error: 'Metode pembayaran tidak valid.' };
  if (booking.status !== 'pending') return { ok: false, error: 'Pesanan ini tidak dapat dibayar (status: ' + booking.status + ').' };
  const existing = db.prepare('SELECT * FROM payments WHERE booking_id=?').get(booking.id);
  const ref = paymentReference(method, booking.id);
  if (existing) db.prepare("UPDATE payments SET method=?, reference=?, status='pending' WHERE id=?").run(method, ref, existing.id);
  else db.prepare('INSERT INTO payments (booking_id,method,amount,reference,status,created_at) VALUES (?,?,?,?,?,?)')
    .run(booking.id, method, booking.total, ref, 'pending', U.nowStr());
  return { ok: true };
}

// Simulasi callback sukses dari payment gateway: tandai lunas, terbitkan e-tiket & nomor antrian.
function confirmPayment(bookingId) {
  const run = db.transaction(() => {
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
    if (!b) return { ok: false, error: 'Pesanan tidak ditemukan.' };
    if (b.status !== 'pending') return { ok: false, error: 'Pesanan sudah tidak berstatus menunggu pembayaran.' };
    if (b.expires_at < U.nowStr()) {
      db.prepare("UPDATE bookings SET status='expired' WHERE id=?").run(b.id);
      return { ok: false, error: 'Batas waktu pembayaran telah habis. Silakan buat pesanan baru.' };
    }
    const pay = db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
    if (!pay) return { ok: false, error: 'Pilih metode pembayaran terlebih dahulu.' };

    db.prepare("UPDATE payments SET status='success', paid_at=? WHERE id=?").run(U.nowStr(), pay.id);
    db.prepare("UPDATE bookings SET status='paid' WHERE id=?").run(b.id);
    db.prepare('INSERT INTO tickets (booking_id,ticket_code,status,created_at) VALUES (?,?,?,?)')
      .run(b.id, 'TKT-' + U.randCode(10), 'valid', U.nowStr());
    const last = db.prepare('SELECT COALESCE(MAX(queue_number),0) n FROM queues WHERE destination_id=? AND queue_date=?')
      .get(b.destination_id, b.visit_date).n;
    db.prepare("INSERT INTO queues (booking_id,destination_id,queue_date,queue_number,status) VALUES (?,?,?,?, 'waiting')")
      .run(b.id, b.destination_id, b.visit_date, last + 1);
    return { ok: true };
  });
  return run();
}

function cancelBooking(booking) {
  if (booking.status !== 'pending') return { ok: false, error: 'Hanya pesanan berstatus menunggu pembayaran yang dapat dibatalkan.' };
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(booking.id);
  return { ok: true };
}

function queueLabel(code, n) { return `${code}-${U.pad3(n)}`; }

// Check-in oleh petugas dengan memindai kode tiket.
function checkIn(ticketCode, staffId) {
  const t = db.prepare(`SELECT t.*, b.code booking_code, b.visit_date, b.visit_slot, b.qty_adult, b.qty_child, b.status booking_status,
      d.name dest_name, d.code dest_code, u.name visitor, q.queue_number, q.id queue_id
    FROM tickets t JOIN bookings b ON b.id=t.booking_id JOIN destinations d ON d.id=b.destination_id
    JOIN users u ON u.id=b.user_id LEFT JOIN queues q ON q.booking_id=b.id
    WHERE t.ticket_code=?`).get(String(ticketCode || '').trim().toUpperCase());
  if (!t) return { ok: false, code: 'NOT_FOUND', message: 'Tiket tidak ditemukan. QR Code tidak valid.' };
  if (t.booking_status !== 'paid') return { ok: false, code: 'UNPAID', message: 'Pesanan belum lunas / tidak aktif.' };
  if (t.status === 'used') return { ok: false, code: 'USED', message: `Tiket sudah digunakan pada ${t.checkin_at}.`, ticket: t };
  if (t.visit_date !== U.todayStr()) {
    return { ok: false, code: 'WRONG_DATE', message: `Tiket berlaku untuk tanggal ${U.tanggalPendek(t.visit_date)}, bukan hari ini.`, ticket: t };
  }
  db.transaction(() => {
    db.prepare("UPDATE tickets SET status='used', checkin_at=?, checked_by=? WHERE id=?").run(U.nowStr(), staffId, t.id);
    if (t.queue_id) db.prepare("UPDATE queues SET status='done' WHERE id=?").run(t.queue_id);
  })();
  return { ok: true, message: 'Check-in berhasil. Silakan masuk.', ticket: t };
}

// ---------- Pengelolaan pesanan oleh admin / petugas ----------
// Hak akses per aksi: petugas boleh melunasi (bayar tunai di loket), membatalkan pesanan yang belum dibayar, dan check-in manual.
// Admin boleh semuanya, termasuk membatalkan pesanan lunas (refund), mengaktifkan kembali, dan membatalkan check-in.
const ACTION_ROLES = {
  lunas: ['admin', 'petugas'], batal: ['admin', 'petugas'], checkin: ['admin', 'petugas'],
  aktifkan: ['admin'], reset_checkin: ['admin'],
};
const ACTION_LABEL = { jadwal: 'Jadwal diubah', lunas: 'Ditandai lunas', batal: 'Dibatalkan', checkin: 'Check-in manual', aktifkan: 'Diaktifkan kembali', reset_checkin: 'Check-in dibatalkan' };

function logBooking(bookingId, action, note, actorId) {
  db.prepare('INSERT INTO booking_logs (booking_id,action,note,actor_id,created_at) VALUES (?,?,?,?,?)').run(bookingId, action, note || null, actorId || null, U.nowStr());
}

// Aksi yang tersedia untuk sebuah pesanan sesuai status & peran (dipakai tampilan agar tombol selalu sesuai aturan).
function availableActions(b, ticketStatus, role) {
  const out = [];
  const can = (a) => (ACTION_ROLES[a] || []).includes(role);
  if (b.status === 'pending') { if (can('lunas')) out.push('lunas'); if (can('batal')) out.push('batal'); }
  if (b.status === 'paid' && ticketStatus === 'valid') { if (can('checkin')) out.push('checkin'); if (role === 'admin') out.push('batal'); }
  if (b.status === 'paid' && ticketStatus === 'used' && can('reset_checkin')) out.push('reset_checkin');
  if (['expired', 'cancelled'].includes(b.status) && can('aktifkan')) out.push('aktifkan');
  return out;
}

function manageBooking(code, action, actor, note) {
  if (!ACTION_ROLES[action]) return { ok: false, error: 'Aksi tidak dikenal.' };
  if (!ACTION_ROLES[action].includes(actor.role)) return { ok: false, error: 'Anda tidak berhak melakukan aksi ini.' };
  const b0 = db.prepare('SELECT * FROM bookings WHERE code=?').get(String(code || ''));
  if (!b0) return { ok: false, error: 'Pesanan tidak ditemukan.' };
  const run = db.transaction(() => {
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(b0.id);
    const t = db.prepare('SELECT * FROM tickets WHERE booking_id=?').get(b.id);
    if (!availableActions(b, t && t.status, actor.role).includes(action)) return { ok: false, error: 'Aksi ini tidak dapat dilakukan pada status pesanan saat ini.' };

    if (action === 'lunas') {
      if (!db.prepare('SELECT 1 FROM payments WHERE booking_id=?').get(b.id)) {
        db.prepare('INSERT INTO payments (booking_id,method,amount,reference,status,created_at) VALUES (?,?,?,?,?,?)')
          .run(b.id, actor.role === 'admin' ? 'Manual (Admin)' : 'Tunai (Loket)', b.total, 'MAN-' + U.randCode(8), 'pending', U.nowStr());
      }
      const r = confirmPayment(b.id);
      if (!r.ok) return r;
    } else if (action === 'batal') {
      if (b.status === 'paid') { // refund: tiket & antrian dicabut, pembayaran tidak lagi dihitung sebagai pendapatan
        db.prepare('DELETE FROM queues WHERE booking_id=?').run(b.id);
        db.prepare('DELETE FROM tickets WHERE booking_id=?').run(b.id);
        db.prepare("UPDATE payments SET status='failed' WHERE booking_id=?").run(b.id);
      }
      db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
    } else if (action === 'checkin') {
      const r = checkIn(t.ticket_code, actor.id);
      if (!r.ok) return { ok: false, error: r.message };
    } else if (action === 'reset_checkin') {
      db.prepare("UPDATE tickets SET status='valid', checkin_at=NULL, checked_by=NULL WHERE id=?").run(t.id);
      db.prepare("UPDATE queues SET status='waiting' WHERE booking_id=?").run(b.id);
    } else if (action === 'aktifkan') {
      if (b.visit_date < U.todayStr()) return { ok: false, error: 'Tanggal kunjungan sudah lewat, pesanan tidak dapat diaktifkan.' };
      const rem = remainingQuota(b.destination_id, b.visit_date);
      if (b.qty_adult + b.qty_child > rem) return { ok: false, error: `Kuota tidak mencukupi (sisa ${rem} tiket).` };
      db.prepare("UPDATE bookings SET status='pending', expires_at=? WHERE id=?").run(U.plusMinutes(PAY_TIMEOUT_MIN), b.id);
      db.prepare("UPDATE payments SET status='pending' WHERE booking_id=? AND status='failed'").run(b.id);
    }
    logBooking(b.id, action, note, actor.id);
    return { ok: true, message: `${ACTION_LABEL[action]}: pesanan ${b.code}.` };
  });
  return run();
}

// Jadwal ulang (admin): pesanan menunggu bayar, atau lunas yang e-tiketnya belum dipakai. Harga tidak berubah.
function canReschedule(b, ticketStatus, role) {
  return role === 'admin' && (b.status === 'pending' || (b.status === 'paid' && ticketStatus === 'valid'));
}
function rescheduleBooking(code, { date, slot }, actor, note) {
  if (actor.role !== 'admin') return { ok: false, error: 'Anda tidak berhak melakukan aksi ini.' };
  const b0 = db.prepare('SELECT * FROM bookings WHERE code=?').get(String(code || ''));
  if (!b0) return { ok: false, error: 'Pesanan tidak ditemukan.' };
  if (!isValidDate(date)) return { ok: false, error: 'Tanggal kunjungan tidak valid.' };
  if (date < U.todayStr()) return { ok: false, error: 'Tanggal kunjungan tidak boleh di masa lalu.' };
  if (date > U.dateOffset(BOOKING_WINDOW_DAYS)) return { ok: false, error: `Jadwal maksimal ${BOOKING_WINDOW_DAYS} hari ke depan.` };
  const dest = db.prepare('SELECT * FROM destinations WHERE id=?').get(b0.destination_id);
  if (!U.slots(dest.open_time, dest.close_time, dest.slot_hours, date).includes(slot)) return { ok: false, error: 'Sesi kunjungan tidak tersedia pada tanggal tersebut.' };
  const run = db.transaction(() => {
    const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(b0.id);
    const t = db.prepare('SELECT * FROM tickets WHERE booking_id=?').get(b.id);
    if (!canReschedule(b, t && t.status, actor.role)) return { ok: false, error: 'Jadwal tidak dapat diubah pada status pesanan saat ini.' };
    if (b.visit_date === date && b.visit_slot === slot) return { ok: false, error: 'Jadwal baru sama dengan jadwal saat ini.' };
    if (b.visit_date !== date) {
      const rem = remainingQuota(b.destination_id, date);
      if (b.qty_adult + b.qty_child > rem) return { ok: false, error: `Kuota tidak mencukupi pada ${date} (sisa ${rem} tiket).` };
    }
    if (b.status === 'paid' && b.visit_date !== date) { // nomor antrian dibuat ulang untuk tanggal baru
      db.prepare('DELETE FROM queues WHERE booking_id=?').run(b.id);
      const last = db.prepare('SELECT COALESCE(MAX(queue_number),0) n FROM queues WHERE destination_id=? AND queue_date=?').get(b.destination_id, date).n;
      db.prepare("INSERT INTO queues (booking_id,destination_id,queue_date,queue_number,status) VALUES (?,?,?,?, 'waiting')").run(b.id, b.destination_id, date, last + 1);
    }
    db.prepare('UPDATE bookings SET visit_date=?, visit_slot=? WHERE id=?').run(date, slot, b.id);
    logBooking(b.id, 'jadwal', `${b.visit_date} ${b.visit_slot} -> ${date} ${slot}` + (note ? ` (${note})` : ''), actor.id);
    return { ok: true, message: `Jadwal pesanan ${b.code} diubah ke ${date}, ${slot}.` };
  });
  return run();
}

module.exports = {
  PAYMENT_METHODS, BOOKING_WINDOW_DAYS, MAX_PERSONS_PER_BOOKING, PAY_TIMEOUT_MIN,
  expireOldBookings, remainingQuota, createBooking, startPayment, confirmPayment, cancelBooking, queueLabel, checkIn,
  ACTION_LABEL, availableActions, manageBooking, logBooking, canReschedule, rescheduleBooking,
};

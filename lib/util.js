const crypto = require('crypto');
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDateTime = (d) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

exports.fmtDate = fmtDate;
exports.fmtDateTime = fmtDateTime;
exports.todayStr = () => fmtDate(new Date());
exports.nowStr = () => fmtDateTime(new Date());
exports.dateOffset = (n, base = new Date()) => { const d = new Date(base); d.setDate(d.getDate() + n); return fmtDate(d); };
exports.plusMinutes = (m) => fmtDateTime(new Date(Date.now() + m * 60000));

exports.rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
exports.tanggal = (s) => {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
exports.tanggalPendek = (s) => {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
exports.jam = (s) => (s ? String(s).slice(11, 16) : '-');
exports.pad3 = (n) => String(n).padStart(3, '0');

exports.randCode = (len, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
};

// Sesi kunjungan, mis. 08:00 - 10:00, dihitung dari jam buka/tutup.
exports.slots = (open, close, stepHours = 2, forDate = null) => {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toStr = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const o = toMin(open), c = toMin(close), step = stepHours * 60;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = forDate && forDate === fmtDate(now);
  const out = [];
  for (let s = o; s < c; s += step) {
    const e = Math.min(s + step, c);
    if (isToday && e <= nowMin) continue; // sesi yang sudah lewat
    out.push(`${toStr(s)} - ${toStr(e)}`);
  }
  return out;
};

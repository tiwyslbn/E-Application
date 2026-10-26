import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Rectangle, Circle
GREEN, INK = '#0f5c4d', '#16231f'
fig, ax = plt.subplots(figsize=(15, 10.6), dpi=170)
ax.set_xlim(0, 16); ax.set_ylim(0, 11); ax.set_aspect('equal'); ax.axis('off')
ax.add_patch(Rectangle((3.5, 0.2), 9.0, 10.6, fill=False, ec=GREEN, lw=2.2))
ax.text(8.0, 10.5, 'Sistem Medan Smart Tourism (E-Ticketing & E-Queue)', ha='center', va='center', fontsize=12.5, fontweight='bold', color=GREEN)

def uc(x, y, text, fc='#fff7da'):
    ax.add_patch(Ellipse((x, y), 3.7, 0.74, fc=fc, ec=GREEN, lw=1.4, zorder=3))
    ax.text(x, y, text, ha='center', va='center', fontsize=9.2, color=INK, zorder=4, linespacing=1.15)
    return (x, y)

def actor(x, y, label, color=GREEN):
    ax.add_patch(Circle((x, y + 0.62), 0.22, fc='white', ec=color, lw=2, zorder=3))
    ax.plot([x, x], [y + 0.40, y - 0.25], color=color, lw=2, zorder=3)
    ax.plot([x - 0.38, x + 0.38], [y + 0.2, y + 0.2], color=color, lw=2, zorder=3)
    ax.plot([x, x - 0.32], [y - 0.25, y - 0.8], color=color, lw=2, zorder=3)
    ax.plot([x, x + 0.32], [y - 0.25, y - 0.8], color=color, lw=2, zorder=3)
    ax.text(x, y - 1.2, label, ha='center', va='center', fontsize=10.5, fontweight='bold', color=INK)
    return (x, y + 0.1)

def link(a, b, color='#4a5a55', lw=1.1):
    ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=lw, zorder=1)

W = actor(1.5, 7.0, 'Wisatawan\n(User)')
P = actor(1.5, 2.2, 'Petugas Loket')
A = actor(14.5, 8.0, 'Admin\n(Dinas Pariwisata)', '#a3262a')
G = actor(14.5, 3.4, 'Payment Gateway\n(Sandbox)', '#1d6fa5')

xl, xr = 5.65, 10.35
ys = [9.7, 8.85, 8.0, 7.15, 6.3, 5.45, 4.6, 3.75]
names = ['Registrasi Akun', 'Login', 'Lihat Daftar Wisata\n(harga, jam buka, kuota)', 'Pesan Tiket', 'Bayar Tiket (E-Payment)',
         'Lihat E-Tiket (QR Code)', 'Pantau Nomor Antrian\n(E-Queue)', 'Batalkan Pesanan (belum bayar)']
uw = [uc(xl, y, n, '#fff7da' if i < 7 else '#fde8e8') for i, (y, n) in enumerate(zip(ys, names))]
ysp = [2.7, 1.85, 1.0]
up = [uc(xl, y, n, '#e3f1ff') for y, n in zip(ysp, ['Scan QR & Check-in Pengunjung', 'Kelola Antrian (panggil / lewati)', 'Lihat Dashboard Loket & Papan Antrian'])]
ysa = [9.7, 8.85, 8.0, 7.15, 6.3]
ua = [uc(xr, y, n, '#ffe6e6') for y, n in zip(ysa, ['Kelola Destinasi (CRUD)', 'Kelola Pengguna (CRUD)', 'Lihat Data Transaksi', 'Dashboard Kunjungan\n(harian & mingguan)', 'Laporan (Cetak & Ekspor CSV)'])]
upay = uc(xr, 3.4, 'Proses Pembayaran (Sandbox)', '#e3f1ff')

for u in uw: link(W, (u[0] - 1.85, u[1]))
for u in up: link(P, (u[0] - 1.85, u[1]))
for u in ua: link(A, (u[0] + 1.85, u[1]))
link(G, (upay[0] + 1.85, upay[1]))

ax.annotate('', xy=(xr - 1.85, 3.5), xytext=(xl + 1.85, 6.3), arrowprops=dict(arrowstyle='->', ls='--', color='#7a4e2d', lw=1.4), zorder=2)
ax.text(8.1, 4.75, '«include»', fontsize=9, style='italic', color='#7a4e2d', ha='center', rotation=-42, bbox=dict(fc='white', ec='none', pad=0.5))
ax.text(10.35, 1.3, 'Catatan: Petugas dan Admin juga melakukan\nuse case "Login" sebelum mengakses fitur masing-masing.',
        fontsize=8.8, ha='center', va='center', color='#4a5a55', style='italic', bbox=dict(fc='#f7f5ef', ec='#cfc9b6', boxstyle='round,pad=0.4'))
plt.savefig('usecase.png', bbox_inches='tight', facecolor='white')

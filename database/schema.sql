-- Skema database Medan Smart Tourism (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  phone      TEXT,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','petugas','user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS destinations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  address     TEXT,
  open_time   TEXT NOT NULL,
  close_time  TEXT NOT NULL,
  slot_hours  INTEGER NOT NULL DEFAULT 2,
  price_adult INTEGER NOT NULL DEFAULT 0,
  price_child INTEGER NOT NULL DEFAULT 0,
  daily_quota INTEGER NOT NULL DEFAULT 100,
  icon        TEXT DEFAULT 'bi-geo-alt-fill',
  color       TEXT DEFAULT '#0f5c4d',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  destination_id INTEGER NOT NULL REFERENCES destinations(id),
  visit_date     TEXT NOT NULL,
  visit_slot     TEXT NOT NULL,
  qty_adult      INTEGER NOT NULL DEFAULT 0,
  qty_child      INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled','expired')),
  expires_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  method     TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  reference  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  paid_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  ticket_code TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','used')),
  checkin_at  TEXT,
  checked_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queues (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id     INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  destination_id INTEGER NOT NULL REFERENCES destinations(id),
  queue_date     TEXT NOT NULL,
  queue_number   INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','done','skipped')),
  called_at      TEXT,
  UNIQUE (destination_id, queue_date, queue_number)
);

CREATE INDEX IF NOT EXISTS idx_bookings_dest_date ON bookings(destination_id, visit_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_queues_dest_date ON queues(destination_id, queue_date, status);

-- Riwayat perubahan status pesanan oleh admin/petugas (audit)
CREATE TABLE IF NOT EXISTS booking_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  action     TEXT NOT NULL,
  note       TEXT,
  actor_id   INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_booking_logs_booking ON booking_logs(booking_id);

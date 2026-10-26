-- Skema MySQL/MariaDB setara dengan database/schema.sql (SQLite) yang dipakai aplikasi.
-- CATATAN: file ini disediakan sebagai rujukan migrasi ke MySQL dan BELUM diuji dengan server MySQL.
CREATE DATABASE IF NOT EXISTS medan_smart_tourism CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medan_smart_tourism;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password VARCHAR(100) NOT NULL,
  role ENUM('admin','petugas','user') NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE destinations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(4) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(60) NOT NULL,
  description TEXT,
  address VARCHAR(255),
  open_time CHAR(5) NOT NULL,
  close_time CHAR(5) NOT NULL,
  slot_hours TINYINT NOT NULL DEFAULT 2,
  price_adult INT NOT NULL DEFAULT 0,
  price_child INT NOT NULL DEFAULT 0,
  daily_quota INT NOT NULL DEFAULT 100,
  icon VARCHAR(40) DEFAULT 'bi-geo-alt-fill',
  color CHAR(7) DEFAULT '#0f5c4d',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;

CREATE TABLE bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  destination_id INT NOT NULL,
  visit_date DATE NOT NULL,
  visit_slot VARCHAR(15) NOT NULL,
  qty_adult INT NOT NULL DEFAULT 0,
  qty_child INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  status ENUM('pending','paid','cancelled','expired') NOT NULL DEFAULT 'pending',
  expires_at DATETIME,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (destination_id) REFERENCES destinations(id),
  INDEX idx_dest_date (destination_id, visit_date, status)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  method VARCHAR(40) NOT NULL,
  amount INT NOT NULL,
  reference VARCHAR(40) NOT NULL,
  status ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  paid_at DATETIME,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB;

CREATE TABLE tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  ticket_code VARCHAR(20) NOT NULL UNIQUE,
  status ENUM('valid','used') NOT NULL DEFAULT 'valid',
  checkin_at DATETIME,
  checked_by INT,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE queues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  destination_id INT NOT NULL,
  queue_date DATE NOT NULL,
  queue_number INT NOT NULL,
  status ENUM('waiting','called','done','skipped') NOT NULL DEFAULT 'waiting',
  called_at DATETIME,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (destination_id) REFERENCES destinations(id),
  UNIQUE KEY uq_queue (destination_id, queue_date, queue_number)
) ENGINE=InnoDB;

-- Riwayat perubahan status pesanan oleh admin/petugas (audit)
CREATE TABLE IF NOT EXISTS booking_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  action     VARCHAR(30) NOT NULL,
  note       VARCHAR(255),
  actor_id   INT,
  created_at DATETIME NOT NULL,
  INDEX idx_booking_logs_booking (booking_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

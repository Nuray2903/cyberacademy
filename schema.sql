-- CyberAcademy database schema (MySQL / XAMPP)
-- Import with: mysql -u root < schema.sql   (or via phpMyAdmin > Import)

CREATE DATABASE IF NOT EXISTS cyberacademy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cyberacademy;

DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS labs;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  points        INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE labs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(64)  NOT NULL UNIQUE,
  title        VARCHAR(160) NOT NULL,
  category     VARCHAR(64)  NOT NULL,
  difficulty   ENUM('Easy','Medium','Hard') NOT NULL DEFAULT 'Easy',
  description  TEXT NOT NULL,
  instructions TEXT NOT NULL,
  target_port  INT NULL,
  flag_hash    CHAR(64) NOT NULL,   -- SHA-256 of the correct flag
  points       INT NOT NULL DEFAULT 10
) ENGINE=InnoDB;

CREATE TABLE submissions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  lab_id       INT NOT NULL,
  is_correct   TINYINT(1) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lab_id)  REFERENCES labs(id)  ON DELETE CASCADE,
  INDEX idx_user_lab (user_id, lab_id)
) ENGINE=InnoDB;

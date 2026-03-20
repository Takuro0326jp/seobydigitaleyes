-- users
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  username VARCHAR(255) DEFAULT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
);

-- auth_codes
CREATE TABLE IF NOT EXISTS auth_codes (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(10) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_codes_email (email),
  KEY idx_auth_codes_email (email)
);

-- sessions
CREATE TABLE IF NOT EXISTS sessions (
  id INT NOT NULL AUTO_INCREMENT,
  session_token VARCHAR(255) NOT NULL,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (session_token),
  KEY idx_sessions_user_id (user_id),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- scans（クロール・一覧）
CREATE TABLE IF NOT EXISTS scans (
  id VARCHAR(36) NOT NULL,
  user_id INT NOT NULL,
  target_url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  avg_score INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_scans_user_created (user_id, created_at),
  CONSTRAINT fk_scans_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- scan_pages（各スキャンで取得したページ）
CREATE TABLE IF NOT EXISTS scan_pages (
  id INT NOT NULL AUTO_INCREMENT,
  scan_id VARCHAR(36) NOT NULL,
  url TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 1,
  score INT NOT NULL DEFAULT 0,
  status_code INT NULL,
  internal_links INT NOT NULL DEFAULT 0,
  external_links INT NOT NULL DEFAULT 0,
  title VARCHAR(512) NULL,
  issues TEXT NULL,
  h1_count INT NOT NULL DEFAULT 0,
  word_count INT NOT NULL DEFAULT 0,
  is_noindex TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_scan_pages_scan (scan_id),
  CONSTRAINT fk_scan_pages_scan
    FOREIGN KEY (scan_id) REFERENCES scans(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scan_queue (
  id INT NOT NULL AUTO_INCREMENT,
  scan_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scan_queue_scan (scan_id)
);

CREATE TABLE IF NOT EXISTS scan_history (
  id INT NOT NULL AUTO_INCREMENT,
  scan_id VARCHAR(36) NOT NULL,
  avg_score INT NULL,
  page_count INT NOT NULL DEFAULT 0,
  critical_issues INT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scan_history_scan (scan_id),
  CONSTRAINT fk_scan_history_scan
    FOREIGN KEY (scan_id) REFERENCES scans(id)
    ON DELETE CASCADE
);

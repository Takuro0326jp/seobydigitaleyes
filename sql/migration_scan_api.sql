ALTER TABLE scan_pages
  ADD COLUMN title VARCHAR(512) NULL,
  ADD COLUMN issues TEXT NULL,
  ADD COLUMN h1_count INT NOT NULL DEFAULT 0,
  ADD COLUMN word_count INT NOT NULL DEFAULT 0,
  ADD COLUMN is_noindex TINYINT(1) NOT NULL DEFAULT 0;

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

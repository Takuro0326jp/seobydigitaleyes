-- 既存DBをアップグレードする場合（新規は schema.sql のみでOK）
-- ALTER TABLE scans ADD COLUMN avg_score INT NULL;
-- ALTER TABLE scans ADD COLUMN updated_at DATETIME NULL;
-- UPDATE scans SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS scan_pages (
  id INT NOT NULL AUTO_INCREMENT,
  scan_id VARCHAR(36) NOT NULL,
  url TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 1,
  score INT NOT NULL DEFAULT 0,
  status_code INT NULL,
  internal_links INT NOT NULL DEFAULT 0,
  external_links INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_scan_pages_scan (scan_id),
  CONSTRAINT fk_scan_pages_scan
    FOREIGN KEY (scan_id) REFERENCES scans(id)
    ON DELETE CASCADE
);

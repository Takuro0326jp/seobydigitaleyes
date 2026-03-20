-- 企業テーブル
CREATE TABLE IF NOT EXISTS companies (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- リンク分析用（PageRank計算）
CREATE TABLE IF NOT EXISTS scan_links (
  id INT NOT NULL AUTO_INCREMENT,
  scan_id VARCHAR(36) NOT NULL,
  from_url TEXT NOT NULL,
  to_url TEXT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_scan_links_scan (scan_id),
  CONSTRAINT fk_scan_links_scan FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);

-- users に company_id を追加（既存は NULL）
-- ALTER TABLE users ADD COLUMN company_id INT NULL;

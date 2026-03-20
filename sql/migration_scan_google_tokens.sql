-- URL（スキャン）ごとの Google OAuth トークン
-- 各URLで別のGoogleアカウントと連携可能
CREATE TABLE IF NOT EXISTS scan_google_tokens (
  scan_id VARCHAR(36) NOT NULL,
  user_id INT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scan_id),
  KEY idx_scan_google_tokens_user (user_id),
  CONSTRAINT fk_scan_google_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

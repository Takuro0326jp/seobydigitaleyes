-- OAuth state（CSRF 対策・コールバック時の user_id 取得用）
CREATE TABLE IF NOT EXISTS oauth_states (
  state VARCHAR(128) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY idx_oauth_states_expires (expires_at)
);

-- Google OAuth トークン（ユーザーごとの GSC 連携）
CREATE TABLE IF NOT EXISTS user_google_tokens (
  user_id INT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_google_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

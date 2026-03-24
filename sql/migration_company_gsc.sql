-- 会社全体（管理者が1回連携すれば全員が使える）のGoogle OAuthトークン
-- 管理者がGSC連携すると、同じcompany_idを持つ全ユーザーがGSCデータを参照できる
CREATE TABLE IF NOT EXISTS company_google_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  admin_user_id INT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_google (company_id),
  KEY idx_company_google_admin (admin_user_id),
  CONSTRAINT fk_company_google_tokens_user
    FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);

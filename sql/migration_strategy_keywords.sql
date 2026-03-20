-- strategy_keywords: キーワード戦略管理
-- 前提: companies テーブルが存在すること（migration_admin.sql または migration_multitenant_url_access.sql を先に実行）
CREATE TABLE IF NOT EXISTS strategy_keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  intent VARCHAR(50) DEFAULT NULL,
  relevance INT DEFAULT 0,
  `rank` INT DEFAULT 0,
  is_ai TINYINT(1) DEFAULT 0,
  accepted TINYINT(1) DEFAULT 0,
  url VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_strategy_company (company_id),
  KEY idx_strategy_accepted (company_id, accepted),
  CONSTRAINT fk_strategy_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

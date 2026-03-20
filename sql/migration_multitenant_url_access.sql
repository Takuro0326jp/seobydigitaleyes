-- マルチテナント + URL単位アクセス制御
-- users.company_id, scans.company_id, company_urls, user_url_access

-- companies がなければ作成（migration_admin.sql と重複するが安全のため）
CREATE TABLE IF NOT EXISTS companies (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- users に company_id を追加（既に存在する場合はスキップ）
ALTER TABLE users ADD COLUMN company_id INT NULL;

-- scans に company_id を追加（既に存在する場合はエラーになるが無視してOK）
ALTER TABLE scans ADD COLUMN company_id INT NULL;

-- 企業ごとのURL登録
CREATE TABLE IF NOT EXISTS company_urls (
  id INT NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  url VARCHAR(2048) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_url (company_id, url(500)),
  KEY idx_company_urls_company (company_id),
  KEY idx_company_urls_url (url(255)),
  CONSTRAINT fk_company_urls_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ユーザーごとの閲覧可能URL
CREATE TABLE IF NOT EXISTS user_url_access (
  user_id INT NOT NULL,
  url_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, url_id),
  KEY idx_user_url_access_url (url_id),
  CONSTRAINT fk_user_url_access_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_url_access_url
    FOREIGN KEY (url_id) REFERENCES company_urls(id) ON DELETE CASCADE
);

-- 既存 scans の company_id を user の company_id から補完（オプション）
-- UPDATE scans s JOIN users u ON s.user_id = u.id SET s.company_id = u.company_id WHERE s.company_id IS NULL;

-- ヒートマップ分析: サイト登録・セッション・イベント
-- 前提: companies テーブルが存在すること

-- トラッキング対象サイト
CREATE TABLE IF NOT EXISTS heatmap_sites (
  id INT NOT NULL AUTO_INCREMENT,
  company_id INT NOT NULL,
  site_url VARCHAR(2048) NOT NULL,
  site_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_heatmap_site_key (site_key),
  KEY idx_heatmap_sites_company (company_id),
  CONSTRAINT fk_heatmap_sites_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- 訪問セッション（sessionStorage ベースのクライアント生成UUID）
CREATE TABLE IF NOT EXISTS heatmap_sessions (
  id INT NOT NULL AUTO_INCREMENT,
  site_id INT NOT NULL,
  session_token VARCHAR(64) NOT NULL,
  page_url VARCHAR(2048) NOT NULL,
  viewport_w INT NOT NULL,
  viewport_h INT NOT NULL,
  page_h INT NULL,
  user_agent VARCHAR(512) NULL,
  ip_hash VARCHAR(64) NULL,
  device_type VARCHAR(16) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hm_sessions_site (site_id),
  KEY idx_hm_sessions_page (site_id, page_url(500)),
  KEY idx_hm_sessions_created (site_id, created_at),
  UNIQUE KEY uq_hm_session_page (site_id, session_token, page_url(500)),
  CONSTRAINT fk_hm_sessions_site FOREIGN KEY (site_id) REFERENCES heatmap_sites(id) ON DELETE CASCADE
);

-- クリックイベント
CREATE TABLE IF NOT EXISTS heatmap_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id INT NOT NULL,
  event_type VARCHAR(16) NOT NULL DEFAULT 'click',
  x_pct DECIMAL(7,4) NOT NULL,
  y_pct DECIMAL(7,4) NOT NULL,
  x_px INT NOT NULL,
  y_px INT NOT NULL,
  element_tag VARCHAR(32) NULL,
  element_text VARCHAR(255) NULL,
  scroll_depth_pct DECIMAL(5,2) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hm_events_session (session_id),
  CONSTRAINT fk_hm_events_session FOREIGN KEY (session_id) REFERENCES heatmap_sessions(id) ON DELETE CASCADE
);

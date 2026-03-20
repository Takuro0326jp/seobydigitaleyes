-- sitemap 送信履歴（最終送信日表示用）
CREATE TABLE IF NOT EXISTS sitemap_submissions (
  id INT NOT NULL AUTO_INCREMENT,
  site_url VARCHAR(512) NOT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sitemap_site (site_url(255))
);

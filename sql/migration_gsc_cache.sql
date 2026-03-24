-- GSC APIレスポンスのキャッシュ（APIを毎回叩かないようにするため）
-- キャッシュTTLは GSC_CACHE_TTL_HOURS 環境変数で制御（デフォルト12時間）
CREATE TABLE IF NOT EXISTS gsc_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scan_id VARCHAR(36) NOT NULL,
  cache_key VARCHAR(512) NOT NULL,
  data LONGTEXT NOT NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_gsc_cache (scan_id, cache_key(255)),
  KEY idx_gsc_cache_expires (expires_at)
);

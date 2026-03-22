-- SEO Strategy タブ拡張: キーワード監視・順位履歴・生成記事
-- node scripts/run-migration-strategy-watchlist.js

-- strategy_keywords に新カラム追加（各ALTERを個別実行、ER_DUP_FIELDNAMEはスキップ）
-- 注: MySQLはADD COLUMN IF NOT EXISTS非対応のため、マイグレーションスクリプトでエラーハンドリング

-- scans に GSC プロパティ URL を保存（永続化用）
-- MySQL 5.7 では IF NOT EXISTS 非対応のため、既存の場合はエラーを無視
ALTER TABLE scans ADD COLUMN gsc_property_url VARCHAR(512) NULL;

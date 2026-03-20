-- scans テーブルに updated_at カラムを追加（既に存在する場合はエラーになりますが無視してOK）
ALTER TABLE scans ADD COLUMN updated_at DATETIME NULL DEFAULT NULL;

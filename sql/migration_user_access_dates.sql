-- users に初回・最終アクセス日を追加
-- サーバー起動時に自動実行されます（server.js）。手動実行する場合:
ALTER TABLE users ADD COLUMN first_access_at DATETIME NULL;
ALTER TABLE users ADD COLUMN last_access_at DATETIME NULL;

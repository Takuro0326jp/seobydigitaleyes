-- スコア内訳（OnPage/Structure/Performance/penalty）を保存
ALTER TABLE scan_pages ADD COLUMN score_breakdown TEXT NULL;

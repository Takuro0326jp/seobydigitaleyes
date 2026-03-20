-- oauth_states.state を拡張（scanId:randomPart 形式で約85文字になるため）
-- invalid_state エラーを防ぐ
ALTER TABLE oauth_states MODIFY COLUMN state VARCHAR(128) NOT NULL;

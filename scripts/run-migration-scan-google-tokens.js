#!/usr/bin/env node
/**
 * scan_google_tokens テーブル作成
 * URLごとに別のGoogleアカウントと連携可能にする
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../db");

(async () => {
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS scan_google_tokens (
      scan_id VARCHAR(36) NOT NULL,
      user_id INT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date BIGINT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scan_id)
    )`);
    console.log("OK: scan_google_tokens テーブルを作成しました");
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();

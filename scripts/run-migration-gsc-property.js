#!/usr/bin/env node
/**
 * scans テーブルに gsc_property_url カラムを追加
 * 既に存在する場合はスキップ
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../db");

(async () => {
  try {
    await pool.query("ALTER TABLE scans ADD COLUMN gsc_property_url VARCHAR(512) NULL");
    console.log("OK: gsc_property_url カラムを追加しました");
  } catch (e) {
    if (e.code === "ER_DUP_FIELDNAME") {
      console.log("SKIP: gsc_property_url は既に存在します");
    } else {
      console.error("ERROR:", e.message);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
})();

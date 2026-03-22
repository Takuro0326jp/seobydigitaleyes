#!/usr/bin/env node
/**
 * strategy 拡張マイグレーション: watchlist, rank_history, generated_articles
 * node scripts/run-migration-strategy-watchlist.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../db");

const ALTER_COLUMNS = [
  { name: "search_volume", def: "INT NULL" },
  { name: "competition", def: "VARCHAR(20) NULL" },
  { name: "ai_reason", def: "TEXT NULL" },
  { name: "status", def: "VARCHAR(20) DEFAULT 'pending'" },
  { name: "scan_id", def: "VARCHAR(36) NULL" },
  { name: "excluded_at", def: "DATETIME NULL" },
];

async function run() {
  for (const col of ALTER_COLUMNS) {
    try {
      await pool.query(`ALTER TABLE strategy_keywords ADD COLUMN ${col.name} ${col.def}`);
      console.log("[OK] strategy_keywords." + col.name);
    } catch (e) {
      if (e.code === "ER_DUP_FIELDNAME") {
        console.log("[SKIP] strategy_keywords." + col.name + " 既存");
      } else throw e;
    }
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS keyword_watchlist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        scan_id VARCHAR(36) NULL,
        strategy_keyword_id INT NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        source VARCHAR(20) DEFAULT 'ai',
        intent VARCHAR(50) NULL,
        search_volume INT NULL,
        competition VARCHAR(20) NULL,
        ai_reason TEXT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_watchlist_company (company_id),
        KEY idx_watchlist_scan (scan_id),
        KEY idx_watchlist_status (company_id, status),
        CONSTRAINT fk_watchlist_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )
    `);
    console.log("[OK] keyword_watchlist");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS" && e.code !== "ER_TABLE_EXISTS_ERROR") throw e;
    console.log("[SKIP] keyword_watchlist 既存");
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS rank_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        keyword_id INT NOT NULL,
        \`rank\` INT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_rank_keyword (keyword_id),
        KEY idx_rank_scanned (keyword_id, scanned_at),
        CONSTRAINT fk_rank_keyword FOREIGN KEY (keyword_id) REFERENCES keyword_watchlist(id) ON DELETE CASCADE
      )
    `);
    console.log("[OK] rank_history");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS" && e.code !== "ER_TABLE_EXISTS_ERROR") throw e;
    console.log("[SKIP] rank_history 既存");
  }

  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS generated_articles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        keyword_id INT NOT NULL,
        outline_json JSON NULL,
        body TEXT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_article_keyword (keyword_id),
        CONSTRAINT fk_article_keyword FOREIGN KEY (keyword_id) REFERENCES keyword_watchlist(id) ON DELETE CASCADE
      )
    `);
    console.log("[OK] generated_articles");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS" && e.code !== "ER_TABLE_EXISTS_ERROR") throw e;
    console.log("[SKIP] generated_articles 既存");
  }

  console.log("Migration completed.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

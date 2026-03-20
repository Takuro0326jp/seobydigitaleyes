#!/usr/bin/env node
/**
 * strategy_keywords テーブル マイグレーション実行
 * 前提: companies テーブルが存在すること（run-migration-multitenant.js を先に実行）
 * node scripts/run-migration-strategy.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const mysql = require("mysql2/promise");

const sqlPath = path.join(__dirname, "..", "sql", "migration_strategy_keywords.sql");

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  });

  const sql = fs.readFileSync(sqlPath, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      await pool.execute(stmt);
      console.log("[OK] strategy_keywords");
    } catch (e) {
      if (e.code === "ER_DUP_FIELDNAME" || e.code === "ER_DUP_KEYNAME" || e.code === "ER_TABLE_EXISTS_ERROR") {
        console.log("[SKIP] 既に存在:", e.message.slice(0, 80));
      } else {
        console.error("[ERR]", e.message);
        if (e.code === "ER_NO_REFERENCED_ROW_2" || e.message?.includes("companies")) {
          console.error("→ companies テーブルがありません。先に node scripts/run-migration-multitenant.js を実行してください。");
        }
        process.exit(1);
      }
    }
  }

  console.log("Migration completed.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

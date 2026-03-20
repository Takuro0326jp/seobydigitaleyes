#!/usr/bin/env node
/**
 * GSC OAuth マイグレーション実行
 * node scripts/run-migration-gsc-oauth.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const mysql = require("mysql2/promise");

const sqlPath = path.join(__dirname, "..", "sql", "migration_gsc_oauth.sql");

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
      console.log("[OK]", stmt.slice(0, 50) + "...");
    } catch (e) {
      if (e.code === "ER_TABLE_EXISTS_ERROR" || e.message?.includes("already exists")) {
        console.log("[SKIP] テーブルは既に存在します");
      } else {
        console.error("[ERR]", e.message);
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

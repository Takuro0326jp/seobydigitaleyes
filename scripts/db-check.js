#!/usr/bin/env node
/**
 * DB接続診断スクリプト
 * 使用例: node scripts/db-check.js
 * RDS へのネットワーク到達性と MySQL 接続を確認します。
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const net = require("net");
const dns = require("dns").promises;

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "";
const DB_NAME = process.env.DB_NAME || "";

function maskHost(host) {
  if (!host || host === "localhost" || host === "127.0.0.1") return host;
  // RDS 等の長いホスト名は末尾のみ表示
  const parts = host.split(".");
  if (parts.length > 2) {
    return parts[0] + ".***." + parts.slice(-2).join(".");
  }
  return host;
}

async function checkDns(host) {
  try {
    const addrs = await dns.resolve4(host);
    return { ok: true, addrs: addrs.slice(0, 3) };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port }, () => {
      s.destroy();
      resolve({ ok: true });
    });
    s.setTimeout(5000, () => {
      s.destroy();
      resolve({ ok: false, error: "ETIMEDOUT" });
    });
    s.on("error", (err) => {
      resolve({ ok: false, error: err.code || err.message });
    });
  });
}

async function checkMysql() {
  try {
    const mysql = require("mysql2/promise");
    const pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: process.env.DB_PASSWORD,
      database: DB_NAME,
      connectTimeout: 8000,
    });
    const [rows] = await pool.execute("SELECT 1 AS ok");
    await pool.end();
    return { ok: rows?.[0]?.ok === 1 };
  } catch (err) {
    return { ok: false, error: err.code || err.message, detail: err.message };
  }
}

async function main() {
  console.log("=== DB接続診断 ===\n");
  console.log("設定:");
  console.log("  DB_HOST:", maskHost(DB_HOST));
  console.log("  DB_PORT:", DB_PORT);
  console.log("  DB_USER:", DB_USER ? "設定済" : "未設定");
  console.log("  DB_NAME:", DB_NAME || "(未設定)");
  console.log("");

  if (!DB_USER) {
    console.log("❌ DB_USER が未設定です。.env を確認してください。");
    process.exit(1);
  }

  // 1. DNS 解決
  console.log("1. DNS 解決 ...");
  const dnsResult = await checkDns(DB_HOST);
  if (dnsResult.ok) {
    console.log("   ✓ 成功:", dnsResult.addrs.join(", "));
  } else {
    console.log("   ❌ 失敗:", dnsResult.error);
    if (dnsResult.error === "ENOTFOUND") {
      console.log("\n   → RDS ホスト名を確認するか、VPN/ネットワーク接続を確認してください。");
      process.exit(1);
    }
  }

  // 2. TCP 接続
  console.log("\n2. TCP 接続 (" + DB_HOST + ":" + DB_PORT + ") ...");
  const tcpResult = await checkTcp(DB_HOST, DB_PORT);
  if (tcpResult.ok) {
    console.log("   ✓ 接続可能");
  } else {
    console.log("   ❌ 失敗:", tcpResult.error);
    if (tcpResult.error === "EHOSTUNREACH" || tcpResult.error === "ECONNREFUSED") {
      console.log("\n   → 以下を確認してください:");
      console.log("     - VPN に接続していますか？（RDS が VPC 内の場合）");
      console.log("     - RDS セキュリティグループで接続元 IP が許可されていますか？");
      console.log("     - ローカル開発の場合は DB_HOST=localhost に切り替えてみてください");
    }
    process.exit(1);
  }

  // 3. MySQL 認証・クエリ
  console.log("\n3. MySQL 接続・クエリ ...");
  const mysqlResult = await checkMysql();
  if (mysqlResult.ok) {
    console.log("   ✓ SELECT 1 成功");
    console.log("\n=== 接続OK ===\n");
    process.exit(0);
  } else {
    console.log("   ❌ 失敗:", mysqlResult.error, mysqlResult.detail || "");
    if (mysqlResult.error === "ECONNREFUSED") {
      console.log("\n   → MySQL が起動しているか、ポートが正しいか確認してください。");
    } else if (mysqlResult.error === "ER_ACCESS_DENIED_ERROR") {
      console.log("\n   → DB_USER / DB_PASSWORD を確認してください。");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

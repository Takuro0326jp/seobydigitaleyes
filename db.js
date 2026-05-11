require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const mysql = require("mysql2/promise");

const {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_PORT
} = process.env;

if (!DB_USER) {
  console.warn(
    "[DB] .env の DB_USER が未設定です。プロジェクト直下に .env を作成し、DB_HOST/DB_USER/DB_PASSWORD/DB_NAME を設定してください。"
  );
}

function resolveConnectionLimit() {
  const raw = process.env.DB_CONNECTION_LIMIT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(2, Math.min(48, Math.floor(n)));
  }
  // サーバレスはインスタンス数×プールがRDS max_connections に乗りやすい。
  // 本番+staging が同一 RDS のとき staging 側は DB_CONNECTION_LIMIT=4 など小さめ推奨。
  if (process.env.VERCEL === "1") return 6;
  return 10;
}

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT ? Number(DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: resolveConnectionLimit(),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 20000,
});

// 未処理の接続エラーをキャッチ（EHOSTUNREACH, ECONNRESET 等）
let _lastTransientLog = 0;
pool.on("error", (err) => {
  const code = err.code || err.errno;
  const isTransient = ["EHOSTUNREACH", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT"].includes(code);
  if (isTransient) {
    const now = Date.now();
    if (now - _lastTransientLog > 60000) {
      _lastTransientLog = now;
      console.warn("⚠️ MySQL 接続エラー (一時的):", err.message, "— 再接続を試行します");
    }
  } else {
    console.error("[DB] 接続エラー:", code || err.message, err.message);
  }
});

module.exports = pool;


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

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT ? Number(DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;


// db.js
const mysql = require('mysql2/promise');

console.log("接続先HOST:", process.env.DB_HOST);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

console.log("★ DB設定完了:", process.env.DB_USER, "接続");
module.exports = pool;
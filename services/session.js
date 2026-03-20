/**
 * セッションCookieからログインユーザーIDを取得
 * （認証API・スキャンAPIで共通利用）
 */
const pool = require("../db");

async function getUserIdFromRequest(req) {
  const token = req.cookies?.session_id;
  if (!token) return null;

  const [rows] = await pool.query(
    `SELECT user_id
     FROM sessions
     WHERE session_token = ?
       AND expires_at > NOW()
     LIMIT 1`,
    [token]
  );

  return rows.length ? rows[0].user_id : null;
}

/** admin/master ロールのユーザー情報を取得（管理API用） */
async function getAdminUserFromRequest(req) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return null;

  const [rows] = await pool.query(
    `SELECT id, email, username, role FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;

  const role = (rows[0].role || "").toLowerCase();
  if (role !== "admin" && role !== "master") return null;

  return rows[0];
}

module.exports = { getUserIdFromRequest, getAdminUserFromRequest };

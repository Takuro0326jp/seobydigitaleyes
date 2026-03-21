/**
 * API認証元（MCC別 OAuth 資格情報）
 * ATOM と同様、先に MCC で OAuth → refresh_token を保存
 */
const pool = require("../db");

async function list(userId, platform = "google") {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
    const hasLid = cols?.length > 0;
    const selectCols = hasLid ? "id, name, platform, login_customer_id, google_email, created_at" : "id, name, platform, google_email, created_at";
    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM api_auth_sources WHERE user_id = ? AND platform = ? ORDER BY created_at DESC`,
      [userId, platform]
    );
    return rows || [];
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function getById(id, userId) {
  const [cols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
  const hasLid = cols?.length > 0;
  const selectCols = hasLid
    ? "id, user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email, created_at"
    : "id, user_id, name, platform, refresh_token, access_token, expiry_date, google_email, created_at";
  const [[row]] = await pool.query(
    `SELECT ${selectCols} FROM api_auth_sources WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return row || null;
}

async function create(userId, { name, platform = "google", loginCustomerId, tokens, googleEmail }) {
  const trimmedName = (name || "").trim().slice(0, 100);
  if (!trimmedName) return null;

  const [[hasTable]] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'api_auth_sources'"
  );
  if (!hasTable) return null;

  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
  const hasLidCol = lidCols?.length > 0;

  if (hasLidCol) {
    const [r] = await pool.query(
      `INSERT INTO api_auth_sources (user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        trimmedName,
        platform,
        lid,
        tokens?.refresh_token || null,
        tokens?.access_token || null,
        tokens?.expiry_date || null,
        (googleEmail || "").trim().slice(0, 255) || null,
      ]
    );
    return r.insertId;
  }
  const [r] = await pool.query(
    `INSERT INTO api_auth_sources (user_id, name, platform, refresh_token, access_token, expiry_date, google_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      trimmedName,
      platform,
      tokens?.refresh_token || null,
      tokens?.access_token || null,
      tokens?.expiry_date || null,
      (googleEmail || "").trim().slice(0, 255) || null,
    ]
  );
  return r.insertId;
}

async function updateLoginCustomerId(id, userId, loginCustomerId) {
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
    if (!cols?.length) return false;
    const [r] = await pool.query(
      "UPDATE api_auth_sources SET login_customer_id = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
      [lid, id, userId]
    );
    return r.affectedRows > 0;
  } catch (_) {
    return false;
  }
}

async function updateTokens(id, userId, tokens) {
  const [r] = await pool.query(
    `UPDATE api_auth_sources SET access_token = ?, expiry_date = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [tokens?.access_token || null, tokens?.expiry_date || null, id, userId]
  );
  return r.affectedRows > 0;
}

async function remove(userId, id) {
  const [r] = await pool.query(
    "DELETE FROM api_auth_sources WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return r.affectedRows > 0;
}

module.exports = {
  list,
  getById,
  create,
  updateTokens,
  updateLoginCustomerId,
  remove,
};

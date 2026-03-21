/**
 * Google Ads アカウント（MCC別テーブル）管理
 * 2段階構成: API認証元(api_auth_sources) → アカウント(google_ads_accounts)
 */
const pool = require("../db");

async function listAccounts(userId) {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'api_auth_source_id'");
    const hasAuthCol = cols && cols.length > 0;
    let authHasLid = false;
    try {
      const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
      authHasLid = lidCols?.length > 0;
    } catch (_) {}
    const loginIdCol = authHasLid ? "COALESCE(a.login_customer_id, g.login_customer_id) AS login_customer_id" : "g.login_customer_id";
    const selectCols = hasAuthCol
      ? `g.id, g.name, g.customer_id, ${loginIdCol}, g.is_selected, g.created_at,
         g.api_auth_source_id, a.name AS auth_source_name`
      : `id, name, customer_id, login_customer_id, google_email, is_selected, created_at`;
    const fromClause = hasAuthCol
      ? `google_ads_accounts g LEFT JOIN api_auth_sources a ON g.api_auth_source_id = a.id AND g.user_id = a.user_id`
      : "google_ads_accounts";
    const whereClause = hasAuthCol ? "g.user_id = ?" : "user_id = ?";
    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM ${fromClause} WHERE ${whereClause} ORDER BY is_selected DESC, created_at DESC`,
      [userId]
    );
    return (rows || []).map((r) => {
      const x = { ...r };
      if (hasAuthCol && x.api_auth_source_id && !x.auth_source_name) {
        x.auth_source_name = "(削除済み)";
      }
      return x;
    });
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function getSelectedAccount(userId) {
  const [cols] = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'api_auth_source_id'");
  const hasAuthCol = cols && cols.length > 0;
  const tokenCols = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'refresh_token'").then(([c]) => c?.length > 0);

  let rows;
  let authHasLid = false;
  try {
    const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
    authHasLid = lidCols?.length > 0;
  } catch (_) {}
  const loginIdSelect = authHasLid ? "COALESCE(a.login_customer_id, g.login_customer_id) AS login_customer_id" : "g.login_customer_id";

  if (hasAuthCol) {
    [rows] = await pool.query(
      `SELECT g.id, g.name, g.customer_id, ${loginIdSelect}, g.api_auth_source_id,
              a.refresh_token, a.access_token, a.expiry_date
       FROM google_ads_accounts g
       LEFT JOIN api_auth_sources a ON g.api_auth_source_id = a.id AND g.user_id = a.user_id
       WHERE g.user_id = ? AND g.is_selected = 1 LIMIT 1`,
      [userId]
    );
  }
  if (!rows?.length && hasAuthCol) {
    [rows] = await pool.query(
      `SELECT g.id, g.name, g.customer_id, ${loginIdSelect}, g.api_auth_source_id,
              a.refresh_token, a.access_token, a.expiry_date
       FROM google_ads_accounts g
       LEFT JOIN api_auth_sources a ON g.api_auth_source_id = a.id AND g.user_id = a.user_id
       WHERE g.user_id = ? LIMIT 1`,
      [userId]
    );
  }
  if (rows?.length) return rows[0];
  if (tokenCols) {
    [rows] = await pool.query(
      `SELECT id, name, customer_id, login_customer_id, refresh_token, access_token, expiry_date
       FROM google_ads_accounts WHERE user_id = ? AND is_selected = 1 LIMIT 1`,
      [userId]
    );
    if (rows.length) return rows[0];
    [rows] = await pool.query(
      `SELECT id, name, customer_id, login_customer_id, refresh_token, access_token, expiry_date
       FROM google_ads_accounts WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }
  return null;
}

async function createAccount(userId, { name, customerId, loginCustomerId, apiAuthSourceId, tokens, googleEmail }) {
  const cid = (customerId || "").trim().replace(/-/g, "");
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const authId = apiAuthSourceId ? parseInt(apiAuthSourceId, 10) : null;
  const displayName = (name || "").trim() || cid;
  if (!cid) return null;

  const [[hasTable]] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'google_ads_accounts'"
  );
  if (!hasTable) return null;

  const [authCols] = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'api_auth_source_id'");
  const hasAuthCol = authCols && authCols.length > 0;

  if (hasAuthCol && authId) {
    await pool.query(
      "UPDATE google_ads_accounts SET is_selected = 0 WHERE user_id = ?",
      [userId]
    );
    const [r] = await pool.query(
      `INSERT INTO google_ads_accounts (user_id, api_auth_source_id, name, customer_id, is_selected)
       VALUES (?, ?, ?, ?, 1)`,
      [userId, authId, displayName.slice(0, 100), cid]
    );
    return r.insertId;
  }

  const [tokenCols] = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'refresh_token'");
  if (tokenCols?.length && tokens?.refresh_token) {
    await pool.query(
      "UPDATE google_ads_accounts SET is_selected = 0 WHERE user_id = ?",
      [userId]
    );
    const [r] = await pool.query(
      `INSERT INTO google_ads_accounts (user_id, name, customer_id, login_customer_id, refresh_token, access_token, expiry_date, google_email, is_selected)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        userId,
        (name || "").trim().slice(0, 100),
        cid,
        lid,
        tokens.refresh_token || null,
        tokens.access_token || null,
        tokens.expiry_date || null,
        (googleEmail || "").trim().slice(0, 255) || null,
      ]
    );
    return r.insertId;
  }
  return null;
}

async function setSelectedAccount(userId, accountId) {
  const [[hasTable]] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'google_ads_accounts'"
  );
  if (!hasTable) return false;

  await pool.query(
    "UPDATE google_ads_accounts SET is_selected = 0 WHERE user_id = ?",
    [userId]
  );
  if (accountId) {
    await pool.query(
      "UPDATE google_ads_accounts SET is_selected = 1 WHERE id = ? AND user_id = ?",
      [accountId, userId]
    );
  }
  return true;
}

async function deleteAccount(userId, accountId) {
  const [r] = await pool.query(
    "DELETE FROM google_ads_accounts WHERE id = ? AND user_id = ?",
    [accountId, userId]
  );
  return r.affectedRows > 0;
}

module.exports = {
  listAccounts,
  getSelectedAccount,
  createAccount,
  setSelectedAccount,
  deleteAccount,
};

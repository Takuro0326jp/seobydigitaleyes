/**
 * Yahoo! 広告アカウント管理
 * 構成: API認証元(api_auth_sources platform=yahoo) → アカウント(yahoo_ads_accounts)
 * 代理店アカウント = x-z-base-account-id（MCC相当）
 */
const pool = require("../db");

async function listAccounts(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT y.id, y.name, y.account_id, y.agency_account_id, y.is_selected, y.created_at,
              y.api_auth_source_id, a.name AS auth_source_name
       FROM yahoo_ads_accounts y
       LEFT JOIN api_auth_sources a ON y.api_auth_source_id = a.id AND y.user_id = a.user_id AND a.platform = 'yahoo'
       WHERE y.user_id = ? ORDER BY y.is_selected DESC, y.created_at DESC`,
      [userId]
    );
    return (rows || []).map((r) => ({
      ...r,
      auth_source_name: r.auth_source_name || (r.api_auth_source_id ? "(削除済み)" : null),
    }));
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function getSelectedAccount(userId) {
  try {
    const [rows] = await pool.query(
      `SELECT y.id, y.name, y.account_id, y.agency_account_id, y.api_auth_source_id,
              a.refresh_token, a.access_token, a.expiry_date
       FROM yahoo_ads_accounts y
       LEFT JOIN api_auth_sources a ON y.api_auth_source_id = a.id AND y.user_id = a.user_id AND a.platform = 'yahoo'
       WHERE y.user_id = ? AND y.is_selected = 1 LIMIT 1`,
      [userId]
    );
    if (rows?.length) return rows[0];

    const [rows2] = await pool.query(
      `SELECT y.id, y.name, y.account_id, y.agency_account_id, y.api_auth_source_id,
              a.refresh_token, a.access_token, a.expiry_date
       FROM yahoo_ads_accounts y
       LEFT JOIN api_auth_sources a ON y.api_auth_source_id = a.id AND y.user_id = a.user_id AND a.platform = 'yahoo'
       WHERE y.user_id = ? LIMIT 1`,
      [userId]
    );
    return rows2?.[0] || null;
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return null;
    throw e;
  }
}

async function createAccount(userId, { name, accountId, agencyAccountId, apiAuthSourceId }) {
  const aid = (accountId || "").trim();
  const agid = (agencyAccountId || "").trim() || null;
  const authId = apiAuthSourceId ? parseInt(apiAuthSourceId, 10) : null;
  const displayName = (name || "").trim() || aid;
  if (!aid) return null;

  const [[hasTable]] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'yahoo_ads_accounts'"
  );
  if (!hasTable) return null;

  if (!authId) return null;

  await pool.query("UPDATE yahoo_ads_accounts SET is_selected = 0 WHERE user_id = ?", [userId]);
  const [r] = await pool.query(
    `INSERT INTO yahoo_ads_accounts (user_id, api_auth_source_id, name, account_id, agency_account_id, is_selected)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [userId, authId, displayName.slice(0, 100), aid, agid]
  );
  return r.insertId;
}

async function setSelectedAccount(userId, accountId) {
  try {
    await pool.query("UPDATE yahoo_ads_accounts SET is_selected = 0 WHERE user_id = ?", [userId]);
    if (accountId) {
      await pool.query("UPDATE yahoo_ads_accounts SET is_selected = 1 WHERE id = ? AND user_id = ?", [
        accountId,
        userId,
      ]);
    }
    return true;
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return false;
    throw e;
  }
}

async function deleteAccount(userId, accountId) {
  const [r] = await pool.query("DELETE FROM yahoo_ads_accounts WHERE id = ? AND user_id = ?", [
    accountId,
    userId,
  ]);
  return r.affectedRows > 0;
}

module.exports = {
  listAccounts,
  getSelectedAccount,
  createAccount,
  setSelectedAccount,
  deleteAccount,
};

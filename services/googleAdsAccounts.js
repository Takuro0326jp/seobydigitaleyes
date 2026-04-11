/**
 * Google Ads アカウント（MCC別テーブル）管理
 * 2段階構成: API認証元(api_auth_sources) → アカウント(google_ads_accounts)
 */
const pool = require("../db");

async function hasAdsCompanyUrlColumn() {
  try {
    const [c] = await pool.query("SHOW COLUMNS FROM google_ads_accounts LIKE 'company_url_id'");
    return !!(c && c.length);
  } catch (_) {
    return false;
  }
}

/** 案件URL（Target）用: その Target に紐づく Google 広告アカウントのみ */
async function listAccountsForCompanyUrl(companyUrlId) {
  const cid = parseInt(companyUrlId, 10);
  if (!cid) return [];
  try {
    const hasCu = await hasAdsCompanyUrlColumn();
    const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
    const authHasLid = lidCols?.length > 0;
    const loginIdCol = authHasLid ? "COALESCE(a.login_customer_id, g.login_customer_id) AS login_customer_id" : "g.login_customer_id";
    const scope = hasCu
      ? `(g.company_url_id = ? OR g.id IN (SELECT ads_account_id FROM company_url_ads_accounts WHERE company_url_id = ? AND platform = 'google' AND ads_account_id IS NOT NULL))`
      : `g.id IN (SELECT ads_account_id FROM company_url_ads_accounts WHERE company_url_id = ? AND platform = 'google' AND ads_account_id IS NOT NULL)`;
    const params = hasCu ? [cid, cid] : [cid];
    const [rows] = await pool.query(
      `SELECT DISTINCT g.id, g.name, g.customer_id, ${loginIdCol}, g.is_selected, g.created_at,
              g.api_auth_source_id, a.name AS auth_source_name
       FROM google_ads_accounts g
       LEFT JOIN api_auth_sources a ON g.api_auth_source_id = a.id
       WHERE ${scope}
       ORDER BY g.created_at DESC`,
      params
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

async function createAccount(userId, { name, customerId, loginCustomerId, apiAuthSourceId, tokens, googleEmail, companyUrlId }) {
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
  const hasCuCol = await hasAdsCompanyUrlColumn();
  const cuId = companyUrlId ? parseInt(companyUrlId, 10) : null;
  const cuVal = cuId && !Number.isNaN(cuId) ? cuId : null;

  if (hasAuthCol && authId) {
    // login_customer_id が未指定の場合、api_auth_sources から自動取得
    let effectiveLid = lid;
    if (!effectiveLid) {
      try {
        const [authRows] = await pool.query(
          "SELECT login_customer_id FROM api_auth_sources WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
          [authId, userId]
        );
        if (authRows?.length) {
          effectiveLid = (authRows[0].login_customer_id || "").trim().replace(/-/g, "") || null;
        }
      } catch (_) {}
    }

    await pool.query(
      "UPDATE google_ads_accounts SET is_selected = 0 WHERE user_id = ?",
      [userId]
    );
    if (hasCuCol) {
      const [r] = await pool.query(
        `INSERT INTO google_ads_accounts (user_id, api_auth_source_id, name, customer_id, login_customer_id, is_selected, company_url_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [userId, authId, displayName.slice(0, 100), cid, effectiveLid, cuVal]
      );
      return r.insertId;
    }
    const [r] = await pool.query(
      `INSERT INTO google_ads_accounts (user_id, api_auth_source_id, name, customer_id, login_customer_id, is_selected)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [userId, authId, displayName.slice(0, 100), cid, effectiveLid]
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

// ── グローバル版（user_id 不要） ─────────────────────

async function listAllAccounts() {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.name, g.customer_id,
              COALESCE(a.login_customer_id, g.login_customer_id) AS login_customer_id,
              g.api_auth_source_id, a.name AS auth_source_name, g.created_at
       FROM google_ads_accounts g
       LEFT JOIN api_auth_sources a ON g.api_auth_source_id = a.id
       ORDER BY g.created_at DESC`
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

async function createAccountGlobal({ name, customerId, loginCustomerId, apiAuthSourceId }) {
  const cid = (customerId || "").trim().replace(/-/g, "");
  const authId = apiAuthSourceId ? parseInt(apiAuthSourceId, 10) : null;
  const displayName = (name || "").trim() || cid;
  if (!cid || !authId) return null;

  let effectiveLid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  if (!effectiveLid) {
    try {
      const [[auth]] = await pool.query("SELECT login_customer_id FROM api_auth_sources WHERE id = ?", [authId]);
      if (auth) effectiveLid = (auth.login_customer_id || "").trim().replace(/-/g, "") || null;
    } catch (_) {}
  }

  const [r] = await pool.query(
    `INSERT INTO google_ads_accounts (user_id, api_auth_source_id, name, customer_id, login_customer_id, is_selected)
     VALUES (NULL, ?, ?, ?, ?, 0)`,
    [authId, displayName.slice(0, 100), cid, effectiveLid]
  );
  return r.insertId;
}

async function deleteAccountGlobal(accountId) {
  const [r] = await pool.query("DELETE FROM google_ads_accounts WHERE id = ?", [accountId]);
  return r.affectedRows > 0;
}

module.exports = {
  listAccounts,
  listAccountsForCompanyUrl,
  getSelectedAccount,
  createAccount,
  setSelectedAccount,
  deleteAccount,
  // グローバル版
  listAllAccounts,
  createAccountGlobal,
  deleteAccountGlobal,
};

/**
 * 案件（company_url）× 広告アカウント紐付け管理
 * company_url_ads_accounts テーブルの CRUD
 */
const pool = require("../db");

/** 案件の全プラットフォーム紐付けを取得 */
async function listAssignments(companyUrlId) {
  try {
    const [rows] = await pool.query(
      `SELECT ca.id, ca.company_url_id, ca.platform, ca.ads_account_id, ca.meta_ad_account_id,
              ca.created_at, ca.updated_at
       FROM company_url_ads_accounts ca
       WHERE ca.company_url_id = ?
       ORDER BY ca.platform`,
      [companyUrlId]
    );
    return rows || [];
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

/** 案件 × プラットフォームの紐付けアカウントを取得（トークン付き） */
async function getAccountForCompanyUrl(companyUrlId, platform) {
  try {
    if (platform === "meta") {
      const [[row]] = await pool.query(
        `SELECT meta_ad_account_id FROM company_url_ads_accounts
         WHERE company_url_id = ? AND platform = 'meta'`,
        [companyUrlId]
      );
      return row ? { meta_ad_account_id: row.meta_ad_account_id } : null;
    }

    const accountTable = platform === "google" ? "google_ads_accounts" : "yahoo_ads_accounts";
    const idCol = platform === "google" ? "customer_id" : "account_id";
    const extraCols = platform === "yahoo" ? ", acc.agency_account_id" : "";
    const loginCidCol = platform === "google" ? ", acc.login_customer_id" : "";

    const [rows] = await pool.query(
      `SELECT acc.id, acc.name, acc.${idCol}${loginCidCol}${extraCols},
              acc.api_auth_source_id,
              auth.refresh_token, auth.access_token, auth.expiry_date,
              auth.login_customer_id AS auth_login_customer_id,
              auth.google_email
       FROM company_url_ads_accounts ca
       JOIN ${accountTable} acc ON ca.ads_account_id = acc.id
       LEFT JOIN api_auth_sources auth ON acc.api_auth_source_id = auth.id
       WHERE ca.company_url_id = ? AND ca.platform = ?
       LIMIT 1`,
      [companyUrlId, platform]
    );
    if (!rows?.length) return null;
    const r = rows[0];
    // login_customer_id は認証元のものを優先（Googleのみ）
    if (platform === "google" && r.auth_login_customer_id && !r.login_customer_id) {
      r.login_customer_id = r.auth_login_customer_id;
    }
    return r;
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return null;
    throw e;
  }
}

/** 案件にアカウントを紐付け（UPSERT） */
async function setAccountForCompanyUrl(companyUrlId, platform, { adsAccountId, metaAdAccountId } = {}) {
  if (platform === "meta") {
    await pool.query(
      `INSERT INTO company_url_ads_accounts (company_url_id, platform, meta_ad_account_id)
       VALUES (?, 'meta', ?)
       ON DUPLICATE KEY UPDATE meta_ad_account_id = VALUES(meta_ad_account_id), updated_at = NOW()`,
      [companyUrlId, (metaAdAccountId || "").trim() || null]
    );
    return true;
  }
  if (!adsAccountId) return false;
  await pool.query(
    `INSERT INTO company_url_ads_accounts (company_url_id, platform, ads_account_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ads_account_id = VALUES(ads_account_id), updated_at = NOW()`,
    [companyUrlId, platform, adsAccountId]
  );
  return true;
}

/** 案件のプラットフォーム紐付けを解除 */
async function removeAccountForCompanyUrl(companyUrlId, platform) {
  const [r] = await pool.query(
    "DELETE FROM company_url_ads_accounts WHERE company_url_id = ? AND platform = ?",
    [companyUrlId, platform]
  );
  return r.affectedRows > 0;
}

module.exports = {
  listAssignments,
  getAccountForCompanyUrl,
  setAccountForCompanyUrl,
  removeAccountForCompanyUrl,
};

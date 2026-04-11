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

async function hasCompanyUrlIdColumn() {
  try {
    const [c] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'company_url_id'");
    return !!(c && c.length);
  } catch (_) {
    return false;
  }
}

/**
 * 案件URL（Target）に紐づく API 認証元のみ。
 * - company_url_id 列がある場合: その Target 専用 + 既存の紐付けテーブル経由で使われている認証元
 * - 列がない場合: 紐付けテーブルのみで推定（後方互換）
 */
async function listForCompanyUrl(companyUrlId, platform = "google") {
  const cid = parseInt(companyUrlId, 10);
  if (!cid) return [];
  try {
    const hasCu = await hasCompanyUrlIdColumn();
    const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
    const hasLid = lidCols?.length > 0;
    const selectCols = hasLid
      ? "DISTINCT a.id, a.name, a.platform, a.login_customer_id, a.google_email, a.created_at"
      : "DISTINCT a.id, a.name, a.platform, a.google_email, a.created_at";

    if (platform === "meta") {
      if (!hasCu) return [];
      const [metaRows] = await pool.query(
        `SELECT ${selectCols} FROM api_auth_sources a WHERE a.platform = 'meta' AND a.company_url_id = ? ORDER BY a.created_at DESC`,
        [cid]
      );
      return metaRows || [];
    }

    const fromLinked = `
      a.id IN (
        SELECT g.api_auth_source_id FROM google_ads_accounts g
        INNER JOIN company_url_ads_accounts cua ON cua.ads_account_id = g.id AND cua.company_url_id = ? AND cua.platform = 'google'
        WHERE g.api_auth_source_id IS NOT NULL
      )
      OR a.id IN (
        SELECT y.api_auth_source_id FROM yahoo_ads_accounts y
        INNER JOIN company_url_ads_accounts cua ON cua.ads_account_id = y.id AND cua.company_url_id = ? AND cua.platform = 'yahoo'
        WHERE y.api_auth_source_id IS NOT NULL
      )`;
    let where;
    const params = [platform];
    if (hasCu) {
      where = `a.platform = ? AND (a.company_url_id = ? OR (${fromLinked}))`;
      params.push(cid, cid, cid);
    } else {
      where = `a.platform = ? AND (${fromLinked})`;
      params.push(cid, cid);
    }
    const [rows] = await pool.query(
      `SELECT ${selectCols} FROM api_auth_sources a WHERE ${where} ORDER BY a.created_at DESC`,
      params
    );
    return rows || [];
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function listAllPlatformsForCompanyUrl(companyUrlId) {
  const g = await listForCompanyUrl(companyUrlId, "google");
  const y = await listForCompanyUrl(companyUrlId, "yahoo");
  const m = await listForCompanyUrl(companyUrlId, "meta");
  return [...g, ...y, ...m].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function create(userId, { name, platform = "google", loginCustomerId, tokens, googleEmail, companyUrlId }) {
  const trimmedName = (name || "").trim().slice(0, 100);
  if (!trimmedName) return null;

  const [[hasTable]] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'api_auth_sources'"
  );
  if (!hasTable) return null;

  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const [lidCols] = await pool.query("SHOW COLUMNS FROM api_auth_sources LIKE 'login_customer_id'");
  const hasLidCol = lidCols?.length > 0;
  const hasCuCol = await hasCompanyUrlIdColumn();
  const cuId = companyUrlId ? parseInt(companyUrlId, 10) : null;
  const cuVal = cuId && !Number.isNaN(cuId) ? cuId : null;

  if (hasLidCol && hasCuCol) {
    const [r] = await pool.query(
      `INSERT INTO api_auth_sources (user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email, company_url_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        trimmedName,
        platform,
        lid,
        tokens?.refresh_token || null,
        tokens?.access_token || null,
        tokens?.expiry_date || null,
        (googleEmail || "").trim().slice(0, 255) || null,
        cuVal,
      ]
    );
    return r.insertId;
  }

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

// ── グローバル版（user_id 不要） ─────────────────────

async function listAll(platform = "google") {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, platform, login_customer_id, google_email, created_at
       FROM api_auth_sources WHERE platform = ? ORDER BY created_at DESC`,
      [platform]
    );
    return rows || [];
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function listAllPlatforms() {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, platform, login_customer_id, google_email, created_at
       FROM api_auth_sources ORDER BY platform, created_at DESC`
    );
    return rows || [];
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return [];
    throw e;
  }
}

async function getByIdGlobal(id) {
  const [[row]] = await pool.query(
    `SELECT id, user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email, created_at
     FROM api_auth_sources WHERE id = ?`,
    [id]
  );
  return row || null;
}

async function createGlobal({ name, platform = "google", loginCustomerId, tokens, googleEmail, companyUrlId }) {
  const trimmedName = (name || "").trim().slice(0, 100);
  if (!trimmedName) return null;
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const hasCuCol = await hasCompanyUrlIdColumn();
  const cuId = companyUrlId ? parseInt(companyUrlId, 10) : null;
  const cuVal = cuId && !Number.isNaN(cuId) ? cuId : null;
  if (hasCuCol) {
    const [r] = await pool.query(
      `INSERT INTO api_auth_sources (user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email, company_url_id)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trimmedName,
        platform,
        lid,
        tokens?.refresh_token || null,
        tokens?.access_token || null,
        tokens?.expiry_date || null,
        (googleEmail || "").trim().slice(0, 255) || null,
        cuVal,
      ]
    );
    return r.insertId;
  }
  const [r] = await pool.query(
    `INSERT INTO api_auth_sources (user_id, name, platform, login_customer_id, refresh_token, access_token, expiry_date, google_email)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [trimmedName, platform, lid, tokens?.refresh_token || null, tokens?.access_token || null, tokens?.expiry_date || null, (googleEmail || "").trim().slice(0, 255) || null]
  );
  return r.insertId;
}

async function updateLoginCustomerIdGlobal(id, loginCustomerId) {
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const [r] = await pool.query(
    "UPDATE api_auth_sources SET login_customer_id = ?, updated_at = NOW() WHERE id = ?",
    [lid, id]
  );
  return r.affectedRows > 0;
}

async function updateTokensGlobal(id, tokens) {
  const [r] = await pool.query(
    `UPDATE api_auth_sources SET access_token = ?, expiry_date = ?, updated_at = NOW() WHERE id = ?`,
    [tokens?.access_token || null, tokens?.expiry_date || null, id]
  );
  return r.affectedRows > 0;
}

async function removeGlobal(id) {
  const [r] = await pool.query("DELETE FROM api_auth_sources WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

module.exports = {
  list,
  getById,
  create,
  updateTokens,
  updateLoginCustomerId,
  remove,
  listForCompanyUrl,
  listAllPlatformsForCompanyUrl,
  hasCompanyUrlIdColumn,
  // グローバル版
  listAll,
  listAllPlatforms,
  getByIdGlobal,
  createGlobal,
  updateLoginCustomerIdGlobal,
  updateTokensGlobal,
  removeGlobal,
};

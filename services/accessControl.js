/**
 * マルチテナント + URL単位アクセス制御
 * - admin/master: 制限なし
 * - 一般ユーザー: company_id 一致 かつ user_url_access に紐づくURLのみ
 */
const pool = require("../db");
const { getAccessibleUrls } = require("./userUrlAccess");

async function getUserWithContext(req) {
  const { getUserIdFromRequest } = require("./session");
  const userId = await getUserIdFromRequest(req);
  if (!userId) return null;

  const [rows] = await pool.query(
    `SELECT id, email, username, role, company_id FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  return rows[0];
}

function isAdmin(user) {
  if (!user) return false;
  const role = (user.role || "").toLowerCase();
  return role === "admin" || role === "master";
}

/** user ロールは閲覧のみ。master/admin のみ作成・削除・再スキャン可能 */
function canWrite(user) {
  if (!user) return false;
  const role = (user.role || "").toLowerCase();
  return role === "admin" || role === "master";
}

/**
 * 同一ドメイン判定（www 除去・小文字）
 */
function canonicalDomain(url) {
  if (!url || typeof url !== "string") return "";
  try {
    let h = new URL(url.trim().replace(/^\/\//, "https://")).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

/**
 * ユーザーがスキャンにアクセス可能か
 * admin: 常に true
 * 一般: user_url_access で同一ドメインのURLへのアクセス権があれば可（スキャンの company_id は問わない）
 */
async function canAccessScan(userId, userCompanyId, userRole, scanId) {
  if (isAdmin({ role: userRole })) return true;

  const [[scan]] = await pool.query("SELECT target_url FROM scans WHERE id = ? LIMIT 1", [scanId]);
  if (!scan) return false;

  const urls = await getAccessibleUrls(userId, userCompanyId);
  const targetCanon = canonicalDomain(scan.target_url);
  const allowedCanons = new Set(urls.map((u) => canonicalDomain(u)));
  return targetCanon && allowedCanons.has(targetCanon);
}

/**
 * ユーザーが target_url にアクセス可能か（スキャン作成時）
 * admin: 常に true
 * 一般: company_id 一致 かつ user_url_access に url_id が含まれる
 */
async function canAccessUrl(userId, userCompanyId, userRole, targetUrl) {
  if (isAdmin({ role: userRole })) return true;

  const urls = await getAccessibleUrls(userId, userCompanyId);
  const targetCanon = canonicalDomain(targetUrl);
  const allowedCanons = new Set(urls.map((u) => canonicalDomain(u)));
  return targetCanon && allowedCanons.has(targetCanon);
}

/**
 * company_urls に URL を登録（存在しなければ作成）
 * @returns { id, created: boolean }
 */
async function ensureCompanyUrl(companyId, url) {
  const { normalizeUrlForKey } = require("./userUrlAccess");
  const canonical = normalizeUrlForKey(url) || url;
  const [existing] = await pool.query(
    `SELECT id FROM company_urls WHERE company_id = ?
     AND (url = ? OR TRIM(TRAILING '/' FROM url) = TRIM(TRAILING '/' FROM ?)) LIMIT 1`,
    [companyId, canonical, url]
  );
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }
  const [r] = await pool.query(
    `INSERT INTO company_urls (company_id, url) VALUES (?, ?)`,
    [companyId, canonical]
  );
  return { id: r.insertId, created: true };
}

/**
 * user_url_access に登録（スキーマに応じて url または url_id で保存）
 * @param {number} userId - ユーザーID
 * @param {number} urlId - company_urls.id（url_direct の場合は URL を取得して保存）
 */
async function grantUserUrlAccess(userId, urlId) {
  const { getSchemaType } = require("./userUrlAccess");
  const schema = await getSchemaType();
  if (schema === "url_direct") {
    const [[row]] = await pool.query("SELECT url FROM company_urls WHERE id = ? LIMIT 1", [urlId]);
    if (row?.url) {
      await pool.query(
        "INSERT INTO user_url_access (user_id, url) VALUES (?, ?)",
        [userId, row.url]
      ).catch(() => {});
    }
  } else {
    const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
    const col = cols.find((c) => c.Field === "url_id" || c.Field === "company_url_id");
    const urlIdCol = col ? col.Field : "url_id";
    await pool.query(
      `INSERT IGNORE INTO user_url_access (user_id, ${urlIdCol}) VALUES (?, ?)`,
      [userId, urlId]
    ).catch(() => {});
  }
}

module.exports = {
  getUserWithContext,
  isAdmin,
  canWrite,
  canAccessScan,
  canAccessUrl,
  ensureCompanyUrl,
  grantUserUrlAccess,
};

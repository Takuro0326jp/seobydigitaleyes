/**
 * マルチテナント + URL単位アクセス制御
 * - admin/master: 制限なし
 * - 一般ユーザー: company_id 一致 かつ user_url_access に紐づくURLのみ
 */
const pool = require("../db");

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
 * ユーザーがスキャンにアクセス可能か
 * admin: 常に true
 * 一般: company_id 一致 かつ user_url_access 経由で target_url にアクセス可能
 */
async function canAccessScan(userId, userCompanyId, userRole, scanId) {
  if (isAdmin({ role: userRole })) return true;

  const [rows] = await pool.query(
    `SELECT s.id
     FROM scans s
     JOIN company_urls cu ON s.target_url = cu.url AND s.company_id = cu.company_id
     JOIN user_url_access ua ON ua.url_id = cu.id
     WHERE s.id = ?
       AND ua.user_id = ?
       AND s.company_id = ?`,
    [scanId, userId, userCompanyId]
  );
  return rows.length > 0;
}

/**
 * ユーザーが target_url にアクセス可能か（スキャン作成時）
 * admin: 常に true
 * 一般: company_id 一致 かつ user_url_access に url_id が含まれる
 */
async function canAccessUrl(userId, userCompanyId, userRole, targetUrl) {
  if (isAdmin({ role: userRole })) return true;

  const [rows] = await pool.query(
    `SELECT cu.id
     FROM company_urls cu
     JOIN user_url_access ua ON ua.url_id = cu.id
     WHERE cu.url = ?
       AND cu.company_id = ?
       AND ua.user_id = ?`,
    [targetUrl, userCompanyId, userId]
  );
  return rows.length > 0;
}

/**
 * company_urls に URL を登録（存在しなければ作成）
 * @returns { id, created: boolean }
 */
async function ensureCompanyUrl(companyId, url) {
  const [existing] = await pool.query(
    `SELECT id FROM company_urls WHERE company_id = ? AND url = ? LIMIT 1`,
    [companyId, url]
  );
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }
  const [r] = await pool.query(
    `INSERT INTO company_urls (company_id, url) VALUES (?, ?)`,
    [companyId, url]
  );
  return { id: r.insertId, created: true };
}

/**
 * user_url_access に登録（重複は無視）
 */
async function grantUserUrlAccess(userId, urlId) {
  await pool.query(
    `INSERT IGNORE INTO user_url_access (user_id, url_id) VALUES (?, ?)`,
    [userId, urlId]
  );
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

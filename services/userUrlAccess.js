/**
 * user_url_access テーブル対応
 * - url_direct: (id, user_id, url) — URLを直接保存
 * - url_id: (user_id, url_id) — company_urls 参照
 */
const pool = require("../db");

let _schemaType = null;

/** URLを正規化（末尾スラッシュ除去・比較・保存用の正規形） */
function normalizeUrlForKey(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const s = String(url).trim();
    if (!s) return "";
    const u = new URL(s.replace(/^\/\//, "https://"));
    u.hash = "";
    u.search = "";
    let p = u.pathname || "/";
    if (p === "/" || p === "") return u.origin; // ルートは末尾スラッシュなしで統一
    if (p.endsWith("/")) p = p.replace(/\/+$/, "") || "/";
    u.pathname = p;
    return u.toString();
  } catch {
    return String(url).trim();
  }
}

async function getSchemaType() {
  if (_schemaType) return _schemaType;
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
    const hasUrl = cols.some((c) => c.Field === "url");
    const hasUrlId = cols.some((c) => c.Field === "url_id" || c.Field === "company_url_id");
    _schemaType = hasUrl ? "url_direct" : hasUrlId ? "url_id" : "url_direct";
  } catch (e) {
    console.warn("[userUrlAccess] SHOW COLUMNS 失敗:", e?.message);
    _schemaType = "url_id";
  }
  return _schemaType;
}

/**
 * ユーザーが閲覧可能なURL一覧を取得
 * - 正規化して重複除去（末尾スラッシュ等）
 * - company_urls に存在しない削除済みURLは除外
 */
async function getAccessibleUrls(userId, companyId = null) {
  const schema = await getSchemaType();
  if (schema === "url_direct") {
    const [uaRows] = await pool.query(
      "SELECT url FROM user_url_access WHERE user_id = ?",
      [userId]
    );
    const rawUrls = (uaRows || []).map((r) => r.url).filter(Boolean);
    if (rawUrls.length === 0) return [];

    const seen = new Map();
    for (const u of rawUrls) {
      const key = normalizeUrlForKey(u);
      if (key && !seen.has(key)) seen.set(key, u);
    }

    if (companyId) {
      const [cuRows] = await pool.query(
        "SELECT url FROM company_urls WHERE company_id = ?",
        [companyId]
      );
      const companyKeys = new Set(
        (cuRows || []).map((r) => normalizeUrlForKey(r.url)).filter(Boolean)
      );
      return [...seen.entries()]
        .filter(([key]) => companyKeys.has(key))
        .map(([, url]) => url);
    }
    return [...seen.values()];
  }
  const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
  const col = cols.find((c) => c.Field === "url_id" || c.Field === "company_url_id");
  const urlIdCol = col ? col.Field : "url_id";
  const [rows] = await pool.query(
    `SELECT cu.url FROM user_url_access ua
     JOIN company_urls cu ON cu.id = ua.${urlIdCol}
     WHERE ua.user_id = ? ${companyId ? "AND cu.company_id = ?" : ""}`,
    companyId ? [userId, companyId] : [userId]
  );
  return (rows || []).map((r) => r.url).filter(Boolean);
}

/**
 * ユーザーの閲覧可能URLを保存（url_ids は company_urls.id の配列）
 */
async function saveUserUrlAccess(userId, urlIds) {
  if (!Array.isArray(urlIds)) return;
  const schema = await getSchemaType();
  await pool.query("DELETE FROM user_url_access WHERE user_id = ?", [userId]);
  const validIds = urlIds.filter((id) => id != null && id !== "");
  if (validIds.length === 0) return;
  if (schema === "url_direct") {
    const [urlRows] = await pool.query(
      "SELECT url FROM company_urls WHERE id IN (?)",
      [validIds]
    );
    const seen = new Set();
    for (const row of urlRows || []) {
      if (!row.url) continue;
      const key = normalizeUrlForKey(row.url);
      if (key && !seen.has(key)) {
        seen.add(key);
        await pool.query(
          "INSERT INTO user_url_access (user_id, url) VALUES (?, ?)",
          [userId, row.url]
        ).catch(() => {});
      }
    }
  } else {
    const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
    const col = cols.find((c) => c.Field === "url_id" || c.Field === "company_url_id");
    const urlIdCol = col ? col.Field : "url_id";
    for (const urlId of validIds) {
      await pool.query(
        `INSERT IGNORE INTO user_url_access (user_id, ${urlIdCol}) VALUES (?, ?)`,
        [userId, urlId]
      ).catch(() => {});
    }
  }
}

/**
 * ユーザーの閲覧可能URLを company_urls 形式で取得（GET /users/:id/url-access 用）
 */
async function getAccessibleUrlsAsCompanyUrls(userId, companyId) {
  const schema = await getSchemaType();
  if (schema === "url_direct") {
    const [uaRows] = await pool.query("SELECT url FROM user_url_access WHERE user_id = ?", [userId]);
    const userKeys = new Set(
      (uaRows || [])
        .map((r) => normalizeUrlForKey(r.url || ""))
        .filter(Boolean)
    );
    if (userKeys.size === 0) return [];
    const [cuRows] = await pool.query(
      "SELECT id, url, company_id FROM company_urls WHERE company_id = ? ORDER BY url",
      [companyId]
    );
    const seen = new Set();
    return (cuRows || [])
      .filter((r) => userKeys.has(normalizeUrlForKey(r.url)))
      .filter((r) => {
        const key = normalizeUrlForKey(r.url);
        if (key && seen.has(key)) return false;
        if (key) seen.add(key);
        return true;
      });
  }
  const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
  const col = cols.find((c) => c.Field === "url_id" || c.Field === "company_url_id");
  const urlIdCol = col ? col.Field : "url_id";
  const [rows] = await pool.query(
    `SELECT cu.id, cu.url, cu.company_id FROM user_url_access ua
     JOIN company_urls cu ON cu.id = ua.${urlIdCol}
     WHERE ua.user_id = ? AND cu.company_id = ? ORDER BY cu.url`,
    [userId, companyId]
  );
  return rows || [];
}

module.exports = {
  getSchemaType,
  getAccessibleUrls,
  saveUserUrlAccess,
  getAccessibleUrlsAsCompanyUrls,
  normalizeUrlForKey,
};

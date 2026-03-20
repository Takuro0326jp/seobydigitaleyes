/**
 * GET /api/sitemap-last  — 最終 sitemap 送信日時
 * POST /api/submit-sitemap — sitemap を Google/Bing に ping
 */
const pool = require("../db");
const { getUserWithContext } = require("../services/accessControl");

function normalizeSiteUrl(url) {
  if (!url || typeof url !== "string") return "";
  const s = url.trim().toLowerCase();
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return u.origin;
  } catch {
    return s;
  }
}

async function handleSitemapLast(req, res) {
  try {
    const user = await getUserWithContext(req);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const siteUrl = normalizeSiteUrl(req.query.site_url || "");

    let rows;
    if (siteUrl) {
      [rows] = await pool.query(
        `SELECT submitted_at FROM sitemap_submissions
         WHERE site_url = ? ORDER BY submitted_at DESC LIMIT 1`,
        [siteUrl]
      );
    } else {
      [rows] = await pool.query(
        `SELECT submitted_at FROM sitemap_submissions
         ORDER BY submitted_at DESC LIMIT 1`
      );
    }
    if (!rows || !rows.length) {
      return res.json({ date: null });
    }
    const submittedAt = rows[0].submitted_at;
    return res.json({ date: submittedAt instanceof Date ? submittedAt.toISOString() : submittedAt });
  } catch (e) {
    // テーブル未作成・DBエラー時は null を返して 500 を避ける
    if (e.code === "ER_NO_SUCH_TABLE" || e.code === "ER_BAD_FIELD_ERROR") {
      return res.json({ date: null });
    }
    console.error("[sitemap-last]", e.code, e.message);
    return res.json({ date: null });
  }
}

async function handleSubmitSitemap(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const siteUrl = normalizeSiteUrl(req.body?.site_url || "");
  if (!siteUrl) {
    return res.status(400).json({ error: "site_url required" });
  }

  const sitemapUrl = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;

  try {
    // Google ping
    await fetch(
      `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
      { method: "GET" }
    ).catch(() => {});
    // Bing ping
    await fetch(
      `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`,
      { method: "GET" }
    ).catch(() => {});

    await pool.query(
      `INSERT INTO sitemap_submissions (site_url) VALUES (?)`,
      [siteUrl]
    );
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") {
      // テーブル未作成時は ping のみ実行（DB エラーは無視）
      return res.json({ ok: true });
    }
    console.error("[submit-sitemap]", e.message);
    return res.status(500).json({ error: "Internal error" });
  }

  return res.json({ ok: true });
}

module.exports = { handleSitemapLast, handleSubmitSitemap };

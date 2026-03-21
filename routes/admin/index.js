/**
 * 管理API (/api/admin/*)
 * admin/master ロールのみアクセス可能
 */
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getAdminUserFromRequest } = require("../../services/session");
const pool = require("../../db");
const { sendInviteEmail } = require("../../services/email");
const {
  getAccessibleUrls,
  saveUserUrlAccess,
  getAccessibleUrlsAsCompanyUrls,
} = require("../../services/userUrlAccess");

const router = express.Router();

async function requireAdmin(req, res, next) {
  const user = await getAdminUserFromRequest(req);
  if (!user) {
    return res.status(403).json({ error: "管理者権限が必要です" });
  }
  req.adminUser = user;
  next();
}

router.use(requireAdmin);

// GET /api/admin/dashboard - ダッシュボード統計
router.get("/dashboard", async (req, res) => {
  try {
    const [[{ users: userCount }]] = await pool.query(
      "SELECT COUNT(*) AS users FROM users"
    );
    const [[{ scans: scanCount }]] = await pool.query(
      "SELECT COUNT(*) AS scans FROM scans"
    );
    const [[{ companies: companyCount }]] = await pool.query(
      "SELECT COUNT(*) AS companies FROM companies"
    ).catch(() => [[{ companies: 0 }]]);
    const [[{ pages: pageCount }]] = await pool.query(
      "SELECT COUNT(*) AS pages FROM scan_pages"
    );

    return res.json({
      users: userCount,
      scans: scanCount,
      companies: companyCount,
      pages: pageCount,
    });
  } catch (e) {
    console.error("admin dashboard:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users - ユーザー一覧
router.get("/users", async (req, res) => {
  try {
    const [baseRows] = await pool.query(
      `SELECT id, email, username, role, created_at, company_id FROM users ORDER BY created_at DESC`
    );
    const rows = [];
    for (const u of baseRows || []) {
      const urls = u.company_id ? await getAccessibleUrls(u.id, u.company_id) : [];
      rows.push({
        ...u,
        url_list: urls.length ? urls.join("\n") : null,
      });
    }
    return res.json(rows);
  } catch (e) {
    console.error("admin users:", e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users - ユーザー作成（通常 or 招待）
router.post("/users", async (req, res) => {
  try {
    const { email, password, username, role, company_id, url_ids, invite } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "email が必要です" });
    }
    const isInvite = !!invite;
    if (!isInvite && !password) {
      return res.status(400).json({ error: "password が必要です（招待の場合は invite: true を指定）" });
    }

    const invitationToken = isInvite ? crypto.randomBytes(32).toString("hex") : null;
    const invitationExpires = isInvite ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;
    const hash = isInvite ? await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10) : await bcrypt.hash(password, 10);

    try {
      await pool.query(
        `INSERT INTO users (email, password, username, role, company_id, invitation_token, invitation_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [email, hash, username || null, role || "user", company_id || null, invitationToken, invitationExpires]
      );
    } catch (colErr) {
      if (colErr?.code === "ER_BAD_FIELD_ERROR" && isInvite) {
        return res.status(500).json({ error: "招待機能を使うにはサーバーを再起動してください。（DBマイグレーションが必要）" });
      }
      throw colErr;
    }
    const [[row]] = await pool.query(
      "SELECT id, email, username, role, created_at FROM users WHERE email = ?",
      [email]
    );
    if (Array.isArray(url_ids) && row) {
      await saveUserUrlAccess(row.id, url_ids);
    }
    if (isInvite && row) {
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const setPasswordUrl = `${baseUrl}/auth/set-password.html?token=${encodeURIComponent(invitationToken)}`;
      await sendInviteEmail({ to: email, setPasswordUrl, username: username || null });
    }
    return res.status(201).json(row);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "このメールアドレスは既に登録されています" });
    }
    console.error("admin users create:", e);
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/users/:id - ユーザー更新（招待再送対応）
router.patch("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { email, username, role, password, company_id, url_ids, invite } = req.body || {};
    const updates = [];
    const values = [];
    const isInviteResend = !!invite;

    if (email !== undefined) {
      updates.push("email = ?");
      values.push(email);
    }
    if (username !== undefined) {
      updates.push("username = ?");
      values.push(username);
    }
    if (role !== undefined) {
      updates.push("role = ?");
      values.push(role);
    }
    if (company_id !== undefined) {
      updates.push("company_id = ?");
      values.push(company_id || null);
    }
    if (password !== undefined && password) {
      updates.push("password = ?");
      values.push(await bcrypt.hash(password, 10));
    }

    let invitationToken = null;
    if (isInviteResend) {
      invitationToken = crypto.randomBytes(32).toString("hex");
      const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      updates.push("invitation_token = ?", "invitation_expires_at = ?");
      values.push(invitationToken, invitationExpires);
    }

    if (updates.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
    }

    if (Array.isArray(url_ids)) {
      await saveUserUrlAccess(id, url_ids);
    }

    if (updates.length === 0 && !Array.isArray(url_ids)) {
      return res.status(400).json({ error: "更新する項目がありません" });
    }

    const [[row]] = await pool.query(
      "SELECT id, email, username, role, created_at FROM users WHERE id = ?",
      [id]
    );
    if (!row) return res.status(404).json({ error: "ユーザーが見つかりません" });

    if (isInviteResend && row.email && invitationToken) {
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const setPasswordUrl = `${baseUrl}/auth/set-password.html?token=${encodeURIComponent(invitationToken)}`;
      await sendInviteEmail({ to: row.email, setPasswordUrl, username: username || row.username || null });
    }

    return res.json(row);
  } catch (e) {
    console.error("admin users update:", e);
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (Number(id) === req.adminUser.id) {
      return res.status(400).json({ error: "自分自身は削除できません" });
    }
    const [r] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("admin users delete:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/companies/:id/urls - 企業のURL一覧
// ?scanned_only=1: スキャン実行済みのURLのみ返す（ユーザー編集モーダルの閲覧可能URL用）
router.get("/companies/:id/urls", async (req, res) => {
  try {
    const companyId = req.params.id;
    const scannedOnly = req.query.scanned_only === "1" || req.query.scanned_only === "true";
    if (scannedOnly) {
      const [rows] = await pool.query(
        `SELECT cu.id, cu.url, cu.created_at
         FROM company_urls cu
         INNER JOIN scans s ON s.company_id = cu.company_id
           AND TRIM(TRAILING '/' FROM IFNULL(s.target_url, '')) = TRIM(TRAILING '/' FROM IFNULL(cu.url, ''))
         WHERE cu.company_id = ?
         GROUP BY cu.id, cu.url, cu.created_at
         ORDER BY cu.url`,
        [companyId]
      );
      // 同一URL（末尾スラッシュ違い）の重複を除去（正規形を1件だけ返す）
      const { normalizeUrlForKey } = require("../../services/userUrlAccess");
      const byKey = new Map();
      for (const r of rows || []) {
        const key = normalizeUrlForKey(r.url);
        if (!key) continue;
        const existing = byKey.get(key);
        if (!existing || !r.url.endsWith("/")) {
          byKey.set(key, r); // 末尾スラッシュなしを優先
        }
      }
      return res.json([...byKey.values()]);
    }
    const [rows] = await pool.query(
      `SELECT id, url, created_at FROM company_urls WHERE company_id = ? ORDER BY url`,
      [companyId]
    );
    return res.json(rows || []);
  } catch (e) {
    console.warn("[admin] company urls:", e?.code, e?.message);
    return res.json([]);
  }
});

// POST /api/admin/companies/:id/urls - 企業にURLを追加
router.post("/companies/:id/urls", async (req, res) => {
  try {
    const companyId = req.params.id;
    const { url } = req.body || {};
    if (!url || !String(url).trim()) {
      return res.status(400).json({ error: "url が必要です" });
    }
    const raw = String(url).trim();
    const { normalizeUrlForKey } = require("../../services/userUrlAccess");
    const canonical = normalizeUrlForKey(raw) || raw;
    // 同一URL（末尾スラッシュ違い等）が既にあればそれを返す
    const [existing] = await pool.query(
      `SELECT id, url, created_at FROM company_urls WHERE company_id = ?
       AND (url = ? OR TRIM(TRAILING '/' FROM url) = TRIM(TRAILING '/' FROM ?)) LIMIT 1`,
      [companyId, canonical, raw]
    );
    if (existing.length > 0) {
      return res.status(200).json(existing[0]);
    }
    const [r] = await pool.query(
      `INSERT INTO company_urls (company_id, url) VALUES (?, ?)`,
      [companyId, canonical]
    );
    const [[row]] = await pool.query(
      `SELECT id, url, created_at FROM company_urls WHERE id = ?`,
      [r.insertId]
    );
    return res.status(201).json(row);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      const [existing] = await pool.query(
        `SELECT id, url, created_at FROM company_urls WHERE company_id = ? AND url = ?`,
        [req.params.id, String(req.body?.url || "").trim()]
      );
      if (existing.length) return res.status(200).json(existing[0]);
    }
    console.error("admin company urls create:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users/:id/url-access - ユーザーの閲覧可能URL一覧（company_id でフィルタ）
router.get("/users/:id/url-access", async (req, res) => {
  try {
    const userId = req.params.id;
    const companyId = req.query.company_id;
    if (!companyId) return res.json([]);
    const rows = await getAccessibleUrlsAsCompanyUrls(userId, companyId);
    return res.json(rows || []);
  } catch (e) {
    console.warn("[admin] url-access:", e?.code, e?.message);
    return res.json([]);
  }
});

// GET /api/admin/companies - 企業一覧
router.get("/companies", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, created_at FROM companies ORDER BY name"
    );
    return res.json(rows);
  } catch (e) {
    console.error("admin companies:", e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/companies - 企業作成
router.post("/companies", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "企業名が必要です" });
    }
    const [r] = await pool.query(
      "INSERT INTO companies (name) VALUES (?)",
      [String(name).trim()]
    );
    const [[row]] = await pool.query(
      "SELECT id, name, created_at FROM companies WHERE id = ?",
      [r.insertId]
    );
    return res.status(201).json(row);
  } catch (e) {
    console.error("admin companies create:", e);
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/companies/:id
router.patch("/companies/:id", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "企業名が必要です" });
    }
    const [r] = await pool.query(
      "UPDATE companies SET name = ? WHERE id = ?",
      [String(name).trim(), req.params.id]
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: "企業が見つかりません" });
    }
    const [[row]] = await pool.query(
      "SELECT id, name, created_at FROM companies WHERE id = ?",
      [req.params.id]
    );
    return res.json(row);
  } catch (e) {
    console.error("admin companies update:", e);
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/companies/:id
router.delete("/companies/:id", async (req, res) => {
  try {
    const [r] = await pool.query("DELETE FROM companies WHERE id = ?", [
      req.params.id,
    ]);
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: "企業が見つかりません" });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("admin companies delete:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scans - スキャン一覧
router.get("/scans", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.target_url, s.status, s.avg_score, s.created_at, s.updated_at,
              u.email AS user_email
       FROM scans s
       LEFT JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC
       LIMIT 500`
    );
    return res.json(rows);
  } catch (e) {
    console.error("admin scans:", e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/scans/reset-stuck - running/queued のまま残ったスキャンを failed にリセット
router.post("/scans/reset-stuck", async (req, res) => {
  try {
    const [r] = await pool.query(
      `UPDATE scans SET status = 'failed', error_message = '手動でリセットしました。再スキャンしてください。'
       WHERE status IN ('running', 'queued')`
    );
    return res.json({
      reset: r?.affectedRows ?? 0,
      message: `${r?.affectedRows ?? 0} 件をリセットしました`,
    });
  } catch (e) {
    console.error("admin reset-stuck:", e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/scans/:id/reset - 指定スキャンを failed にリセット（再スキャン用）
router.post("/scans/:id/reset", async (req, res) => {
  try {
    const scanId = req.params.id;
    const [r] = await pool.query(
      `UPDATE scans SET status = 'failed', error_message = 'リセットしました。再スキャンしてください。'
       WHERE id = ? AND status IN ('running', 'queued')`,
      [scanId]
    );
    if (r?.affectedRows === 0) {
      return res.status(404).json({ error: "対象スキャンが見つからないか、既に完了/失敗済みです" });
    }
    return res.json({ ok: true, message: "リセットしました" });
  } catch (e) {
    console.error("admin scan reset:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/link-analysis - リンク分析（PageRank風）
router.get("/link-analysis", async (req, res) => {
  try {
    const scanId = req.query.scan_id;
    if (!scanId) {
      return res.status(400).json({ error: "scan_id が必要です" });
    }

    const [pages] = await pool.query(
      `SELECT id, url, depth, internal_links, external_links
       FROM scan_pages WHERE scan_id = ? ORDER BY id`,
      [scanId]
    );

    const urlToId = new Map();
    pages.forEach((p, i) => urlToId.set(p.url, i));

    const n = pages.length;
    const linkGraph = pages.map(() => []);

    const [linkRows] = await pool.query(
      `SELECT from_url, to_url FROM scan_links WHERE scan_id = ?`,
      [scanId]
    ).catch(() => [[]]);

    for (const row of linkRows) {
      const fromIdx = urlToId.get(row.from_url);
      const toIdx = urlToId.get(row.to_url);
      if (fromIdx != null && toIdx != null && fromIdx !== toIdx) {
        if (!linkGraph[fromIdx].includes(toIdx)) {
          linkGraph[fromIdx].push(toIdx);
        }
      }
    }

    const outDegree = linkGraph.map((arr) => arr.length || 1);
    let pr = Array(n).fill(1 / n);
    const damping = 0.85;
    const maxIter = 50;

    for (let iter = 0; iter < maxIter; iter++) {
      const next = Array(n).fill((1 - damping) / n);
      for (let i = 0; i < n; i++) {
        for (const j of linkGraph[i]) {
          next[j] += (damping * pr[i]) / outDegree[i];
        }
      }
      pr = next;
    }

    const result = pages.map((p, i) => ({
      url: p.url,
      depth: p.depth,
      internal_links: p.internal_links,
      external_links: p.external_links,
      page_rank: Math.round(pr[i] * 10000) / 10000,
    }));

    result.sort((a, b) => b.page_rank - a.page_rank);

    return res.json({ scan_id: scanId, pages: result });
  } catch (e) {
    console.error("admin link-analysis:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scans/list - スキャンID一覧（link-analysis用）
router.get("/scans/list", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, target_url, status, created_at FROM scans ORDER BY created_at DESC LIMIT 200`
    );
    return res.json(rows);
  } catch (e) {
    console.error("admin scans list:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

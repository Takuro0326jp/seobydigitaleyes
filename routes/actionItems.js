/**
 * 今週やるべきこと - アクションアイテム API
 */
const express = require("express");
const pool = require("../db");
const { getUserWithContext } = require("../services/accessControl");

const router = express.Router();

/** scan へのアクセス権を確認 */
async function assertScanAccess(scanId, user) {
  const { canAccessScan } = require("../services/accessControl");
  const ok = await canAccessScan(user.id, user.company_id, user.role, scanId);
  if (!ok) return false;
  const [[scan]] = await pool.query("SELECT 1 FROM scans WHERE id = ? LIMIT 1", [scanId]);
  return !!scan;
}

/** GET /api/action-items - 未完了アクション上位5件 */
router.get("/", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanId = (req.query.scanId || req.query.scan_id || "").trim();
  if (!scanId) return res.status(400).json({ error: "scanId が必要です" });

  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "スキャンが見つかりません" });
  }

  try {
    const [items] = await pool.query(
      `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, generated_at
       FROM gsc_action_items
       WHERE user_id = ? AND scan_id = ? AND completed_at IS NULL AND dismissed_at IS NULL
       ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC
       LIMIT 5`,
      [user.id, scanId]
    );

    const [[totalRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE user_id = ? AND scan_id = ? AND completed_at IS NULL`,
      [user.id, scanId]
    );
    const [[completedRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE user_id = ? AND scan_id = ? AND completed_at IS NOT NULL`,
      [user.id, scanId]
    );

    res.json({
      items: items.map((r) => ({ ...r, completedAt: r.completed_at })),
      totalPending: totalRow?.cnt ?? 0,
      totalCompleted: completedRow?.cnt ?? 0,
    });
  } catch (e) {
    console.error("[action-items] list:", e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** GET /api/action-items/completed - 完了済み一覧 */
router.get("/completed", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanId = (req.query.scanId || req.query.scan_id || "").trim();
  if (!scanId) return res.status(400).json({ error: "scanId が必要です" });

  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "スキャンが見つかりません" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, scan_id, title, description, priority, effort, source, source_tab, completed_at, generated_at
       FROM gsc_action_items
       WHERE user_id = ? AND scan_id = ? AND completed_at IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT 50`,
      [user.id, scanId]
    );
    res.json({
      items: rows.map((r) => ({ ...r, completedAt: r.completed_at })),
    });
  } catch (e) {
    console.error("[action-items] completed:", e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** GET /api/action-items/all - 全候補（モーダル用） */
router.get("/all", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanId = (req.query.scanId || req.query.scan_id || "").trim();
  if (!scanId) return res.status(400).json({ error: "scanId が必要です" });

  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "スキャンが見つかりません" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, generated_at
       FROM gsc_action_items
       WHERE user_id = ? AND scan_id = ? AND dismissed_at IS NULL
       ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC`,
      [user.id, scanId]
    );
    res.json({
      items: rows.map((r) => ({ ...r, completedAt: r.completed_at })),
    });
  } catch (e) {
    console.error("[action-items] all:", e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** PATCH /api/action-items/:id/complete - 完了にする */
router.patch("/:id/complete", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.params.id;
  try {
    const [result] = await pool.query(
      `UPDATE gsc_action_items SET completed_at = NOW() WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "見つかりません" });
    }
    const [[row]] = await pool.query(
      `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at FROM gsc_action_items WHERE id = ?`,
      [id]
    );
    res.json({ item: { ...row, completedAt: row.completed_at } });
  } catch (e) {
    console.error("[action-items] complete:", e);
    res.status(500).json({ error: "更新に失敗しました" });
  }
});

/** PATCH /api/action-items/:id/undo - 完了を取り消す */
router.patch("/:id/undo", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.params.id;
  try {
    await pool.query(
      `UPDATE gsc_action_items SET completed_at = NULL WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    const [[row]] = await pool.query(
      `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at FROM gsc_action_items WHERE id = ?`,
      [id]
    );
    res.json({ item: row ? { ...row, completedAt: null } : { id } });
  } catch (e) {
    console.error("[action-items] undo:", e);
    res.status(500).json({ error: "更新に失敗しました" });
  }
});

/** POST /api/action-items/generate - アクション生成（内部呼び出し・GSCページ表示時など） */
router.post("/generate", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanId = (req.body?.scanId || req.body?.scan_id || "").trim();
  if (!scanId) return res.status(400).json({ error: "scanId が必要です" });

  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "スキャンが見つかりません" });
  }

  try {
    const { generateActionItems } = require("../services/actionItemGeneration");
    const mockReq = {
      protocol: "https",
      get: (h) => (h === "host" ? (process.env.APP_URL || "localhost:3000").replace(/^https?:\/\//, "") : ""),
    };
    await generateActionItems(scanId, user.id, mockReq);
    res.json({ success: true, message: "アクションを生成しました" });
  } catch (e) {
    console.error("[action-items] generate:", e);
    res.status(500).json({ error: e?.message || "生成に失敗しました" });
  }
});

module.exports = router;

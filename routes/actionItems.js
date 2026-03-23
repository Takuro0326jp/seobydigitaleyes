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

/** GET /api/action-items - 未着手・確認中・件数 */
router.get("/", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanId = (req.query.scanId || req.query.scan_id || "").trim();
  if (!scanId) return res.status(400).json({ error: "scanId が必要です" });

  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "スキャンが見つかりません" });
  }

  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const category = (req.query.category || "").trim();
  const categoryCond =
    category === "duplicate"
      ? " AND (action_type LIKE 'fix_dup_title_%' OR action_type LIKE 'fix_url_param_dup_%')"
      : "";

  try {
    let items, verifying, totalRow, verifyingRow, completedRow;
    try {
      [items] = await pool.query(
        `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, verifying_at, generated_at
         FROM gsc_action_items
       WHERE scan_id = ? AND verifying_at IS NULL AND completed_at IS NULL AND dismissed_at IS NULL${categoryCond}
       ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC
       LIMIT ? OFFSET ?`,
        [scanId, limit, offset]
      );
      [verifying] = await pool.query(
        `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, verifying_at, generated_at
         FROM gsc_action_items
         WHERE scan_id = ? AND verifying_at IS NOT NULL AND completed_at IS NULL AND dismissed_at IS NULL${categoryCond}
         ORDER BY verifying_at ASC`,
        [scanId]
      );
      [[totalRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE scan_id = ? AND verifying_at IS NULL AND completed_at IS NULL AND dismissed_at IS NULL${categoryCond}`,
        [scanId]
      );
      [[verifyingRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE scan_id = ? AND verifying_at IS NOT NULL AND completed_at IS NULL${categoryCond}`,
        [scanId]
      );
      [[completedRow]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE scan_id = ? AND completed_at IS NOT NULL`,
        [scanId]
      );
    } catch (colErr) {
      if (colErr.code === "ER_BAD_FIELD_ERROR" || (colErr.message && colErr.message.includes("verifying_at"))) {
        [items] = await pool.query(
          `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, generated_at
           FROM gsc_action_items
           WHERE scan_id = ? AND completed_at IS NULL AND dismissed_at IS NULL${categoryCond}
           ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC
           LIMIT ? OFFSET ?`,
          [scanId, limit, offset]
        );
        verifying = [];
        [[totalRow]] = await pool.query(
          `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE scan_id = ? AND completed_at IS NULL AND dismissed_at IS NULL${categoryCond}`,
          [scanId]
        );
        verifyingRow = { cnt: 0 };
        [[completedRow]] = await pool.query(
          `SELECT COUNT(*) AS cnt FROM gsc_action_items WHERE scan_id = ? AND completed_at IS NOT NULL`,
          [scanId]
        );
      } else {
        throw colErr;
      }
    }

    res.json({
      items: (items || []).map((r) => ({ ...r, completedAt: r.completed_at, verifyingAt: r.verifying_at })),
      verifying: (verifying || []).map((r) => ({ ...r, completedAt: r.completed_at, verifyingAt: r.verifying_at })),
      totalPending: totalRow?.cnt ?? 0,
      totalVerifying: verifyingRow?.cnt ?? 0,
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
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, scan_id, title, description, priority, effort, source, source_tab, completed_at, verifying_at, generated_at
         FROM gsc_action_items
         WHERE scan_id = ? AND completed_at IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 50`,
        [scanId]
      );
    } catch (colErr) {
      if (colErr.code === "ER_BAD_FIELD_ERROR" || (colErr.message && colErr.message.includes("verifying_at"))) {
        [rows] = await pool.query(
          `SELECT id, scan_id, title, description, priority, effort, source, source_tab, completed_at, generated_at
           FROM gsc_action_items
           WHERE scan_id = ? AND completed_at IS NOT NULL
           ORDER BY completed_at DESC
           LIMIT 50`,
          [scanId]
        );
      } else {
        throw colErr;
      }
    }
    res.json({
      items: (rows || []).map((r) => ({ ...r, completedAt: r.completed_at, verifyingAt: r.verifying_at })),
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
    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, verifying_at, generated_at
         FROM gsc_action_items
         WHERE scan_id = ? AND dismissed_at IS NULL
         ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC`,
        [scanId]
      );
    } catch (colErr) {
      if (colErr.code === "ER_BAD_FIELD_ERROR" || (colErr.message && colErr.message.includes("verifying_at"))) {
        [rows] = await pool.query(
          `SELECT id, scan_id, title, description, priority, effort, source, source_tab, action_type, completed_at, generated_at
           FROM gsc_action_items
           WHERE scan_id = ? AND dismissed_at IS NULL
           ORDER BY FIELD(priority, 'high', 'medium', 'low'), generated_at ASC`,
          [scanId]
        );
      } else {
        throw colErr;
      }
    }
    res.json({
      items: (rows || []).map((r) => ({ ...r, completedAt: r.completed_at, verifyingAt: r.verifying_at })),
    });
  } catch (e) {
    console.error("[action-items] all:", e);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** PATCH /api/action-items/:id/verify - 確認中にする（チェックを入れた時） */
router.patch("/:id/verify", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.params.id;
  try {
    const [[item]] = await pool.query(
      "SELECT scan_id, completed_at FROM gsc_action_items WHERE id = ? LIMIT 1",
      [id]
    );
    if (!item || !(await assertScanAccess(item.scan_id, user))) {
      return res.status(404).json({ error: "見つかりません" });
    }
    if (item.completed_at) {
      return res.status(400).json({ error: "既に完了済みです" });
    }
    let result;
    try {
      [result] = await pool.query(
        `UPDATE gsc_action_items SET verifying_at = NOW() WHERE id = ? AND completed_at IS NULL`,
        [id]
      );
    } catch (upErr) {
      if (upErr.code === "ER_BAD_FIELD_ERROR" || (upErr.message && upErr.message.includes("verifying_at"))) {
        [result] = await pool.query(
          `UPDATE gsc_action_items SET completed_at = NOW() WHERE id = ? AND completed_at IS NULL`,
          [id]
        );
      } else {
        throw upErr;
      }
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "見つかりません" });
    }
    const [[row]] = await pool.query(
      `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at FROM gsc_action_items WHERE id = ?`,
      [id]
    );
    res.json({ item: { ...row, completedAt: row.completed_at, verifyingAt: row.verifying_at } });
  } catch (e) {
    console.error("[action-items] verify:", e);
    res.status(500).json({ error: "更新に失敗しました" });
  }
});

/** PATCH /api/action-items/:id/complete - 完了にする（サイト確認後） */
router.patch("/:id/complete", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.params.id;
  try {
    const [[item]] = await pool.query(
      "SELECT scan_id, completed_at FROM gsc_action_items WHERE id = ? LIMIT 1",
      [id]
    );
    if (!item || !(await assertScanAccess(item.scan_id, user))) {
      return res.status(404).json({ error: "見つかりません" });
    }
    if (item.completed_at) {
      return res.status(400).json({ error: "既に完了済みです" });
    }
    const [result] = await pool.query(
      `UPDATE gsc_action_items SET completed_at = NOW() WHERE id = ? AND completed_at IS NULL`,
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "見つかりません" });
    }
    const [[row]] = await pool.query(
      `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at FROM gsc_action_items WHERE id = ?`,
      [id]
    );
    res.json({ item: { ...row, completedAt: row.completed_at, verifyingAt: row.verifying_at } });
  } catch (e) {
    console.error("[action-items] complete:", e);
    res.status(500).json({ error: "更新に失敗しました" });
  }
});

/** PATCH /api/action-items/:id/undo - 確認中→未着手 または 完了→確認中 に戻す */
router.patch("/:id/undo", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.params.id;
  try {
    let item;
    try {
      [[item]] = await pool.query(
        "SELECT scan_id, verifying_at, completed_at FROM gsc_action_items WHERE id = ? LIMIT 1",
        [id]
      );
    } catch (colErr) {
      if (colErr.code === "ER_BAD_FIELD_ERROR" || (colErr.message && colErr.message.includes("verifying_at"))) {
        [[item]] = await pool.query(
          "SELECT scan_id, completed_at FROM gsc_action_items WHERE id = ? LIMIT 1",
          [id]
        );
        item = { ...item, verifying_at: null };
      } else {
        throw colErr;
      }
    }
    if (!item || !(await assertScanAccess(item.scan_id, user))) {
      return res.status(404).json({ error: "見つかりません" });
    }
    if (item.completed_at) {
      await pool.query(
        `UPDATE gsc_action_items SET completed_at = NULL WHERE id = ?`,
        [id]
      );
    } else if (item.verifying_at) {
      await pool.query(
        `UPDATE gsc_action_items SET verifying_at = NULL WHERE id = ?`,
        [id]
      );
    } else {
      const [[row]] = await pool.query(
        `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at FROM gsc_action_items WHERE id = ?`,
        [id]
      );
      return res.json({ item: row ? { ...row, completedAt: row.completed_at, verifyingAt: null } : { id } });
    }
    const [[row]] = await pool.query(
      `SELECT id, scan_id, title, priority, effort, source, source_tab, completed_at, verifying_at FROM gsc_action_items WHERE id = ?`,
      [id]
    );
    res.json({ item: row ? { ...row, completedAt: row.completed_at, verifyingAt: row.verifying_at } : { id } });
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

/**
 * Meta（Facebook）広告 API
 * GET /api/meta/adaccounts - 広告アカウント一覧取得
 * GET /api/meta/insights - Insights データ取得（.env の META_ACCESS_TOKEN を使用）
 */
const express = require("express");
const router = express.Router();
const { getUserWithContext } = require("../services/accessControl");
const { fetchMetaInsightsReport } = require("../services/ads/metaAds");

/** GET /api/meta/adaccounts - Meta Graph API で広告アカウント一覧を取得 */
router.get("/adaccounts", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return res.status(400).json({ error: "META_ACCESS_TOKEN が .env に設定されていません" });

  try {
    const all = [];
    let url = "https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name&limit=100&access_token=" + encodeURIComponent(token);

    while (url) {
      const resp = await fetch(url);
      const d = await resp.json().catch(() => ({}));

      if (d.error) {
        const errMsg = d.error?.code === 190 || /invalid|expired/i.test(d.error?.message || "")
          ? "トークンが無効です。.env の META_ACCESS_TOKEN を確認してください"
          : (d.error.message || "取得に失敗しました");
        return res.status(500).json({ error: errMsg, fbError: d.error });
      }

      const data = d.data || [];
      all.push(...data);
      url = d.paging?.next || null;
    }

    const accounts = all.map((a) => ({
      id: (a.id || "").startsWith("act_") ? a.id : "act_" + (a.id || ""),
      name: a.name || "（名前なし）",
    }));

    res.json({ accounts });
  } catch (e) {
    console.error("[meta] adaccounts error:", e.message);
    res.status(500).json({ error: "エラー: " + (e.message || "通信失敗") });
  }
});

/** GET /api/meta/insights - Marketing API Insights 取得 */
router.get("/insights", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return res.status(400).json({ error: "META_ACCESS_TOKEN が .env に設定されていません" });

  const adAccountId = (req.query.ad_account_id || req.query.adAccountId || "").trim();
  const dateFrom = (req.query.date_from || req.query.startDate || "").trim();
  const dateTo = (req.query.date_to || req.query.endDate || "").trim();

  if (!adAccountId) return res.status(400).json({ error: "ad_account_id を指定してください" });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: "date_from と date_to を指定してください" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
    return res.status(400).json({ error: "date_from, date_to は YYYY-MM-DD 形式で、date_from <= date_to にしてください" });
  }

  try {
    const result = await fetchMetaInsightsReport(adAccountId, dateFrom, dateTo);
    if (result.meta?.error) {
      return res.status(500).json({ error: result.meta.error });
    }
    res.json(result);
  } catch (e) {
    console.error("[meta] insights error:", e.message);
    res.status(500).json({ error: "エラー: " + (e.message || "通信失敗") });
  }
});

module.exports = router;

/**
 * 今週やるべきこと - アクションアイテム自動生成
 * スキャン完了後または GSC ページ表示時に呼び出し
 */
const pool = require("../db");
const { getAuthenticatedClient } = require("../services/googleOAuth");
const { searchconsole } = require("@googleapis/searchconsole");

function normalizePropertyUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("sc-domain:")) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      u.hash = "";
      u.search = "";
      let p = u.pathname || "/";
      if (!p.endsWith("/")) p += "/";
      return u.origin + p;
    } catch {
      return null;
    }
  }
  return `sc-domain:${s.replace(/^sc-domain:/, "").split("/")[0].split("?")[0]}`;
}

/**
 * アクション生成メイン
 * @param {string} scanId
 * @param {number} userId
 * @param {object} req - Express req（getAuthenticatedClient 用。バックグラウンド呼び出し時は mockReq）
 */
async function generateActionItems(scanId, userId, req) {
  // スキャン情報取得
  const [[scan]] = await pool.query(
    "SELECT user_id, gsc_property_url, target_url FROM scans WHERE id = ? LIMIT 1",
    [scanId]
  );
  if (!scan) return;

  // 完了済み action_type（再生成しない）
  const [completedRows] = await pool.query(
    "SELECT action_type FROM gsc_action_items WHERE user_id = ? AND completed_at IS NOT NULL",
    [userId]
  );
  const completedTypes = new Set(completedRows.map((r) => r.action_type));

  // scan_pages 取得
  const [pagesRows] = await pool.query(
    `SELECT url, status_code, is_noindex, is_orphan, inbound_link_count
     FROM scan_pages WHERE scan_id = ?`,
    [scanId]
  );
  const pages = pagesRows || [];

  // scan_links 取得（404＋内部リンク経由の判定用）
  const [linksRows] = await pool.query(
    "SELECT from_url, to_url FROM scan_links WHERE scan_id = ?",
    [scanId]
  );
  const linkEdges = linksRows || [];
  const toUrlSet = new Set(linkEdges.map((e) => e.to_url));
  const urlToPage = new Map(pages.map((p) => [p.url, p]));

  const candidates = [];

  // ===== High: 内部リンク経由の404 =====
  const deadLinks = pages.filter((p) => p.status_code === 404 && toUrlSet.has(p.url));
  if (deadLinks.length > 0 && !completedTypes.has("fix_404_internal")) {
    candidates.push({
      scanId,
      userId,
      actionType: "fix_404_internal",
      priority: "high",
      title: `404エラー ${deadLinks.length}件を301リダイレクトで修正する`,
      description: `内部リンクから遷移する404が${deadLinks.length}件あります。そのままにするとPageRankが損失します。301リダイレクトで正しいURLに転送してください。`,
      effort: "1時間",
      source: "GSC: カバレッジ",
      sourceTab: "INDEX HEALTH",
    });
  }

  // ===== High: noindex 誤設定 =====
  const noindexPages = pages.filter((p) => p.is_noindex);
  if (noindexPages.length > 0 && !completedTypes.has("fix_noindex_error")) {
    candidates.push({
      scanId,
      userId,
      actionType: "fix_noindex_error",
      priority: "high",
      title: `noindex誤設定のページ ${noindexPages.length}件を修正する`,
      description: `意図せずnoindexが設定されているページが${noindexPages.length}件あります。Googleにインデックスされていない可能性があります。`,
      effort: "30分",
      source: "GSC: カバレッジ",
      sourceTab: "INDEX HEALTH",
    });
  }

  // ===== Medium: 孤立ページ =====
  const orphanPages = pages.filter((p) => p.is_orphan);
  if (orphanPages.length > 5 && !completedTypes.has("fix_orphan_pages")) {
    candidates.push({
      scanId,
      userId,
      actionType: "fix_orphan_pages",
      priority: "medium",
      title: `孤立ページ上位5件に内部リンクを追加する`,
      description: `被リンク0のページが${orphanPages.length}件あります。関連ページからリンクを張ることでPageRankが流れ、検索順位の改善が期待できます。`,
      effort: "30分",
      source: "内部リンク構造",
      sourceTab: "LINK STRUCTURE",
    });
  }

  // ===== GSC データがあれば追加 =====
  const propertyUrl = normalizePropertyUrl(scan.gsc_property_url);
  if (propertyUrl) {
    const client = await getAuthenticatedClient(userId, req, scanId);
    if (client) {
      try {
        const gsc = searchconsole({ version: "v1", auth: client });
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const startStr = startDate.toISOString().slice(0, 10);
        const endStr = endDate.toISOString().slice(0, 10);

        const { data: perfData } = await gsc.searchanalytics.query({
          siteUrl: propertyUrl,
          requestBody: {
            startDate: startStr,
            endDate: endStr,
            dimensions: ["page"],
            rowLimit: 500,
            aggregationType: "byPage",
          },
        });
        const gscRows = perfData?.rows || [];

        const gscPages = gscRows.map((row) => {
          const keys = row.keys || [];
          const url = keys[0] || "";
          const impressions = Number(row.impressions) || 0;
          const ctr = Number(row.ctr) || 0;
          const position = Number(row.position) || 0;
          return { url, impressions, ctr, position };
        });

        // High: CTR が低い（表示100以上・CTR2%未満）
        const lowCtrPages = gscPages
          .filter((p) => p.impressions >= 100 && p.ctr < 0.02)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 3);
        if (lowCtrPages.length > 0 && !completedTypes.has("improve_ctr_title")) {
          const topUrl = lowCtrPages[0]?.url || "";
          candidates.push({
            scanId,
            userId,
            actionType: "improve_ctr_title",
            priority: "high",
            title: `CTRが低い${lowCtrPages.length}ページのタイトルを改善する`,
            description: `${topUrl} など${lowCtrPages.length}ページのCTRが2%未満です。タイトルにキーワードを含め、クリックされやすい文言に変更してください。`,
            effort: "30分",
            source: "GSC: CTR分析",
            sourceTab: "PERFORMANCE",
          });
        }

        // Medium: 11〜20位のページ
        const nearTopPages = gscPages
          .filter((p) => p.position >= 11 && p.position <= 20 && p.impressions >= 50)
          .sort((a, b) => b.impressions - a.impressions);
        if (nearTopPages.length > 0 && !completedTypes.has("boost_near_top")) {
          candidates.push({
            scanId,
            userId,
            actionType: "boost_near_top",
            priority: "medium",
            title: `11〜20位のページ${nearTopPages.length}件に内部リンクを追加する`,
            description:
              "もう少しで1ページ目に入れるページです。関連ページからの内部リンク追加で順位改善が期待できます。",
            effort: "45分",
            source: "GSC: 検索パフォーマンス",
            sourceTab: "OPPORTUNITIES",
          });
        }
      } catch (err) {
        console.warn("[actionItemGeneration] GSC fetch failed:", err?.message);
      }
    }
  }

  // DB に挿入（UNIQUE 制約で重複スキップ）
  for (const item of candidates) {
    try {
      await pool.query(
        `INSERT IGNORE INTO gsc_action_items
          (scan_id, user_id, action_type, priority, title, description, effort, source, source_tab)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.scanId,
          item.userId,
          item.actionType,
          item.priority,
          item.title,
          item.description,
          item.effort,
          item.source,
          item.sourceTab,
        ]
      );
    } catch (e) {
      console.warn("[actionItemGeneration] insert skip:", e?.message);
    }
  }
}

module.exports = { generateActionItems };

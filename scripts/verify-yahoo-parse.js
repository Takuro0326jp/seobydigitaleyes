#!/usr/bin/env node
/**
 * Yahoo Ads パース検証 - キャンペーンレポートの解析結果を確認
 * 実行: node scripts/verify-yahoo-parse.js [month]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

async function main() {
  const month = process.argv[2] || "";
  const now = new Date();
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const pad = (n) => String(n).padStart(2, "0");
  const startDate = `${y}-${pad(m)}-01`;
  const endDate = `${y}-${pad(m)}-${new Date(y, m, 0).getDate()}`;

  let userId = 1;
  try {
    const pool = require("../db");
    const [rows] = await pool.query(
      "SELECT user_id FROM yahoo_ads_accounts LIMIT 1"
    );
    if (rows.length) userId = rows[0].user_id;
  } catch (e) {}

  console.log("[verify] 期間:", startDate, "〜", endDate, "userId:", userId);

  const { fetchYahooAdsReportWithMeta } = require("../services/ads/yahooAds");
  const result = await fetchYahooAdsReportWithMeta(startDate, endDate, userId, {});
  const rows = result.rows || [];
  console.log("[verify] campaign rows:", rows.length);
  if (rows.length > 0) {
    console.log("[verify] rows[0]:", JSON.stringify(rows[0], null, 2));
    const r = rows[0];
    const ok = (r.impressions > 0 || r.clicks > 0 || r.cost > 0 || (r.campaign && r.campaign.trim()));
    console.log("[verify]", ok ? "OK: データあり" : "WARN: すべて0またはcampaign空");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

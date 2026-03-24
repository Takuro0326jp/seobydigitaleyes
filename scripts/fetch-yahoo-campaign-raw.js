#!/usr/bin/env node
/**
 * Yahoo Ads キャンペーンレポートの生データを取得（パーサー診断用）
 * 実行: node scripts/fetch-yahoo-campaign-raw.js [month]
 * 例: node scripts/fetch-yahoo-campaign-raw.js 2025-02
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

async function main() {
  const month = process.argv[2] || "";
  const now = new Date();
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const pad = (n) => String(n).padStart(2, "0");
  const startDate = `${y}-${pad(m)}-01`;
  const endDate = `${y}-${pad(m)}-${new Date(y, m, 0).getDate()}`;
  console.log("[Yahoo raw] 期間:", startDate, "〜", endDate);

  let userId = null;
  try {
    const pool = require("../db");
    const [rows] = await pool.query(
      "SELECT u.id FROM users u INNER JOIN yahoo_ads_accounts ya ON ya.user_id = u.id WHERE ya.refresh_token IS NOT NULL LIMIT 1"
    );
    if (rows.length) userId = rows[0].id;
  } catch (e) {
    console.warn("[Yahoo raw] DB:", e.message);
  }
  if (!userId) userId = 1;

  const { getCampaignRawDownload } = require("../services/ads/yahooAds");
  const result = await getCampaignRawDownload(startDate, endDate, userId);
  if (result.error) {
    console.error("[Yahoo raw] エラー:", result.error);
    process.exit(1);
  }
  console.log("[Yahoo raw] contentType:", result.contentType);
  console.log("[Yahoo raw] lineCount:", result.lineCount);
  console.log("\n--- raw (先頭5000文字) ---\n");
  console.log(result.raw?.slice(0, 5000) || "(空)");
  console.log("\n--- 終了 ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

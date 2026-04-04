#!/usr/bin/env node
/**
 * Google Ads API テスト
 * MCC=9838710115, Customer ID=4211317572 でデータ取得を試行
 *
 * 実行: node scripts/test-google-ads-api.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const MCC_ID = "9838710115";
const CUSTOMER_ID = "4211317572";

async function main() {
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();

  let refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  if (!refreshToken) {
    try {
      const pool = require("../db");
      const [rows] = await pool.query(
        "SELECT refresh_token, login_customer_id FROM api_auth_sources WHERE platform = 'google' AND refresh_token IS NOT NULL ORDER BY id DESC LIMIT 1"
      );
      if (rows.length) {
        refreshToken = rows[0].refresh_token || "";
        console.log("[test] api_auth_sources から refresh_token を使用 (login_customer_id:", rows[0].login_customer_id || "未設定", ")");
      }
    } catch (dbErr) {
      console.warn("[test] DB接続スキップ:", dbErr.message);
    }
  } else {
    console.log("[test] GOOGLE_ADS_REFRESH_TOKEN を使用");
  }

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    console.error("不足: developerToken=" + !!developerToken + " clientId=" + !!clientId + " clientSecret=" + !!clientSecret + " refreshToken=" + !!refreshToken);
    process.exit(1);
  }

  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const endDate = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  console.log("\n[test] パラメータ:");
  console.log("  MCC (login_customer_id):", MCC_ID);
  console.log("  Customer ID:", CUSTOMER_ID);
  console.log("  期間:", startDate, "〜", endDate);

  const { GoogleAdsApi } = require("google-ads-api");
  const client = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = client.Customer({
    customer_id: CUSTOMER_ID,
    login_customer_id: MCC_ID,
    refresh_token: refreshToken,
  });

  console.log("\n[test] 1. customer 情報取得 (SELECT customer.id, customer.manager)");
  try {
    const custResult = await customer.query("SELECT customer.id, customer.manager, customer.descriptive_name FROM customer LIMIT 1");
    const toArr = (r) => (Array.isArray(r) ? r : r?.results || r?.rows || []);
    let custRows = toArr(custResult);
    if (custRows.length === 0 && custResult && typeof custResult[Symbol.asyncIterator] === "function") {
      custRows = [];
      for await (const row of custResult) custRows.push(row);
    }
    const row = custRows[0];
    console.log("  →", JSON.stringify(row, null, 2));
    if (row?.customer?.manager === true) {
      console.log("  ★ このアカウントは MCC です。metrics は取得できません");
    }
  } catch (e) {
    console.error("  ✗ エラー:", e.message || e.toString());
    if (e.response?.data) console.error("  response.data:", JSON.stringify(e.response.data));
    if (e.errors?.length) console.error("  errors:", JSON.stringify(e.errors));
  }

  console.log("\n[test] 2. campaign 取得 (report, 日付指定)");
  try {
    const reportResult = await customer.report({
      entity: "campaign",
      attributes: ["campaign.id", "campaign.name"],
      metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros", "metrics.conversions"],
      segments: ["segments.date"],
      from_date: startDate,
      to_date: endDate,
    });
    const rows = Array.isArray(reportResult) ? reportResult : reportResult?.results || reportResult?.rows || [];
    console.log("  → 件数:", rows.length);
    if (rows.length > 0) {
      console.log("  → 先頭1件:", JSON.stringify(rows[0], null, 2).slice(0, 800));
    }
  } catch (e) {
    console.error("  ✗ エラー:", e.message || e.toString());
    if (e.response?.data) console.error("  response.data:", JSON.stringify(e.response.data));
    if (e.errors?.length) console.error("  errors:", JSON.stringify(e.errors));
  }

  console.log("\n[test] 3. campaign 取得 (GAQL, LAST_30_DAYS)");
  try {
    const gaql = `SELECT campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED'`;
    const result = await customer.query(gaql);
    let campaigns = Array.isArray(result) ? result : result?.results || result?.rows || [];
    if (campaigns.length === 0 && result && typeof result[Symbol.asyncIterator] === "function") {
      campaigns = [];
      for await (const r of result) campaigns.push(r);
    }
    console.log("  → 件数:", campaigns.length);
    if (campaigns.length > 0) {
      console.log("  → 先頭1件:", JSON.stringify(campaigns[0], null, 2).slice(0, 800));
    }
  } catch (e) {
    console.error("  ✗ エラー:", e.message || e.toString());
    if (e.response?.data) console.error("  response.data:", JSON.stringify(e.response.data));
    if (e.errors?.length) console.error("  errors:", JSON.stringify(e.errors));
  }

  // routes/ads.js GET .../auth-sources/:id/clients と同一（REST googleAds:search + customer_client）
  const loginForRest = MCC_ID;
  console.log("\n[test] 4. REST customer_client（アプリと同じ URL / ヘッダー / GAQL）");
  const gaqlClients = [
    "SELECT customer_client.id, customer_client.descriptive_name,",
    "customer_client.manager, customer_client.status",
    "FROM customer_client",
    "WHERE customer_client.manager = false",
  ].join(" ");
  const apiVersion = "v23";
  const searchUrl = `https://googleads.googleapis.com/${apiVersion}/customers/${loginForRest}/googleAds:search`;
  try {
    const { OAuth2Client } = require("google-auth-library");
    const oauth2 = new OAuth2Client(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const tok = await oauth2.getAccessToken();
    const accessToken = tok?.token || null;
    if (!accessToken) {
      console.error("  ✗ アクセストークンが取得できませんでした");
    } else {
      const searchResp = await fetch(searchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "login-customer-id": loginForRest,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaqlClients, pageSize: 1000 }),
      });
      const text = await searchResp.text();
      console.log("  → HTTP", searchResp.status);
      if (!searchResp.ok) {
        console.log("  ✗ 本文（先頭800文字）:", text.slice(0, 800));
      } else {
        const data = JSON.parse(text);
        const n = (data.results || []).length;
        console.log("  → results 件数:", n);
        if (n > 0) console.log("  → 先頭1件:", JSON.stringify(data.results[0], null, 2).slice(0, 600));
      }
    }
  } catch (e) {
    console.error("  ✗ エラー:", e.message || e);
  }

  console.log("\n[test] 完了");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Google Ads OAuth2 クライアント
 * スコープ: https://www.googleapis.com/auth/adwords
 */
const { OAuth2Client } = require("google-auth-library");
const pool = require("../db");

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

function getOAuth2Client(redirectUri) {
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function getRedirectUri(req) {
  const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/api/ads/google/callback`;
}

async function getTokensForUser(userId) {
  const [rows] = await pool.query(
    "SELECT customer_id, login_customer_id, access_token, refresh_token, expiry_date FROM google_ads_tokens WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0] : null;
}

async function saveTokensForUser(userId, customerId, tokens, loginCustomerId = null) {
  const cid = (customerId || "").trim().replace(/-/g, "");
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const accessToken = tokens.access_token || null;
  const refreshToken = tokens.refresh_token || null;
  const expiryDate = tokens.expiry_date || null;

  const cidVal = cid && cid.length > 0 ? cid : null;
  const [cols] = await pool.query("SHOW COLUMNS FROM google_ads_tokens LIKE 'login_customer_id'");
  const hasLoginCol = cols && cols.length > 0;
  if (hasLoginCol) {
    await pool.query(
      `INSERT INTO google_ads_tokens (user_id, customer_id, login_customer_id, access_token, refresh_token, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = IF(VALUES(customer_id) IS NOT NULL AND VALUES(customer_id) != '', VALUES(customer_id), customer_id),
         login_customer_id = VALUES(login_customer_id),
         access_token = VALUES(access_token),
         refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
         expiry_date = VALUES(expiry_date),
         updated_at = NOW()`,
      [userId, cidVal, lid, accessToken, refreshToken, expiryDate]
    );
  } else {
    await pool.query(
      `INSERT INTO google_ads_tokens (user_id, customer_id, access_token, refresh_token, expiry_date)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = IF(VALUES(customer_id) IS NOT NULL AND VALUES(customer_id) != '', VALUES(customer_id), customer_id),
         access_token = VALUES(access_token),
         refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
         expiry_date = VALUES(expiry_date),
         updated_at = NOW()`,
      [userId, cidVal, accessToken, refreshToken, expiryDate]
    );
  }
}

async function deleteTokensForUser(userId) {
  await pool.query("DELETE FROM google_ads_tokens WHERE user_id = ?", [userId]);
}

async function updateLoginCustomerId(userId, loginCustomerId) {
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const [cols] = await pool.query("SHOW COLUMNS FROM google_ads_tokens LIKE 'login_customer_id'");
  if (!cols?.length) return false;
  await pool.query(
    "UPDATE google_ads_tokens SET login_customer_id = ?, updated_at = NOW() WHERE user_id = ?",
    [lid, userId]
  );
  return true;
}

/** Customer ID と MCC Login Customer ID をまとめて更新（OAuth未連携でも行がなければINSERT） */
async function updateGoogleAdsIds(userId, customerId, loginCustomerId) {
  const cid = (customerId || "").trim().replace(/-/g, "") || null;
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  const [cols] = await pool.query("SHOW COLUMNS FROM google_ads_tokens LIKE 'login_customer_id'");
  const hasLoginCol = cols && cols.length > 0;
  if (hasLoginCol) {
    await pool.query(
      `INSERT INTO google_ads_tokens (user_id, customer_id, login_customer_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = COALESCE(VALUES(customer_id), customer_id),
         login_customer_id = VALUES(login_customer_id),
         updated_at = NOW()`,
      [userId, cid, lid]
    );
  } else {
    await pool.query(
      `INSERT INTO google_ads_tokens (user_id, customer_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         customer_id = COALESCE(VALUES(customer_id), customer_id),
         updated_at = NOW()`,
      [userId, cid]
    );
  }
  return true;
}

/** トークンを使って google-auth-library の OAuth2Client を返す */
async function getAuthenticatedClient(userId, req, customerIdOverride = null) {
  const tokens = await getTokensForUser(userId);
  if (!tokens?.refresh_token) return null;

  const redirectUri = getRedirectUri(req);
  const client = getOAuth2Client(redirectUri);
  if (!client) return null;

  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date ? Number(tokens.expiry_date) : null,
  });

  const expiry = tokens.expiry_date ? Number(tokens.expiry_date) : 0;
  if (expiry && Date.now() >= expiry - 5 * 60 * 1000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      await saveTokensForUser(userId, tokens.customer_id || customerIdOverride, credentials);
      client.setCredentials(credentials);
    } catch (e) {
      console.warn("[Google Ads OAuth] token refresh failed:", e.message);
      return null;
    }
  }

  return {
    client,
    customerId: customerIdOverride || tokens.customer_id,
  };
}

module.exports = {
  ADS_SCOPE,
  getOAuth2Client,
  getRedirectUri,
  getTokensForUser,
  saveTokensForUser,
  deleteTokensForUser,
  updateLoginCustomerId,
  updateGoogleAdsIds,
  getAuthenticatedClient,
};

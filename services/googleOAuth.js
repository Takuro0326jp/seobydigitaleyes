/**
 * Google OAuth2 クライアント（GSC 連携用）
 * URL（scan）ごとに別の Google アカウントと連携可能
 */
const { OAuth2Client } = require("google-auth-library");
const pool = require("../db");

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];

function getOAuth2Client(redirectUri) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function getRedirectUri(req) {
  const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** ユーザー全体のトークン（後方互換・非推奨） */
async function getTokensForUser(userId) {
  const [rows] = await pool.query(
    "SELECT access_token, refresh_token, expiry_date FROM user_google_tokens WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length ? rows[0] : null;
}

async function saveTokensForUser(userId, tokens) {
  const accessToken = tokens.access_token || null;
  const refreshToken = tokens.refresh_token || null;
  const expiryDate = tokens.expiry_date || null;

  await pool.query(
    `INSERT INTO user_google_tokens (user_id, access_token, refresh_token, expiry_date)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       expiry_date = VALUES(expiry_date),
       updated_at = NOW()`,
    [userId, accessToken, refreshToken, expiryDate]
  );
}

async function deleteTokensForUser(userId) {
  await pool.query("DELETE FROM user_google_tokens WHERE user_id = ?", [userId]);
}

/** URL（scan）ごとのトークン取得 */
async function getTokensForScan(scanId, userId) {
  if (!scanId) return null;
  const [rows] = await pool.query(
    "SELECT access_token, refresh_token, expiry_date FROM scan_google_tokens WHERE scan_id = ? AND user_id = ? LIMIT 1",
    [scanId, userId]
  );
  return rows.length ? rows[0] : null;
}

/** URL（scan）ごとのトークン保存 */
async function saveTokensForScan(scanId, userId, tokens) {
  if (!scanId) return;
  const accessToken = tokens.access_token || null;
  const refreshToken = tokens.refresh_token || null;
  const expiryDate = tokens.expiry_date || null;

  await pool.query(
    `INSERT INTO scan_google_tokens (scan_id, user_id, access_token, refresh_token, expiry_date)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       expiry_date = VALUES(expiry_date),
       updated_at = NOW()`,
    [scanId, userId, accessToken, refreshToken, expiryDate]
  );
}

/** URL（scan）ごとのトークン削除 */
async function deleteTokensForScan(scanId, userId) {
  if (!scanId) return;
  await pool.query("DELETE FROM scan_google_tokens WHERE scan_id = ? AND user_id = ?", [scanId, userId]);
}

/** scan_id 指定時はそのURLのトークン、未指定時はユーザー全体のトークンで認証クライアント取得 */
async function getAuthenticatedClient(userId, req, scanId = null) {
  const tokens = scanId
    ? await getTokensForScan(scanId, userId)
    : await getTokensForUser(userId);
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
      if (scanId) {
        await saveTokensForScan(scanId, userId, credentials);
      } else {
        await saveTokensForUser(userId, credentials);
      }
      client.setCredentials(credentials);
    } catch (e) {
      console.warn("[GSC OAuth] token refresh failed:", e.message);
    }
  }

  return client;
}

module.exports = {
  SCOPES,
  getOAuth2Client,
  getRedirectUri,
  getTokensForUser,
  saveTokensForUser,
  deleteTokensForUser,
  getTokensForScan,
  saveTokensForScan,
  deleteTokensForScan,
  getAuthenticatedClient,
};

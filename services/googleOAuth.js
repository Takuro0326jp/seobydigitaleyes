/**
 * Google OAuth2 クライアント（GSC 連携用）
 * URL（scan）ごと、ユーザーごと、会社全体で Google アカウントと連携可能
 * 優先順位: scan > user > company（会社全体）
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

/** 会社全体のトークン取得 */
async function getTokensForCompany(companyId) {
  if (!companyId) return null;
  const [rows] = await pool.query(
    "SELECT access_token, refresh_token, expiry_date, admin_user_id FROM company_google_tokens WHERE company_id = ? LIMIT 1",
    [companyId]
  );
  return rows.length ? rows[0] : null;
}

/** 会社全体のトークン保存（管理者が連携時 or トークンリフレッシュ時） */
async function saveTokensForCompany(companyId, adminUserId, tokens) {
  const accessToken = tokens.access_token || null;
  const refreshToken = tokens.refresh_token || null;
  const expiryDate = tokens.expiry_date || null;

  if (refreshToken) {
    // 新規連携 or refresh_tokenが更新された場合
    await pool.query(
      `INSERT INTO company_google_tokens (company_id, admin_user_id, access_token, refresh_token, expiry_date)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         admin_user_id = COALESCE(VALUES(admin_user_id), admin_user_id),
         access_token = VALUES(access_token),
         refresh_token = VALUES(refresh_token),
         expiry_date = VALUES(expiry_date),
         updated_at = NOW()`,
      [companyId, adminUserId || 0, accessToken, refreshToken, expiryDate]
    );
  } else {
    // アクセストークンのリフレッシュのみ
    await pool.query(
      `UPDATE company_google_tokens
       SET access_token = ?, expiry_date = ?, updated_at = NOW()
       WHERE company_id = ?`,
      [accessToken, expiryDate, companyId]
    );
  }
}

/** 会社全体のトークン削除 */
async function deleteTokensForCompany(companyId) {
  if (!companyId) return;
  await pool.query("DELETE FROM company_google_tokens WHERE company_id = ?", [companyId]);
}

/**
 * 認証済みクライアントを取得
 * 優先順位: scan固有 > ユーザー個人 > 会社全体
 *
 * @param {number} userId - ログインユーザーID
 * @param {object} req - Express request（リダイレクトURI生成用）
 * @param {string|null} scanId - scan固有トークンを使う場合のscan ID
 */
async function getAuthenticatedClient(userId, req, scanId = null) {
  let tokens = null;
  let tokenSource = null;
  let companyId = null;

  // 1. scan固有のトークンを試みる
  if (scanId) {
    tokens = await getTokensForScan(scanId, userId);
    if (tokens?.refresh_token) tokenSource = "scan";
  }

  // 2. ユーザー個人のトークンを試みる
  if (!tokens?.refresh_token) {
    tokens = await getTokensForUser(userId);
    if (tokens?.refresh_token) tokenSource = "user";
  }

  // 3. 会社全体のトークンを試みる
  if (!tokens?.refresh_token) {
    try {
      const [userRows] = await pool.query(
        "SELECT company_id FROM users WHERE id = ? LIMIT 1",
        [userId]
      );
      companyId = userRows[0]?.company_id || null;
      if (companyId) {
        tokens = await getTokensForCompany(companyId);
        if (tokens?.refresh_token) tokenSource = "company";
      }
    } catch (e) {
      console.warn("[GSC OAuth] company token lookup failed:", e.message);
    }
  }

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
      if (tokenSource === "scan") {
        await saveTokensForScan(scanId, userId, credentials);
      } else if (tokenSource === "user") {
        await saveTokensForUser(userId, credentials);
      } else if (tokenSource === "company" && companyId) {
        await saveTokensForCompany(companyId, null, credentials);
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
  getTokensForCompany,
  saveTokensForCompany,
  deleteTokensForCompany,
  getAuthenticatedClient,
};

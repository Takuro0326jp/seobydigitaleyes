const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const pool = require("../db");
const { getUserIdFromRequest } = require("../services/session");
const { sendPasswordResetEmail } = require("../services/email");
const {
  getOAuth2Client,
  getRedirectUri,
  SCOPES,
  saveTokensForUser,
  saveTokensForScan,
  saveTokensForCompany,
} = require("../services/googleOAuth");

const router = express.Router();
const vercelEnv = (process.env.VERCEL_ENV || "").toLowerCase();
const vercelRef = (process.env.VERCEL_GIT_COMMIT_REF || "").toLowerCase();
const isStagingEnv =
  vercelEnv === "preview" ||
  vercelRef === "staging" ||
  vercelRef.startsWith("staging/");
const stagingDisable2fa = isStagingEnv && process.env.STAGING_DISABLE_2FA !== "0";

const ses = new SESClient({
  region: process.env.AWS_REGION || "ap-northeast-1"
});

const htmlTemplate = (code, loginUrl) => `
<div style="background:#f8fafc;padding:40px 0;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.06);">
    <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#6366f1;">DIGITALEYES</div>
    <h2 style="margin-top:12px;font-size:22px;font-weight:900;color:#0f172a;">SEO Scan 認証コード</h2>
    <p style="margin-top:18px;font-size:14px;color:#64748b;line-height:1.6;">ログイン認証のため、以下のコードを入力してください。</p>
    <div style="margin-top:28px;font-size:34px;font-weight:900;letter-spacing:6px;background:#f1f5f9;padding:18px 24px;border-radius:12px;display:inline-block;color:#0f172a;">
      ${code}
    </div>
    ${loginUrl ? `
    <p style="margin-top:24px;">
      <a href="${loginUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(99,102,241,0.4);">ワンクリックでログイン</a>
    </p>
    <p style="margin-top:16px;font-size:12px;color:#94a3b8;">デフォルトブラウザ以外を使う場合: 以下のURLを選択してコピーし、お使いのブラウザに貼り付けてください</p>
    <p style="margin-top:8px;font-size:11px;font-family:monospace;color:#475569;background:#f8fafc;padding:12px 16px;border-radius:8px;border:1px solid #e2e8f0;word-break:break-all;text-align:left;">${String(loginUrl).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</p>
    ` : ""}
    <p style="margin-top:24px;font-size:13px;color:#94a3b8;">このコードの有効期限は10分です</p>
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:32px 0;">
    <p style="font-size:12px;color:#94a3b8;">SEO Scan by DIGITALEYES</p>
  </div>
</div>
`;

async function sendCodeEmail({ to, code, loginUrl }) {
  const sesFrom = process.env.SES_FROM;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  const html = htmlTemplate(code, loginUrl);

  // 1. SES が設定されていれば SES で送信
  if (sesFrom) {
    const command = new SendEmailCommand({
      Source: sesFrom,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: "SEO Scan 認証コード", Charset: "UTF-8" },
        Body: {
          Text: { Data: `SEO Scan 認証コード: ${code}${loginUrl ? `\nワンクリックでログイン: ${loginUrl}` : ""}`, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    });
    try {
      await ses.send(command);
      return;
    } catch (sesErr) {
      console.error("[SES] 送信失敗:", sesErr.message);
      console.log("[認証コード] サーバーコンソールから入力してください:", code);
      return;
    }
  }

  // 2. Gmail SMTP が設定されていれば nodemailer で送信
  if (emailUser && emailPass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass }
    });
    try {
      await transporter.sendMail({
        from: `"SEO Scan" <${emailUser}>`,
        to,
        subject: "SEO Scan 認証コード",
        text: `SEO Scan 認証コード: ${code}${loginUrl ? `\nワンクリックでログイン: ${loginUrl}` : ""}`,
        html
      });
      console.log("[メール] 送信完了:", to);
      return;
    } catch (mailErr) {
      console.error("[メール] 送信失敗:", mailErr.message);
      console.log("[認証コード] サーバーコンソールから入力してください:", code);
      return;
    }
  }

  // 3. どちらも未設定ならコンソール表示のみ
  console.log("[DEV] Auth code:", code);
}

function normalizeCode(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    );
}

// ① send-code
router.post("/send-code", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, error: "email/password が必要です" });
  }

  try {
    // usersから取得
    const [rows] = await pool.query(
      "SELECT id, email, password, role FROM users WHERE email = ?",
      [email]
    );

    if (!rows.length) {
      return res
        .status(401)
        .json({ success: false, error: "ユーザーが存在しません" });
    }

    const user = rows[0];

    // bcryptで照合
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, error: "パスワード違い" });
    }

    // staging では二段階認証をスキップして即ログイン
    if (stagingDisable2fa) {
      const token = crypto.randomBytes(32).toString("hex");
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      await pool.query(
        "INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)",
        [token, user.id, expires]
      );
      await pool.query(
        "UPDATE users SET first_access_at = COALESCE(first_access_at, NOW()), last_access_at = NOW() WHERE id = ?",
        [user.id]
      );
      res.cookie("session_id", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      return res.json({ success: true, skip2fa: true });
    }

    // 6桁コード生成（デモアカウントは固定）
    const code =
      email === "demo@seoscan.jp"
        ? "123456"
        : Math.floor(100000 + Math.random() * 900000).toString();
    const oneTimeToken = crypto.randomBytes(32).toString("hex");
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const loginUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(oneTimeToken)}`;

    // auth_codesに保存（10分）+ ワンクリック用トークン
    await pool.query(
      `
      INSERT INTO auth_codes (email, code, expires_at, one_time_token)
      VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?)
      ON DUPLICATE KEY UPDATE
        code = VALUES(code),
        expires_at = VALUES(expires_at),
        one_time_token = VALUES(one_time_token)
    `,
      [email, code, oneTimeToken]
    );

    console.log("[auth] 認証コード:", code);

    // メール送信（失敗してもコードはDBに保存済み・コンソール表示される）
    try {
      await sendCodeEmail({ to: email, code, loginUrl });
    } catch (mailErr) {
      console.error("[send-code] メール送信エラー（コードは発行済み）:", mailErr?.message || mailErr);
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("SEND CODE ERROR:", e?.message || e);
    let msg =
      e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT"
        ? "DB接続エラー。.env の DB_HOST/DB_USER/DB_PASSWORD を確認してください"
        : e.code === "ECONNRESET"
          ? "接続が切断されました。ネットワーク・DBの状態を確認するか、少し待ってから再試行してください"
          : e.name === "InvalidParameterValue" || e.code === "InvalidParameterValue"
            ? "SES送信エラー。SES_FROM を未設定にするか、AWS認証情報を確認してください"
            : "認証処理でエラーが発生しました";
    if (process.env.NODE_ENV !== "production" && e.message) {
      msg += ` (${e.message})`;
    }
    return res.status(500).json({ success: false, error: msg });
  }
});

// ② verify-code
// ②' ワンクリック認証（メール内リンクから）
router.get("/verify", async (req, res) => {
  const token = (req.query.token || "").trim();
  if (!token) {
    return res.redirect("/?error=invalid_token");
  }
  try {
    const [rows] = await pool.query(
      "SELECT email FROM auth_codes WHERE one_time_token = ? AND expires_at > NOW() LIMIT 1",
      [token]
    );
    if (!rows.length) {
      return res.redirect("/?error=code_expired");
    }
    const email = rows[0].email;
    const [users] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    if (!users.length) {
      return res.redirect("/?error=invalid_token");
    }
    const userId = users[0].id;
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    await pool.query(
      "INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)",
      [sessionToken, userId, expires]
    );
    await pool.query(
      "UPDATE users SET first_access_at = COALESCE(first_access_at, NOW()), last_access_at = NOW() WHERE id = ?",
      [userId]
    );
    await pool.query("DELETE FROM auth_codes WHERE email = ?", [email]);
    res.cookie("session_id", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.redirect("/seo.html");
  } catch (e) {
    console.error("[auth] verify token error:", e?.message || e);
    return res.redirect("/?error=invalid_token");
  }
});

router.post("/verify-code", async (req, res) => {
  const { email, code } = req.body || {};

  if (!email || !code) {
    return res
      .status(400)
      .json({ success: false, error: "email/code が必要です" });
  }

  try {
    const normalizedCode = normalizeCode(code);

    // auth_codesチェック
    const [rows] = await pool.query(
      "SELECT code FROM auth_codes WHERE email = ? AND expires_at > NOW()",
      [email]
    );

    // デモアカウントは固定コード 123456 で常にログイン可能
    const isDemoBypass = email === "demo@seoscan.jp" && normalizedCode === "123456";

    if (!isDemoBypass) {
      if (!rows.length) {
        return res
          .status(401)
          .json({ success: false, error: "コード期限切れ" });
      }

      const savedCode = normalizeCode(rows[0].code);
      if (normalizedCode !== savedCode) {
        return res
          .status(401)
          .json({ success: false, error: "コード違い" });
      }
    }

    // usersからuser_id取得
    const [users] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (!users.length) {
      return res
        .status(401)
        .json({ success: false, error: "ユーザーなし" });
    }

    const userId = users[0].id;

    // sessionsにtoken発行
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

await pool.query(
    "INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)",
    [token, userId, expires]
  );
  await pool.query(
    "UPDATE users SET first_access_at = COALESCE(first_access_at, NOW()), last_access_at = NOW() WHERE id = ?",
    [userId]
  );

  // auth_codes削除（任意）
  await pool.query("DELETE FROM auth_codes WHERE email = ?", [email]);

    // cookie保存
    res.cookie("session_id", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("VERIFY ERROR:", e);
    return res
      .status(500)
      .json({ success: false, error: "verify error" });
  }
});

// POST /api/auth/forgot-password - パスワード再設定メール送信
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  const rawEmail = (email || "").trim().toLowerCase();
  if (!rawEmail) {
    return res.status(400).json({ success: false, error: "メールアドレスを入力してください" });
  }
  try {
    const [rows] = await pool.query(
      "SELECT id, email FROM users WHERE email = ? LIMIT 1",
      [rawEmail]
    );
    // セキュリティのため、存在・非存在に関わらず同じレスポンスを返す
    if (rows.length > 0) {
      const user = rows[0];
      const resetToken = crypto.randomBytes(32).toString("hex");
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const setPasswordUrl = `${baseUrl}/auth/set-password.html?token=${encodeURIComponent(resetToken)}`;

      await pool.query(
        `UPDATE users SET password_reset_token = ?, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)
         WHERE id = ?`,
        [resetToken, user.id]
      );

      try {
        await sendPasswordResetEmail({ to: user.email, setPasswordUrl });
      } catch (mailErr) {
        console.error("[auth] forgot-password メール送信エラー:", mailErr?.message);
      }
    }
    return res.json({ success: true, message: "ご登録のメールアドレス宛にパスワード再設定のリンクを送信しました。" });
  } catch (e) {
    console.error("[auth] forgot-password:", e);
    return res.status(500).json({ success: false, error: "処理に失敗しました。しばらく経ってからお試しください。" });
  }
});

// POST /api/auth/set-password - 招待ユーザー or パスワード再設定
router.post("/set-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: "トークンとパスワード（6文字以上）が必要です" });
  }
  try {
    // 1. 招待トークンで検索
    let [rows] = await pool.query(
      `SELECT id, email FROM users WHERE invitation_token = ? AND invitation_expires_at > NOW() LIMIT 1`,
      [token]
    );
    let clearInvite = true;
    let clearReset = false;

    if (!rows.length) {
      // 2. パスワード再設定トークンで検索
      [rows] = await pool.query(
        `SELECT id, email FROM users WHERE password_reset_token = ? AND password_reset_expires_at > NOW() LIMIT 1`,
        [token]
      );
      if (!rows.length) {
        return res.status(401).json({
          error: "リンクの有効期限が切れているか、無効です。パスワードを忘れた場合は再度メール送信をお試しください。"
        });
      }
      clearInvite = false;
      clearReset = true;
    }

    const user = rows[0];
    const hash = await bcrypt.hash(password, 10);

    const updates = ["password = ?"];
    const params = [hash, user.id];
    if (clearInvite) {
      updates.push("invitation_token = NULL", "invitation_expires_at = NULL");
    }
    if (clearReset) {
      updates.push("password_reset_token = NULL", "password_reset_expires_at = NULL");
    }

    await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    await pool.query(
      "INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)",
      [sessionToken, user.id, expires]
    );
    await pool.query(
      "UPDATE users SET first_access_at = COALESCE(first_access_at, NOW()), last_access_at = NOW() WHERE id = ?",
      [user.id]
    );
    res.cookie("session_id", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ success: true });
  } catch (e) {
    console.error("[auth] set-password:", e);
    return res.status(500).json({ error: "パスワード設定に失敗しました" });
  }
});

// ③ me
router.get("/me", async (req, res) => {
  const token = req.cookies?.session_id;

  if (!token) {
    return res.json(null);
  }

  try {
    // session取得
    const [sessions] = await pool.query(
      `
      SELECT user_id
      FROM sessions
      WHERE session_token = ?
      AND expires_at > NOW()
      LIMIT 1
    `,
      [token]
    );

    if (!sessions.length) {
      return res.json(null);
    }

    const userId = sessions[0].user_id;

    // アクセス日を更新（既存セッションでのアクセス時も反映）
    await pool.query(
      "UPDATE users SET first_access_at = COALESCE(first_access_at, NOW()), last_access_at = NOW() WHERE id = ?",
      [userId]
    );

    // user情報返却
    const [users] = await pool.query(
      `
      SELECT id, email, username, role
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
      [userId]
    );

    if (!users.length) {
      return res.json(null);
    }

    const u = users[0];
    return res.json({
      id: u.id,
      email: u.email,
      username: u.username,
      display_name: u.username || u.email,
      role: u.role,
    });
  } catch (e) {
    console.error("ME ERROR:", e);
    return res
      .status(500)
      .json({ success: false, error: "user load error" });
  }
});

// ⑤ Google OAuth（GSC 連携開始）
// link_for=scanId で URL ごとの連携（そのURL専用のGoogleアカウント）
router.get("/google", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.redirect("/?error=login_required");
  }

  const client = getOAuth2Client(getRedirectUri(req));
  if (!client) {
    return res.status(503).json({
      error: "Google OAuth が設定されていません。.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください。",
    });
  }

  const linkFor = (req.query.link_for || "").trim().slice(0, 36);
  const randomPart = crypto.randomBytes(24).toString("hex");
  const state = linkFor ? `${linkFor}:${randomPart}` : randomPart;

  await pool.query(
    "INSERT INTO oauth_states (state, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
    [state, userId]
  );

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });

  res.redirect(url);
});

// ⑥ Google OAuth コールバック
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.warn("[Google OAuth] error:", error);
    return res.redirect("/seo.html?gsc_error=" + encodeURIComponent(error));
  }

  if (!code || !state) {
    return res.redirect("/seo.html?gsc_error=missing_params");
  }

  const [rows] = await pool.query(
    "SELECT user_id FROM oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1",
    [state]
  );
  await pool.query("DELETE FROM oauth_states WHERE state = ?", [state]);

  if (!rows.length) {
    return res.redirect("/seo.html?gsc_error=invalid_state");
  }

  const userId = rows[0].user_id;
  const linkForValue = state.includes(":") ? state.split(":")[0] : null;
  const isCompanyLink = linkForValue === "company";
  const scanId = (!isCompanyLink && linkForValue) ? linkForValue : null;
  const client = getOAuth2Client(getRedirectUri(req));
  if (!client) {
    return res.redirect("/seo.html?gsc_error=config");
  }

  try {
    const { tokens } = await client.getToken(code);

    // 会社全体連携（管理者・マスターのみ）
    if (isCompanyLink) {
      const [userRows] = await pool.query("SELECT id, company_id, role FROM users WHERE id = ?", [userId]);
      const user = userRows[0];
      if (!user || (user.role !== "admin" && user.role !== "master")) {
        return res.redirect("/seo.html?gsc_error=permission_denied");
      }
      if (!user.company_id) {
        return res.redirect("/seo.html?gsc_error=no_company");
      }
      await saveTokensForCompany(user.company_id, userId, tokens);
      return res.redirect("/seo.html?gsc=company_linked");
    }

    // scan固有連携
    if (scanId) {
      const { canAccessScan } = require("../services/accessControl");
      const [userRows] = await pool.query("SELECT id, company_id, role FROM users WHERE id = ?", [userId]);
      const user = userRows[0];
      if (!user || !(await canAccessScan(userId, user.company_id, user.role, scanId))) {
        return res.redirect("/seo.html?gsc_error=access_denied");
      }
      await saveTokensForScan(scanId, userId, tokens);
      return res.redirect("/seo.html?gsc=linked&scan=" + encodeURIComponent(scanId));
    }

    // ユーザー個人連携（後方互換）
    await saveTokensForUser(userId, tokens);
    return res.redirect("/seo.html?gsc=linked");
  } catch (e) {
    console.error("[Google OAuth] token exchange error:", e.message);
    return res.redirect("/seo.html?gsc_error=" + encodeURIComponent(e.message || "token_exchange_failed"));
  }
});

// ④ update-profile（表示名・username 更新）
router.post("/update-profile", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const displayName = (req.body?.display_name ?? req.body?.username ?? "").trim();

  try {
    await pool.query(
      "UPDATE users SET username = ? WHERE id = ?",
      [displayName || null, userId]
    );
    return res.json({ success: true });
  } catch (e) {
    console.error("UPDATE PROFILE ERROR:", e);
    return res.status(500).json({ error: "プロフィールの更新に失敗しました" });
  }
});

// ⑤ logout
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.session_id;

    if (token) {
      // sessions削除
      await pool.query(
        "DELETE FROM sessions WHERE session_token = ?",
        [token]
      );
    }

    // cookie削除
    res.clearCookie("session_id", { path: "/" });

    return res.json({ success: true });
  } catch (e) {
    console.error("LOGOUT ERROR:", e);
    return res
      .status(500)
      .json({ success: false, error: "logout error" });
  }
});

module.exports = router;


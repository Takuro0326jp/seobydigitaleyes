/**
 * メール送信（招待・その他）
 */
const nodemailer = require("nodemailer");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient({
  region: process.env.AWS_REGION || "ap-northeast-1"
});

function inviteEmailHtml(setPasswordUrl, username) {
  return `
<div style="background:#f8fafc;padding:40px 0;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.06);">
    <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#6366f1;">DIGITALEYES</div>
    <h2 style="margin-top:12px;font-size:22px;font-weight:900;color:#0f172a;">SEO Scan へようこそ</h2>
    <p style="margin-top:18px;font-size:14px;color:#64748b;line-height:1.6;">${username ? `${username} 様、` : ""}管理者によりアカウントが作成されました。以下のボタンからパスワードを設定してログインしてください。</p>
    <p style="margin-top:24px;">
      <a href="${setPasswordUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none;box-shadow:0 4px 14px rgba(99,102,241,0.4);">パスワードを設定する</a>
    </p>
    <p style="margin-top:24px;font-size:13px;color:#94a3b8;">このリンクの有効期限は7日間です</p>
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:32px 0;">
    <p style="font-size:12px;color:#94a3b8;">SEO Scan by DIGITALEYES</p>
  </div>
</div>
`;
}

async function sendInviteEmail({ to, setPasswordUrl, username }) {
  const sesFrom = process.env.SES_FROM;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  const html = inviteEmailHtml(setPasswordUrl, username);

  if (sesFrom) {
    const command = new SendEmailCommand({
      Source: sesFrom,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: "SEO Scan アカウント招待", Charset: "UTF-8" },
        Body: {
          Text: { Data: `SEO Scan へようこそ。パスワードを設定してください: ${setPasswordUrl}`, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    });
    try {
      await ses.send(command);
      return true;
    } catch (e) {
      console.error("[SES] 招待メール送信失敗:", e.message);
      return false;
    }
  }
  if (emailUser && emailPass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass }
    });
    try {
      await transporter.sendMail({
        from: `"SEO Scan" <${emailUser}>`,
        to,
        subject: "SEO Scan アカウント招待",
        text: `SEO Scan へようこそ。パスワードを設定してください: ${setPasswordUrl}`,
        html
      });
      return true;
    } catch (e) {
      console.error("[メール] 招待送信失敗:", e.message);
      return false;
    }
  }
  console.log("[DEV] 招待URL:", setPasswordUrl);
  return true;
}

module.exports = { sendInviteEmail };

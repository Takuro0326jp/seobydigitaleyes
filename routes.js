const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator'); // 追加
const pool = require('./db');
const transporter = require('./mailer');

// bcryptを使った非同期のパスワード照合
const verifyPassword = async (inputPass, dbPass) => {
    return await bcrypt.compare(inputPass, dbPass);
};



// 1. コード送信 (ログインステップA)
// ★ここに [validation] を入れるのが正しい書き方です
router.post('/send-code', [
    body('email').isEmail().withMessage('正しいメールアドレスを入力してください'),
    body('password').isLength({ min: 1 }).withMessage('パスワードを入力してください')
], async (req, res) => {
    
    // 検証エラーがあれば即座に終了
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    
    console.log("受信email:", email);
    console.log("受信password:", password);

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        console.log("DB検索結果:", users);
        console.log("DB password:", users[0]?.password);


        // 認証チェック
        if (users.length === 0 || !(await verifyPassword(password, users[0].password))) {
            return res.status(401).json({ error: '認証情報が正しくありません' });
        }

        // 6桁のコード生成
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // DBに一時保存
        await pool.query('UPDATE users SET verification_code = ? WHERE email = ?', [code, email]);
        
        // メール送信
        await transporter.sendMail({
    from: '"SEO Scan" <' + process.env.EMAIL_USER + '>',
    to: email,
    subject: '【SEO Scan】ログイン認証コード',
    text: `あなたの認証コードは ${code} です。`,
    html: `
    <div style="background:#0f172a;padding:40px 0;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#111827;border-radius:12px;padding:40px;color:#e5e7eb;">
        
        <div style="text-align:center;margin-bottom:30px;">
          <h1 style="margin:0;font-size:22px;color:#ffffff;letter-spacing:1px;">
            SEO Scan
          </h1>
          <p style="margin:6px 0 0;font-size:13px;color:#9ca3af;">
            Secure Login Verification
          </p>
        </div>

        <p style="font-size:14px;color:#cbd5e1;">
          ログインを行うための認証コードをお送りします。
        </p>

        <div style="
            margin:30px 0;
            text-align:center;
            padding:20px;
            background:linear-gradient(135deg,#00E5FF,#3B82F6);
            border-radius:10px;
            font-size:32px;
            font-weight:bold;
            letter-spacing:6px;
            color:#0f172a;">
          ${code}
        </div>

        <p style="font-size:13px;color:#94a3b8;">
          このコードの有効期限は10分です。
        </p>

        <hr style="border:none;border-top:1px solid #1f2937;margin:30px 0;" />

        <p style="font-size:12px;color:#6b7280;line-height:1.6;">
          このメールに心当たりがない場合は、何もせず破棄してください。<br>
          本メールは自動送信です。
        </p>

        <div style="text-align:center;margin-top:20px;font-size:11px;color:#475569;">
          © 2026 DIGITALEYES Inc.
        </div>
      </div>
    </div>
    `
});

        res.status(200).json({ message: 'コードを送信しました' });
    } catch (err) {
        console.error("Send Code Error:", err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

// 2. コード検証 (ログインステップB)
router.post('/verify-code', async (req, res) => {
    const { email, code } = req.body;

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND verification_code = ?', [email, code]);
        
        if (users.length === 0) {
            return res.status(401).json({ error: 'コードが正しくありません' });
        }

        const user = users[0];
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await pool.query('INSERT INTO sessions (session_token, user_id, expires_at) VALUES (?, ?, ?)', 
            [sessionToken, user.id, expiresAt]);

        res.cookie('session_id', sessionToken, {
            httpOnly: true,
            secure: false, // 開発環境用
            sameSite: 'strict',
            expires: expiresAt
        });

        res.status(200).json({ 
            message: 'ログイン成功',
            user: { id: user.id, email: user.email }
        });
    } catch (err) {
        console.error("Verify Code Error:", err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

module.exports = router;
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const pool = require('./db');
const authRoutes = require('./routes');

const app = express();


// server.js の冒頭、requireより下、appの定義のすぐ下
app.use((req, res, next) => {
    console.log(`★ 受信したURL: ${req.method} ${req.url}`);
    console.log(`★ ヘッダー情報:`, req.headers);
    next();
});


// ★Helmetの設定を緩和（TailwindのCDNとインラインスタイルを許可）
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "cdn.tailwindcss.com"],
        "style-src": ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "cdn.tailwindcss.com"],
        "font-src": ["'self'", "https:", "data:"],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
  })
);

// ミドルウェア
app.use(express.json());
app.use(cookieParser());

// ★静的ファイル配信を1箇所にまとめる（これでpublicの中身が正しく配信されます）
app.use(express.static(path.join(__dirname, 'public')));

// レート制限
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: '試行回数が多すぎます。15分待ってください。'
});
// app.use('/api/auth/send-code', loginLimiter);


// 認証チェック
const requireAuth = async (req, res, next) => {
    const sessionToken = req.cookies.session_id;
    if (!sessionToken) return res.redirect('/index.html');
    try {
        const [rows] = await pool.query('SELECT * FROM sessions WHERE session_token = ? AND expires_at > NOW()', [sessionToken]);
        rows.length > 0 ? next() : res.redirect('/index.html');
    } catch (err) { res.redirect('/index.html'); }
};

// ルート
app.use('/api/auth', authRoutes);
app.get('/seo.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'seo.html'));
});

// サーバー起動
app.listen(3000, () => console.log('Server is running on port 3000'));

cron.schedule('0 0 * * *', async () => {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
});
// mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail', // Gmailを使う場合
    auth: {
        user: process.env.EMAIL_USER, // あなたのGmailアドレス
        pass: process.env.EMAIL_PASS  // アプリパスワード
    }
});

module.exports = transporter;
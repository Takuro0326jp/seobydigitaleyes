// reset-pass.js
const bcrypt = require('bcrypt');
const pool = require('./db');

async function resetPassword() {
    const email = 't.miura@o-eighty.com';
    const newPassword = 'miura-pass-2026';
    
    // パスワードをハッシュ化
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // DBを更新
    await pool.query('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
    
    console.log("★ パスワードを更新しました！");
    console.log("★ 新しいハッシュ値:", hashedPassword);
    process.exit();
}

resetPassword();
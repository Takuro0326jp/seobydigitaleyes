document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('scan-form');
    const urlInput = document.getElementById('target-url');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const submitBtn = document.getElementById('submit-btn');
    const submitBtnText = document.getElementById('submit-btn-text');
    
    // 2FA用
    const twoFactorArea = document.getElementById('2fa-area');
    const codeInput = document.getElementById('2fa-code');

    let isCodeSent = false; 

    // 注意：localStorageによるクライアント側の事前判定は削除しました。
    // ログイン状態の確認は、seo.htmlを表示する際にサーバー側で行ってください。

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        const url = urlInput ? urlInput.value.trim() : "";

        // URLがない場合や、ステップ01が見えていない（＝認証中）の場合の条件分岐を維持
        const isStep01Hidden = document.getElementById('step-01-container')?.classList.contains('hidden');

        if (!url || isStep01Hidden) {
            
            // --- ステップA: パスワード確認 & コード送信 ---
            if (!isCodeSent) {
                submitBtn.disabled = true;
                submitBtnText.innerText = "認証中...";

                try {
                    const response = await fetch('/api/auth/send-code', { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || '認証に失敗しました');
                    }

                    isCodeSent = true;
                    if (twoFactorArea) twoFactorArea.classList.remove('hidden');

                    const passContainer = document.getElementById('password-container');
                    if (passContainer) {
                        passContainer.classList.add('hidden');
                    } else if (passwordInput) {
                        passwordInput.parentElement.classList.add('hidden');
                    }

                    emailInput.readOnly = true;
                    submitBtn.disabled = false;
                    submitBtnText.innerText = "認証してログイン →";

                } catch (err) {
                    alert(err.message);
                    submitBtn.disabled = false;
                    submitBtnText.innerText = "サインイン";
                }
                return;
            }

            // --- ステップB: コード検証 ---
            const code = codeInput.value.trim();
            try {
                const response = await fetch('/api/auth/verify-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code })
                });

                if (!response.ok) throw new Error('コードが正しくありません');
                
                // 成功時: サーバーから Set-Cookie が送信されるため、
                // ブラウザが自動的にセッションを管理します。
                // ここでの localStorage 操作は不要です。
                window.location.href = 'seo.html';

            } catch (err) {
                alert(err.message);
            }
            return;
        }
    });
});
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error === "code_expired") alert("認証コードの有効期限が切れています。再度ログインを試してください。");
  else if (error === "invalid_token") alert("認証リンクが無効です。再度ログインを試してください。");

  const form = document.getElementById("scan-form");
  const emailInput = document.getElementById("email-input");
  const passwordInput = document.getElementById("password-input");
  const submitBtn = document.getElementById("submit-btn");
  const submitBtnText = document.getElementById("submit-btn-text");

  const twoFactorArea = document.getElementById("2fa-area");
  const codeInput = document.getElementById("2fa-code");

  let isCodeSent = false;

  if (!form) return;

  const resetModal = document.getElementById("reset-modal");
  document.getElementById("open-reset-modal")?.addEventListener("click", () => {
    resetModal?.classList.remove("hidden");
    document.getElementById("reset-email")?.focus();
  });
  document.getElementById("close-modal")?.addEventListener("click", () => {
    resetModal?.classList.add("hidden");
  });
  resetModal?.addEventListener("click", (e) => {
    if (e.target === resetModal) resetModal.classList.add("hidden");
  });
  document.getElementById("reset-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("reset-email");
    const submitBtn = resetModal?.querySelector('button[type="submit"]');
    const email = (emailInput?.value || "").trim().toLowerCase();
    if (!email) return;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "送信中...";
    }
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "送信に失敗しました");
      alert(data.message || "ご登録のメールアドレス宛にパスワード再設定のリンクを送信しました。");
      resetModal?.classList.add("hidden");
      if (emailInput) emailInput.value = "";
    } catch (err) {
      alert(err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "再設定依頼を送信する";
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!isCodeSent) {
      submitBtn.disabled = true;
      submitBtnText.innerText = "認証中...";

      try {
        const response = await fetch("/api/auth/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password })
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const error = payload || {};
          throw new Error(error.error || "認証に失敗しました");
        }

        if (payload?.skip2fa) {
          window.location.href = "/seo.html";
          return;
        }

        isCodeSent = true;
        twoFactorArea?.classList.remove("hidden");

        const passContainer = document.getElementById("password-container");
        if (passContainer) {
          passContainer.classList.add("hidden");
        } else if (passwordInput) {
          passwordInput.parentElement?.classList.add("hidden");
        }

        emailInput.readOnly = true;
        submitBtn.disabled = false;
        submitBtnText.innerText = "認証してログイン →";
      } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
        submitBtnText.innerText = "Authenticate →";
      }
      return;
    }

    const normalizeDigits = (value) =>
      (value || "")
        .replace(/\s+/g, "")
        .replace(/[０-９]/g, (ch) =>
          String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
        );

    const code = normalizeDigits(codeInput.value).trim();

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, code })
      });

      if (!response.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch (_) {}
        throw new Error(payload?.error || "コードが正しくありません");
      }

      window.location.href = "/seo.html";
    } catch (err) {
      alert(err.message);
    }
  });
});

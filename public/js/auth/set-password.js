document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const form = document.getElementById("set-password-form");
  const errorEl = document.getElementById("error-msg");
  const submitBtn = document.getElementById("submit-btn");

  if (!token) {
    errorEl.textContent = "無効なリンクです。招待メールのリンクから再度アクセスしてください。";
    errorEl.classList.remove("hidden");
    form.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = form.password.value;
    const passwordConfirm = form.passwordConfirm.value;
    if (password !== passwordConfirm) {
      errorEl.textContent = "パスワードが一致しません。";
      errorEl.classList.remove("hidden");
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = "パスワードは6文字以上で入力してください。";
      errorEl.classList.remove("hidden");
      return;
    }
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "設定中...";
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "エラーが発生しました");
      window.location.href = "/seo.html";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "パスワードを設定してログイン";
    }
  });
});

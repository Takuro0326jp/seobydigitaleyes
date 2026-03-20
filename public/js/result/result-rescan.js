document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("rescanBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("再診断を開始します。よろしいですか？")) return;
    const url = SEOState.scanInfo?.target_url;
    if (!url) {
      alert("URLが取得できません");
      return;
    }
    btn.textContent = "再診断中...";
    btn.disabled = true;
    try {
      const res = await fetch("/api/scan-start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "再診断の開始に失敗しました");
        btn.textContent = "再診断を開始する";
        btn.disabled = false;
        return;
      }
      window.location.href = `/seo.html?scan=${encodeURIComponent(data.scanId)}`;
    } catch (e) {
      console.error(e);
      alert("通信エラー");
      btn.textContent = "再診断を開始する";
      btn.disabled = false;
    }
  });
});

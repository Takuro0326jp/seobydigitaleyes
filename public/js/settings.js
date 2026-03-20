/**
 * settings.js - アカウント設定画面
 * /api/auth/me でユーザー取得、/api/auth/update-profile で保存
 */
(function () {
  "use strict";

  async function loadUser() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        window.location.replace("/index.html");
        return;
      }
      const user = await res.json();
      const name = user.display_name || user.username || user.email;

      const displayInput = document.getElementById("display-name");
      if (displayInput) displayInput.value = name || "";

      const emailEl = document.getElementById("user-email");
      if (emailEl) emailEl.textContent = user.email || "";

      const roleEl = document.getElementById("user-role");
      if (roleEl) roleEl.textContent = (user.role || "user").toUpperCase();
    } catch (e) {
      console.error(e);
      window.location.replace("/index.html");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadUser();
  });

  // アイコン画像が選択された時の処理（XSS対策: SVG拒否 + createObjectURL で表示）
  document.addEventListener("DOMContentLoaded", () => {
    const avatarInput = document.getElementById("avatar-input");
    if (avatarInput) {
      avatarInput.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) return;
        // SVG は script 埋め込みの XSS リスクがあるため拒否
        const type = (file.type || "").toLowerCase();
        if (type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
          alert("SVG 形式はセキュリティ上の理由で使用できません。PNG または JPEG を選択してください。");
          return;
        }
        // createObjectURL で blob URL を生成（innerHTML に base64 を埋め込まない）
        const blobUrl = URL.createObjectURL(file);
        const preview = document.getElementById("avatar-preview");
        if (preview) {
          if (window.tempAvatarBlobUrl) URL.revokeObjectURL(window.tempAvatarBlobUrl);
          preview.innerHTML = "";
          const img = document.createElement("img");
          img.src = blobUrl;
          img.className = "avatar-img";
          img.alt = "Avatar preview";
          preview.appendChild(img);
          window.tempAvatarBlobUrl = blobUrl;
        }
      };
    }

    const saveBtn = document.getElementById("save-settings");
    if (saveBtn) {
      saveBtn.onclick = async function () {
        const newName = (document.getElementById("display-name")?.value || "").trim();
        try {
          const res = await fetch("/api/auth/update-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ display_name: newName }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || "保存に失敗しました");
            return;
          }
          this.innerText = "保存しました！";
          this.classList.replace("bg-slate-900", "bg-green-600");
          window.dispatchEvent(new CustomEvent("seo:profile-updated", { detail: { name: newName } }));
          setTimeout(() => {
            this.innerText = "設定を保存する";
            this.classList.replace("bg-green-600", "bg-slate-900");
          }, 800);
        } catch (err) {
          console.error(err);
          alert("保存に失敗しました");
        }
      };
    }
  });
})();

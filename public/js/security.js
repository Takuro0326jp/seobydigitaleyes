/**
 * security.js - セキュリティ診断画面
 * /api/scans/result/:id からスキャンデータを取得し、ヘッダー・URL一覧を更新
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function updateHeader(scan) {
    const rootUrl = scan?.target_url || "";
    const domainEl = document.getElementById("displayDomain");
    const urlEl = document.getElementById("displayUrl");
    if (domainEl && rootUrl) {
      try {
        domainEl.textContent = new URL(rootUrl).hostname;
      } catch {
        domainEl.textContent = rootUrl;
      }
    }
    if (urlEl) urlEl.textContent = rootUrl || "---";
  }

  function updateAnalysisDate(scan) {
    const el = document.getElementById("analysisDate");
    if (!el) return;
    const date = scan?.updated_at || scan?.created_at || new Date().toISOString();
    const d = typeof date === "string" ? date.split("T")[0] : new Date().toISOString().split("T")[0];
    el.textContent = `最終診断: ${d}`;
  }

  function updateUrlList(pages) {
    const container = document.getElementById("js-url-list");
    if (!container || !pages || pages.length === 0) return;

    container.innerHTML = pages
      .slice(0, 8)
      .map((p) => {
        const score = p.score ?? 0;
        const statusClass =
          score >= 80 ? "bg-emerald-50 text-emerald-700" : score >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
        const riskClass =
          score >= 80 ? "bg-emerald-50 text-emerald-700" : score >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
        const note =
          score >= 80
            ? "HTTPS / 基本ヘッダは概ね良好。"
            : score >= 60
              ? "一部のセキュリティヘッダ・Cookie属性の見直し余地あり。"
              : "優先度の高い対策（X-Frame-Options、Cookie属性など）の確認を推奨。";
        return `
          <div class="p-4 rounded-xl border border-slate-100 bg-slate-50/30">
            <p class="font-mono text-xs text-blue-600 break-all">${escapeHtml(p.url || "")}</p>
            <div class="flex flex-wrap gap-2 mt-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">Score ${score}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${riskClass}">${score >= 80 ? "Low" : score >= 60 ? "Medium" : "High"}</span>
            </div>
            <p class="text-xs text-slate-500 mt-2 leading-relaxed">${escapeHtml(note)}</p>
          </div>
        `;
      })
      .join("");
  }

  function showError(message) {
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p class="text-slate-600 font-bold mb-6">${escapeHtml(message)}</p>
          <a href="/seo.html" class="inline-block px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">一覧に戻る</a>
        </div>
      `;
    } else {
      alert(message + "\n一覧に戻ります。");
      window.location.replace("/seo.html");
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    void loadScanData();
  });

  async function loadScanData() {
    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        window.location.replace("/");
        return;
      }
      if (res.status === 404) {
        showError("スキャンが見つかりません。一覧から再度お試しください。");
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showError(errData.error || `エラーが発生しました (${res.status})`);
        return;
      }

      const data = await res.json();
      const scan = data.scan || {};
      const pages = data.pages || [];

      updateHeader(scan);
      updateAnalysisDate(scan);
      updateUrlList(pages);
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    }
  }
})();

/**
 * domain.js - Domain Authority 解析ロジック
 * /api/scans/result/:id からスキャンデータを取得し、ドメイン権威性・健全性を表示
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  const keywords = {
    company: ["会社概要", "about", "company", "運営者"],
    privacy: ["プライバシー", "privacy", "個人情報"],
  };

  function checkFound(pages, kList) {
    return pages.some((p) =>
      kList.some((k) =>
        ((p.url || "") + (p.title || "")).toLowerCase().includes(k)
      )
    );
  }

  function updateProtocolSection(pages) {
    const hasHttp = pages.some((p) => (p.url || "").startsWith("http://"));
    const httpsEl = document.getElementById("httpsStatus");
    if (httpsEl) {
      httpsEl.textContent = hasHttp ? "INCOMPLETE" : "COMPLETE";
      httpsEl.className = hasHttp ? "text-orange-500" : "text-emerald-500";
    }

    let hostnames = [];
    try {
      hostnames = pages.map((p) => new URL(p.url).hostname);
    } catch (e) {}
    const isHostUnified = hostnames.length > 0 && new Set(hostnames).size === 1;
    const wwwEl = document.getElementById("wwwStatus");
    if (wwwEl) {
      wwwEl.textContent = isHostUnified ? "COMPLETE" : "ISSUES";
      wwwEl.className = isHostUnified ? "text-emerald-500" : "text-orange-500";
    }
  }

  function updateEATSection(pages) {
    const isCompanyFound = checkFound(pages, keywords.company);
    const companyEl = document.getElementById("statusCompany");
    if (companyEl) {
      companyEl.textContent = isCompanyFound ? "FOUND" : "MISSING";
      companyEl.className = isCompanyFound ? "text-emerald-500" : "text-slate-300";
    }

    const isPrivacyFound = checkFound(pages, keywords.privacy);
    const privacyEl = document.getElementById("statusPrivacy");
    if (privacyEl) {
      privacyEl.textContent = isPrivacyFound ? "FOUND" : "MISSING";
      privacyEl.className = isPrivacyFound ? "text-emerald-500" : "text-slate-300";
    }

    const schemaEl = document.getElementById("statusSchema");
    if (schemaEl) {
      schemaEl.textContent = "N/A";
      schemaEl.className = "text-slate-300";
    }
  }

  function updateStructureSection(pages) {
    const n = pages.length;
    const totalInternal = pages.reduce((sum, p) => sum + (p.internal_links || 0), 0);
    const avgLinks = n ? Math.round(totalInternal / n) : 0;
    const isolated = pages.filter((p) => (p.internal_links || 0) === 0).length;
    const connected = n - isolated;
    const density = n ? Math.round((connected / n) * 100) : 0;

    const avgEl = document.getElementById("avgInternalLinks");
    if (avgEl) avgEl.textContent = String(avgLinks);

    const isolatedEl = document.getElementById("isolatedCount");
    if (isolatedEl) {
      isolatedEl.textContent = `${isolated}件`;
      isolatedEl.className = isolated > 0 ? "text-orange-500" : "text-emerald-500";
    }

    const densityEl = document.getElementById("linkDensity");
    if (densityEl) densityEl.textContent = `${density}%`;
  }

  function updateUrlDesignSection(pages) {
    const n = pages.length;
    const paramCount = pages.filter((p) => (p.url || "").includes("?")).length;
    const paramRate = n ? Math.round((paramCount / n) * 100) : 0;

    const paramEl = document.getElementById("paramRate");
    if (paramEl) paramEl.textContent = `${paramRate}%`;

    const urlCounts = {};
    for (const p of pages) {
      const u = (p.url || "").trim();
      if (u) urlCounts[u] = (urlCounts[u] || 0) + 1;
    }
    const dupUrls = Object.values(urlCounts).filter((c) => c > 1).reduce((a, c) => a + c - 1, 0);
    const dupRate = n ? Math.round((dupUrls / n) * 100) : 0;

    const dupEl = document.getElementById("dupRate");
    if (dupEl) dupEl.textContent = `${dupRate}%`;

    const canonicalEl = document.getElementById("canonicalMissing");
    if (canonicalEl) {
      canonicalEl.textContent = "N/A";
      canonicalEl.className = "text-slate-300";
    }
  }

  function generateDomainInsight(pages) {
    const insightEl = document.getElementById("aiDomainInsight");
    if (!insightEl) return;

    const isolated = pages.filter((p) => (p.internal_links || 0) === 0).length;
    const httpsIssue = pages.some((p) => (p.url || "").startsWith("http://"));

    let analysis = "";
    if (httpsIssue) {
      analysis += "プロトコルの統一に不備があり、セキュリティ面での信頼性に欠ける箇所があります。";
    } else {
      analysis += "常時SSL化が適切に行われており、技術的な信頼性は良好です。";
    }
    if (isolated > 0) {
      analysis += ` 内部リンクが途絶えている孤立ページが${isolated}件検出されました。サイト内の回遊性を改善する必要があります。`;
    } else {
      analysis += " 内部リンク網が密に形成されており、クローラビリティが非常に高い状態です。";
    }

    insightEl.textContent = analysis;
  }

  function renderInternalAuthority(pages) {
    const tableBody = document.getElementById("backlinkTableBody");
    const countEl = document.getElementById("authorityCount");
    if (!tableBody || !pages) return;

    const linksKey = (p) => p.internal_links ?? p.links ?? 0;
    const sorted = [...pages].sort((a, b) => linksKey(b) - linksKey(a)).slice(0, 10);

    if (countEl) countEl.textContent = `${sorted.length}件`;

    tableBody.innerHTML = sorted
      .map((page) => {
        const links = linksKey(page);
        let priorityClass = "bg-slate-50 text-slate-400";
        let priorityText = "LOW";
        if (links > 40) {
          priorityClass = "bg-emerald-50 text-emerald-600";
          priorityText = "HIGH";
        } else if (links > 15) {
          priorityClass = "bg-amber-50 text-amber-600";
          priorityText = "MID";
        }

        let displayPath = page.url || "";
        try {
          const u = new URL(page.url);
          displayPath = u.pathname + u.search;
        } catch (e) {}

        return `
          <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
            <td class="p-4 sm:p-6">
              <div class="text-slate-900 font-bold truncate max-w-[500px] font-mono">${escapeHtml(displayPath)}</div>
              <div class="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-1">${escapeHtml(page.title || "No Title")}</div>
            </td>
            <td class="p-4 sm:p-6 text-center text-slate-900 font-mono font-bold">${links}</td>
            <td class="p-4 sm:p-6 text-center">
              <span class="px-3 py-1 ${priorityClass} rounded-full text-[10px] font-black tracking-widest">${priorityText}</span>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function updateAnalysisDate() {
    const el = document.getElementById("analysisDate");
    if (el) el.textContent = `ANALYSIS: ${new Date().toISOString().split("T")[0]}`;
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
      const pages = data.pages || [];

      if (pages.length === 0) {
        showError("ページデータがありません。");
        return;
      }

      updateProtocolSection(pages);
      updateEATSection(pages);
      updateStructureSection(pages);
      updateUrlDesignSection(pages);
      generateDomainInsight(pages);
      renderInternalAuthority(pages);
      updateAnalysisDate();
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    }
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
})();

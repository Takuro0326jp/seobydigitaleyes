/**
 * gsc-opportunities.js - GSC改善機会の抽出・SEO Strategy連携
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  function updateNavLinks() {
    const suffix = "?scan=" + encodeURIComponent(scanId);
    ["nav-performance", "nav-indexHealth", "nav-technical", "nav-opportunities"].forEach((id, i) => {
      const el = document.getElementById(id);
      const hrefs = ["gsc.html", "gsc-indexhealth.html", "gsc-technical.html", "gsc-opportunities.html"];
      if (el) el.setAttribute("href", hrefs[i] + suffix);
    });
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  async function addToStrategy(keyword, url, opportunityType) {
    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          keyword,
          url: url || null,
          intent: "Informational",
          accepted: false,
          is_ai: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "追加に失敗しました");
      }
      alert("SEO Strategyのキーワード選別に追加しました。承認すると監視リストに入ります。");
    } catch (e) {
      alert(e.message);
    }
  }

  async function loadData() {
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = mappings[scanId];
    if (!propertyUrl) {
      document.getElementById("emptyState")?.classList.remove("hidden");
      document.getElementById("opportunitiesContent")?.classList.add("hidden");
      return;
    }

    document.getElementById("emptyState")?.classList.add("hidden");
    document.getElementById("opportunitiesContent")?.classList.remove("hidden");

    try {
      const [pageRes, queryRes] = await Promise.all([
        fetch("/api/gsc/performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ propertyUrl, scanId, dimensions: ["page"] }),
        }),
        fetch("/api/gsc/performance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ propertyUrl, scanId, dimensions: ["query"] }),
        }),
      ]);

      const pageRows = pageRes.ok ? await pageRes.json() : [];
      const queryRows = queryRes.ok ? await queryRes.json() : [];

      const pages = (pageRows || []).map((r) => ({
        url: r.keys?.[0] || "",
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: parseFloat(r.position) || 0,
      }));

      const queries = (queryRows || []).map((r) => ({
        query: r.keys?.[0] || "",
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: r.ctr || 0,
        position: parseFloat(r.position) || 0,
      }));

      const ctrOpps = pages
        .filter((p) => p.impressions >= 100 && p.ctr < 0.02)
        .sort((a, b) => b.impressions - a.impressions);

      const rankOpps = pages
        .filter((p) => p.position >= 11 && p.position <= 20 && p.impressions >= 50)
        .sort((a, b) => b.impressions - a.impressions);

      const urlSet = new Set(pages.map((p) => (p.url || "").toLowerCase()));
      const untargeted = queries
        .filter((q) => q.impressions >= 100)
        .filter((q) => {
          const ql = (q.query || "").toLowerCase();
          return !pages.some((p) => {
            const path = (p.url || "").split("/").pop() || "";
            return path.toLowerCase().includes(ql) || ql.includes(path.toLowerCase());
          });
        })
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 50);

      renderCtrOpportunities(ctrOpps);
      renderRankOpportunities(rankOpps);
      renderUntargeted(untargeted);
    } catch (e) {
      console.error("Opportunities load error:", e);
      document.getElementById("emptyState")?.classList.remove("hidden");
      document.getElementById("opportunitiesContent")?.classList.add("hidden");
    }
  }

  function renderCtrOpportunities(data) {
    const body = document.getElementById("ctrOpportunitiesBody");
    const empty = document.getElementById("ctrEmpty");
    if (!body) return;
    if (data.length === 0) {
      body.innerHTML = "";
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    body.innerHTML = data
      .map(
        (p) => `
      <tr class="hover:bg-slate-50">
        <td class="p-4"><a href="${esc(p.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline font-mono text-[11px] break-all">${esc(p.url.slice(0, 60))}${p.url.length > 60 ? "…" : ""}</a></td>
        <td class="p-4 text-slate-500">-</td>
        <td class="p-4 text-right font-mono">${p.impressions.toLocaleString("ja-JP")}</td>
        <td class="p-4 text-right">${(p.ctr * 100).toFixed(1)}%</td>
        <td class="p-4 text-right">${p.position.toFixed(1)}</td>
        <td class="p-4 text-slate-600 text-[11px]">タイトル・メタにキーワードを含める</td>
        <td class="p-4"><button type="button" class="add-strategy-btn px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700" data-query="${esc(p.url.split("/").filter(Boolean).pop() || "")}" data-url="${esc(p.url)}">Strategy追加</button></td>
      </tr>
    `
      )
      .join("");
    body.querySelectorAll(".add-strategy-btn").forEach((btn) => {
      btn.addEventListener("click", () => addToStrategy(btn.dataset.query || btn.dataset.url, btn.dataset.url, "ctr"));
    });
  }

  function renderRankOpportunities(data) {
    const body = document.getElementById("rankOpportunitiesBody");
    const empty = document.getElementById("rankEmpty");
    if (!body) return;
    if (data.length === 0) {
      body.innerHTML = "";
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    body.innerHTML = data
      .map(
        (p) => `
      <tr class="hover:bg-slate-50">
        <td class="p-4"><a href="${esc(p.url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline font-mono text-[11px] break-all">${esc(p.url.slice(0, 60))}${p.url.length > 60 ? "…" : ""}</a></td>
        <td class="p-4 text-right font-black">${p.position.toFixed(1)}</td>
        <td class="p-4 text-right font-mono">${p.clicks.toLocaleString("ja-JP")}</td>
        <td class="p-4 text-right font-mono">${p.impressions.toLocaleString("ja-JP")}</td>
        <td class="p-4 text-slate-600 text-[11px]">内部リンク追加で順位改善</td>
        <td class="p-4"><button type="button" class="add-strategy-btn px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700" data-query="${esc(p.url.split("/").filter(Boolean).pop() || "")}" data-url="${esc(p.url)}">Strategy追加</button></td>
      </tr>
    `
      )
      .join("");
    body.querySelectorAll(".add-strategy-btn").forEach((btn) => {
      btn.addEventListener("click", () => addToStrategy(btn.dataset.query || btn.dataset.url, btn.dataset.url, "rank"));
    });
  }

  function renderUntargeted(data) {
    const body = document.getElementById("untargetedBody");
    const empty = document.getElementById("untargetedEmpty");
    if (!body) return;
    if (data.length === 0) {
      body.innerHTML = "";
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");
    body.innerHTML = data
      .map(
        (q) => `
      <tr class="hover:bg-slate-50">
        <td class="p-4 font-bold text-slate-800">${esc(q.query)}</td>
        <td class="p-4 text-right font-mono">${q.impressions.toLocaleString("ja-JP")}</td>
        <td class="p-4 text-slate-600 text-[11px]">新規コンテンツ作成を検討</td>
        <td class="p-4"><button type="button" class="add-strategy-btn px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700" data-query="${esc(q.query)}">Strategy追加</button></td>
      </tr>
    `
      )
      .join("");
    body.querySelectorAll(".add-strategy-btn").forEach((btn) => {
      btn.addEventListener("click", () => addToStrategy(btn.dataset.query, null, "untargeted"));
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    updateNavLinks();
    void loadData();
  });
})();

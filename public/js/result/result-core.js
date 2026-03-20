/**
 * result.html — GET /api/scan/result/:id
 */
window.SEOState = window.SEOState || {};
SEOState.scan = null;
SEOState.pages = [];
SEOState.allCrawlData = [];
SEOState.summary = null;
SEOState.scanHistory = [];

(function () {
  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) window.location.replace("/seo.html");
})();

function getScanIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("scan") || params.get("scanId");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showLoading(msg) {
  const o = document.getElementById("loadingOverlay");
  const t = document.getElementById("loadingStatus");
  if (o) o.classList.remove("hidden");
  if (t) t.textContent = msg || "解析中...";
}

function hideLoading() {
  const o = document.getElementById("loadingOverlay");
  if (o) o.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  void initializeResultPage();
});

function showErrorAndBack(message) {
  hideLoading();
  const main = document.querySelector("main");
  if (main) {
    main.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center">
        <p class="text-slate-600 font-bold mb-6">${message}</p>
        <a href="/seo.html" class="inline-block px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">
          一覧に戻る
        </a>
      </div>
    `;
  } else {
    alert(message + "\n一覧に戻ります。");
    window.location.replace("/seo.html");
  }
}

async function initializeResultPage() {
  try {
    const scanId = getScanIdFromURL();
    if (!scanId) {
      window.location.replace("/seo.html");
      return;
    }
    SEOState.scanId = scanId;

    let tries = 0;
    const maxTries = 600;

    while (tries < maxTries) {
      const res = await fetch(
        `/api/scans/result/${encodeURIComponent(scanId)}`,
        { credentials: "include" }
      );

      if (res.status === 401) {
        window.location.replace("/");
        return;
      }
      if (res.status === 404) {
        showErrorAndBack("スキャンが見つかりません。一覧から再度お試しください。");
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showErrorAndBack(errData.error || `エラーが発生しました (${res.status})`);
        return;
      }

      const data = await res.json();
      SEOState.scan = data.scan;
      SEOState.scanInfo = {
        ...data.scan,
        target_url: data.scan.target_url,
        status: data.scan.status,
      };
      SEOState.allCrawlData = data.pages || [];
      SEOState.summary = data.summary || {};
      SEOState.scanHistory = data.history || [];

      const st = data.scan?.status;
      if (st === "queued" || st === "running") {
        showLoading(
          st === "queued"
            ? "キュー待ち… まもなくクロールを開始します"
            : `クロール中… ${SEOState.allCrawlData.length} ページ取得済み`
        );
        await sleep(2000);
        tries++;
        continue;
      }

      hideLoading();

      if (typeof renderAiSummary === "function") renderAiSummary();
      else {
        const el = document.getElementById("aiSummary");
        if (el)
          el.textContent =
            SEOState.summary?.executiveSummary || "サマリーがありません";
      }

      calculateMetrics();
      if (typeof renderAll === "function") renderAll();
      if (st === "failed") {
        break;
      }
      SEOState.initialized = true;
      break;
    }

    if (tries >= maxTries) {
      hideLoading();
      alert("スキャンがタイムアウトしました。一覧から再度開いてください。");
    }
  } catch (e) {
    console.error(e);
    showErrorAndBack("データの取得に失敗しました。");
  }
}

function renderAiSummary() {
  const el = document.getElementById("aiSummary");
  if (!el) return;
  const s = SEOState.summary?.executiveSummary;
  el.textContent = s && s.trim() ? s : "サマリー未生成";
}

function calculateMetrics() {
  const data = SEOState.allCrawlData;
  if (!data.length) {
    SEOState.avgScore = 0;
    SEOState.criticalIssues = 0;
    SEOState.lossRate = 0;
    return;
  }
  SEOState.avgScore = Math.round(
    data.reduce((a, c) => a + (c.score || 0), 0) / data.length
  );
  SEOState.criticalIssues = data.filter((p) => isCritical(p)).length;
  const loss = data.filter(
    (p) => (p.depth || 0) >= 4 && (p.internal_links || 0) <= 2
  ).length;
  SEOState.lossRate = Math.round((loss / data.length) * 100);
}

window.isCritical = function (p) {
  return (
    (p.status || 0) >= 400 ||
    p.index_status === "noindex" ||
    !(p.title || "").trim() ||
    (p.h1_count || 0) === 0 ||
    ((p.title || "").length > 0 && (p.title || "").length < 10)
  );
};

function renderAll() {
  if (typeof renderStats === "function") renderStats();
  if (typeof buildDirectoryFilter === "function") buildDirectoryFilter();
  if (typeof renderTable === "function") renderTable(SEOState.allCrawlData);
  if (typeof renderDirectoryHealth === "function")
    renderDirectoryHealth(SEOState.allCrawlData);
  if (typeof initHistoryChart === "function") initHistoryChart();
  const firstUrl = (SEOState.allCrawlData || [])[0]?.url;
  const siteUrl = firstUrl ? new URL(firstUrl).origin : undefined;
  if (typeof loadLastSitemap === "function") loadLastSitemap(siteUrl);
}

window.renderStats = function () {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? (val === 0 ? "0" : "—");
  };
  const data = SEOState.allCrawlData || [];
  set("stat-pages", data.length || "—");
  set("stat-score", SEOState.avgScore ?? "—");
  set("stat-loss", SEOState.lossRate ?? "—");
  set("stat-alerts", SEOState.criticalIssues ?? "—");

  const alertBg = document.getElementById("alert-status-bg");
  const alertText = document.getElementById("alert-status-text");
  if (alertBg && alertText) {
    if (SEOState.criticalIssues > 0) {
      alertBg.className =
        "mt-4 flex items-center gap-2 text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full w-fit";
      alertText.textContent = "● 要修正項目あり";
    } else {
      alertBg.className =
        "mt-4 flex items-center gap-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full w-fit";
      alertText.textContent = "● Healthy";
    }
  }

  if (typeof updateSummaryCards === "function")
    updateSummaryCards(data);
  if (data.length && typeof updateStatsCards === "function")
    updateStatsCards(data);
};

function updateSummaryCards(pages) {
  if (!Array.isArray(pages)) return;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("stat-pages", pages.length);
}

function getDirectory(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "/";
    return "/" + parts[0] + "/";
  } catch {
    return "/";
  }
}

function buildDirectoryStats(pages) {
  const map = {};
  pages.forEach((p) => {
    const dir = getDirectory(p.url);
    if (!map[dir])
      map[dir] = {
        pages: 0,
        score: 0,
        indexed: 0,
        issuesPages: 0,
        issuesMap: {},
      };
    map[dir].pages++;
    map[dir].score += p.score || 0;
    if (p.index_status === "index") map[dir].indexed++;
    const deductions = Array.isArray(p.deductions) ? p.deductions : [];
    if ((p.deduction_total || 0) > 0) {
      map[dir].issuesPages++;
      deductions.forEach((d) => {
        const label = d?.label || "unknown";
        map[dir].issuesMap[label] = (map[dir].issuesMap[label] || 0) + 1;
      });
    }
  });
  return Object.entries(map)
    .map(([dir, v]) => ({
      dir,
      pages: v.pages,
      avgScore: Math.round(v.score / v.pages),
      issues: v.issuesPages,
      indexRate: Math.round((v.indexed / v.pages) * 100),
      issuesDetails: v.issuesMap,
    }))
    .sort((a, b) => b.pages - a.pages);
}

function getScoreColor(score) {
  if (score >= 90) return "text-emerald-600";
  if (score >= 70) return "text-amber-500";
  if (score >= 50) return "text-orange-500";
  return "text-red-500";
}

function renderDirectoryHealth(pages) {
  const body = document.getElementById("directory-health-body");
  if (!body) return;
  const stats = buildDirectoryStats(pages || []);
  body.innerHTML = stats
    .map((s) => {
      const scoreColor = getScoreColor(s.avgScore);
      const issuesBtn =
        s.issues > 0
          ? `<span class="px-2 py-1 rounded-md bg-red-50 text-red-500 text-[11px] font-bold">${s.issues}</span>`
          : `<span class="px-2 py-1 rounded-md bg-slate-50 text-slate-400 text-[11px] font-bold">0</span>`;
      return `<tr class="hover:bg-slate-50 transition">
        <td class="px-6 py-4 font-semibold text-slate-800">${s.dir}</td>
        <td class="px-4 py-4 text-center text-slate-600 font-medium">${s.pages}</td>
        <td class="px-4 py-4 text-center font-extrabold ${scoreColor}">${s.avgScore}</td>
        <td class="px-4 py-4 text-center">${issuesBtn}</td>
        <td class="px-4 py-4 text-center text-slate-600 font-medium">${s.indexRate}%</td>
      </tr>`;
    })
    .join("");
}

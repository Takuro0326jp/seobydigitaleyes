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

// #region agent log
/** @typedef {{hypothesisId?:string,message?:string,location?:string,data?:object,runId?:string}} __DbgPayload */
function __seoDbg(/** __DbgPayload */ p) {
  fetch("http://127.0.0.1:7746/ingest/b51285b8-f343-4145-a584-bc496191010c", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "3a8ba6",
    },
    body: JSON.stringify(
      Object.assign(
        {
          sessionId: "3a8ba6",
          timestamp: Date.now(),
          location: p.location || "result-core.js",
          message: p.message || "",
          hypothesisId: p.hypothesisId || "",
          runId: p.runId || "pre",
          data: p.data || {},
        },
        {}
      )
    ),
  }).catch(function () {});
}
// #endregion

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

/** result.html だけで完結: service worker／キャッシュで scan-result-fetch.js が無い場合でもチャンク結合する */
async function fetchFullScanResultForResultPage(scanId) {
  const enc = encodeURIComponent(scanId);
  const cred = { credentials: "include" };
  const res = await fetch(`/api/scans/result/${enc}`, cred);
  // #region agent log
  __seoDbg({
    hypothesisId: "H1",
    location: "fetchFull:firstResponse",
    message: "scan result primary fetch",
    data: {
      status: res.status,
      ok: res.ok,
      ct: res.headers && res.headers.get ? res.headers.get("content-type") : "",
      cl: res.headers && res.headers.get ? res.headers.get("content-length") : "",
    },
  });
  // #endregion
  if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
  if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
  if (!res.ok) {
    let body = {};
    try {
      body = await res.json();
    } catch (_) {}
    throw Object.assign(new Error(body.error || res.statusText || "request failed"), {
      status: res.status,
      body,
    });
  }
  let data;
  try {
    data = await res.json();
  } catch (ej) {
    // #region agent log
    __seoDbg({
      hypothesisId: "H1",
      location: "fetchFull:primaryJsonFail",
      message: String(ej && ej.message ? ej.message : ej),
      data: { phase: "primary" },
    });
    // #endregion
    throw ej;
  }
  const pag = data.pagination;
  // #region agent log
  __seoDbg({
    hypothesisId: "H1,H4",
    location: "fetchFull:afterPrimaryJson",
    message: "parsed primary body",
    data: {
      chunked: !!(pag && pag.chunked),
      total: pag && pag.total,
      pageSize: pag && pag.pageSize,
      firstPagesLen: Array.isArray(data.pages) ? data.pages.length : -1,
    },
  });
  // #endregion
  if (!pag || !pag.chunked) return data;

  const total = Number(pag.total) || 0;
  const pageSize = Number(pag.pageSize) || 40;
  const pages = Array.isArray(data.pages) ? [...data.pages] : [];
  let loops = 0;
  while (pages.length < total && loops < 500) {
    loops++;
    const cr = await fetch(
      `/api/scans/result/${enc}/pages?offset=${pages.length}&limit=${pageSize}`,
      cred
    );
    if (!cr.ok) {
      let bx = {};
      try {
        bx = await cr.json();
      } catch (_) {}
      throw Object.assign(new Error(bx.error || "chunk fetch failed"), { status: cr.status, body: bx });
    }
    const part = await cr.json();
    const add = Array.isArray(part.pages) ? part.pages : [];
    // #region agent log
    __seoDbg({
      hypothesisId: "H1,H4",
      location: "fetchFull:chunk",
      message: "chunk received",
      data: { loops, crOk: cr.ok, crStatus: cr.status, addLen: add.length, pagesLenAfter: pages.length + add.length, total },
    });
    // #endregion
    if (add.length === 0) break;
    pages.push(...add);
  }
  delete data.pagination;
  data.pages = pages;
  return data;
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
    // 本番は最大約3時間のクロールあり得るため 2秒×7200 ≒ 4時間まで待機
    const maxTries = 7200;

    while (tries < maxTries) {
      const res = await fetch(
        `/api/scans/result/${encodeURIComponent(scanId)}?overview=1`,
        { credentials: "include" }
      );

      // #region agent log
      __seoDbg({
        hypothesisId: "H2,H5",
        location: "init:overviewFetch",
        message: "overview response",
        data: {
          tryN: tries,
          status: res.status,
          ok: res.ok,
          ct: res.headers && res.headers.get ? res.headers.get("content-type") : "",
        },
      });
      // #endregion

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

      let data;
      try {
        data = await res.json();
      } catch (eo) {
        // #region agent log
        __seoDbg({
          hypothesisId: "H5",
          location: "init:overviewJsonFail",
          message: String(eo && eo.message ? eo.message : eo),
          data: { tryN: tries },
        });
        // #endregion
        throw eo;
      }
      // #region agent log
      __seoDbg({
        hypothesisId: "H2",
        location: "init:overviewParsed",
        message: "overview parsed",
        data: {
          scanStatus: data.scan && data.scan.status,
          pageTotal: data.pageTotal,
          overviewFlag: !!data.overview,
        },
      });
      // #endregion
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
      const pageDisp =
        typeof data.pageTotal === "number"
          ? data.pageTotal
          : SEOState.allCrawlData.length || 0;
      if (st === "queued" || st === "running") {
        showLoading(
          st === "queued"
            ? "キュー待ち… まもなくクロールを開始します"
            : `クロール中… ${pageDisp} ページ取得済み`
        );
        await sleep(2000);
        tries++;
        continue;
      }

      hideLoading();

      let mergedSt = st;
      try {
        const full = await fetchFullScanResultForResultPage(scanId);
        mergedSt = full.scan?.status ?? mergedSt;

        SEOState.scan = full.scan;
        SEOState.scanInfo = {
          ...full.scan,
          target_url: full.scan.target_url,
          status: full.scan.status,
        };
        SEOState.allCrawlData = full.pages || [];
        SEOState.summary = full.summary || {};
        SEOState.scanHistory = full.history || [];
        // #region agent log
        __seoDbg({
          hypothesisId: "H4",
          location: "init:afterFullMerge",
          message: "full bundle merged",
          data: {
            mergedPages: SEOState.allCrawlData.length,
            mergedStatus: full.scan && full.scan.status,
          },
        });
        // #endregion
      } catch (e) {
        // #region agent log
        __seoDbg({
          hypothesisId: "H1",
          location: "init:fetchFullRejected",
          message: e && e.message ? e.message : String(e),
          data: {
            status: e && e.status,
            stackSnippet: e && e.stack ? String(e.stack).slice(0, 400) : "",
          },
        });
        // #endregion
        if (e.status === 401) {
          window.location.replace("/");
          return;
        }
        throw e;
      }

      if (typeof renderAiSummary === "function") renderAiSummary();
      else {
        const el = document.getElementById("aiSummary");
        if (el)
          el.textContent =
            SEOState.summary?.executiveSummary || "サマリーがありません";
      }

      // #region agent log
      __seoDbg({
        hypothesisId: "H3,H4",
        location: "init:beforeRender",
        message: "about to metrics+renderAll",
        data: { mergedSt, crawlPages: (SEOState.allCrawlData && SEOState.allCrawlData.length) || 0 },
      });
      // #endregion

      try {
        calculateMetrics();
        if (typeof renderAll === "function") renderAll();
      } catch (rendErr) {
        // #region agent log
        __seoDbg({
          hypothesisId: "H3",
          location: "init:renderOrMetricsFail",
          message: rendErr && rendErr.message ? rendErr.message : String(rendErr),
          data: {
            stackSnippet:
              rendErr && rendErr.stack ? String(rendErr.stack).slice(0, 420) : "",
          },
        });
        // #endregion
        throw rendErr;
      }
      if (mergedSt === "failed") {
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
    // #region agent log
    __seoDbg({
      hypothesisId: "H1,H3",
      location: "init:catch",
      message: e && e.message ? e.message : String(e),
      data: {
        name: e && e.name,
        status: e && e.status,
        stackSnippet: e && e.stack ? String(e.stack).slice(0, 480) : "",
      },
    });
    // #endregion
    console.error("[result-page]", e && e.message ? e.message : e, e && e.stack ? e.stack : "");
    showErrorAndBack(
      typeof e !== "undefined" && e && e.message
        ? `データの取得に失敗しました。(${e.message})`
        : "データの取得に失敗しました。"
    );
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
  if (typeof renderTopImportantPages === "function")
    renderTopImportantPages(SEOState.allCrawlData);
  if (typeof renderCrawlDepthDistribution === "function")
    renderCrawlDepthDistribution(SEOState.allCrawlData);
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

/** 1-C: PageRank順 ページ一覧 */
window.renderTopImportantPages = function (pages) {
  const body = document.getElementById("topImportantPagesBody");
  const sortSelect = document.getElementById("topPagesSortSelect");
  const viewAllLink = document.getElementById("topPagesViewAllLink");
  if (!body) return;

  const data = pages || SEOState?.allCrawlData || [];
  const hasPageRank = data.some((p) => p.page_rank != null);
  if (!hasPageRank || data.length === 0) {
    body.innerHTML = "<p class=\"text-slate-400 text-sm\" style=\"grid-column:1/-1\">PageRank データがありません。再スキャンしてください。</p>";
    body.classList.add("pr-pages-grid");
    return;
  }
  body.classList.add("pr-pages-grid");

  const sortKey = sortSelect?.value || "page_rank";
  const sorted = [...data].sort((a, b) => {
    const va = Number(a[sortKey]) ?? 0;
    const vb = Number(b[sortKey]) ?? 0;
    return vb - va;
  });
  const top10 = sorted.slice(0, 10);

  const maxPr = Math.max(...top10.map((p) => Number(p.page_rank) || 0), 0.0001);
  const metricValClass = (val, activeClass) =>
    val > 0 ? `pr-pages-metric-val ${activeClass}` : "pr-pages-metric-val-zero";

  const scanId = getScanIdFromURL ? getScanIdFromURL() : (SEOState?.scanId || "");
  const params = scanId ? `?scan=${encodeURIComponent(scanId)}` : "";

  body.innerHTML = top10
    .map((p, i) => {
      const rank = i + 1;
      const pr = Number(p.page_rank) ?? 0;
      const prPct = pr > 0 ? Math.min(100, Math.round((pr / maxPr) * 100)) : 0;
      const inbound = Number(p.inbound_link_count) || 0;
      const outbound = Number(p.outbound_link_count ?? p.internal_links) || 0;
      const detailUrl = `link-structure.html${params}${params ? "&" : "?"}focus=${encodeURIComponent(p.url || "")}`;
      return `
        <div class="pr-pages-card">
          <span class="pr-pages-rank">${rank}</span>
          <div class="pr-pages-main">
            <a href="${detailUrl}" class="pr-pages-url" title="${escapeHtmlForResult(p.url || "")}">${escapeHtmlForResult(p.url || "-")}</a>
            <span class="pr-pages-desc-text" title="${escapeHtmlForResult(p.title || "")}">${escapeHtmlForResult(p.title || "-")}</span>
          </div>
          <div class="pr-pages-metrics">
            <div class="pr-pages-pr-wrap">
              <span class="${pr > 0 ? "pr-pages-pr-val" : "pr-pages-pr-val-zero"}">${pr.toFixed(2)}</span>
              <div class="pr-pages-pr-bar-outer">
                <div class="pr-pages-pr-bar-inner" style="width:${prPct}%"></div>
              </div>
              <span class="pr-pages-metric-name">PageRank</span>
            </div>
            <div class="pr-pages-metric-sep"></div>
            <div class="pr-pages-metric">
              <span class="${metricValClass(inbound, "pr-pages-metric-val-inbound")}">${inbound}</span>
              <span class="pr-pages-metric-name">被リンク</span>
            </div>
            <div class="pr-pages-metric-sep"></div>
            <div class="pr-pages-metric">
              <span class="${metricValClass(outbound, "pr-pages-metric-val-outbound")}">${outbound}</span>
              <span class="pr-pages-metric-name">発リンク</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  if (viewAllLink) {
    const tableSection = document.getElementById("pageQualityTableSection");
    viewAllLink.href = "#pageQualityTableSection";
    viewAllLink.onclick = (e) => {
      e.preventDefault();
      tableSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (typeof filterAndRenderTable === "function") filterAndRenderTable();
    };
  }

  if (sortSelect) {
    sortSelect.onchange = () => renderTopImportantPages(SEOState?.allCrawlData || []);
  }
};

function escapeHtmlForResult(s) {
  if (s == null || s === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

/** 1-B: 深さ別ページ分布グラフ */
let crawlDepthChartInstance = null;
window.renderCrawlDepthDistribution = function (pages) {
  const canvas = document.getElementById("crawlDepthChart");
  const badge = document.getElementById("depth4Badge");
  if (!canvas) return;

  const data = pages || SEOState?.allCrawlData || [];
  if (data.length === 0) {
    if (badge) badge.classList.add("hidden");
    return;
  }

  const depthCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  data.forEach((p) => {
    const d = Math.min(4, Math.max(1, p.depth || p.crawl_depth || 1));
    depthCounts[d] = (depthCounts[d] || 0) + 1;
  });

  const depth4Count = depthCounts[4] || 0;
  if (badge) {
    badge.textContent = `深さ4以上: ${depth4Count}件`;
    badge.classList.toggle("hidden", depth4Count === 0);
  }

  const ctx = canvas.getContext("2d");
  if (typeof Chart === "undefined") return;

  if (crawlDepthChartInstance) crawlDepthChartInstance.destroy();

  const labels = ["深さ1", "深さ2", "深さ3", "深さ4以上"];
  const values = [depthCounts[1] || 0, depthCounts[2] || 0, depthCounts[3] || 0, depthCounts[4] || 0];
  const colors = ["#6366F1", "#818CF8", "#A5B4FC", "#E53E3E"];

  crawlDepthChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: colors.map((c) => c),
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterBody: function (items) {
              const idx = items[0]?.dataIndex;
              if (idx === 3 && values[3] > 0) {
                return ["SEO上のリスクあり。内部リンクを追加してください。"];
              }
              return [];
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "ページ数" } },
        y: { title: { display: true, text: "クロール深さ" } },
      },
    },
  });
};

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

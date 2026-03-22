/**
 * domain.js - Domain Authority タブ リデザイン
 * /api/scans/result/:id からスキャンデータを取得し、ドメイン権威性スコア・改善アクション・重要ページを表示
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  const INDUSTRY_AVG_SCORE = 58;
  const CIRCLE_DASH = 2 * Math.PI * 36; // 226.2 に相当
  const LABELS = {
    good: "良好",
    medium: "中程度",
    needImprove: "要改善",
    low: "低い",
  };
  const COLORS = {
    good: "#10B981",
    medium: "#F59E0B",
    needImprove: "#EF4444",
    low: "#DC2626",
  };

  const keywords = {
    company: ["会社概要", "about", "company", "運営者", "about-us"],
    privacy: ["プライバシー", "privacy", "個人情報"],
  };

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function checkFound(pages, kList) {
    return pages.some((p) =>
      kList.some((k) =>
        ((p.url || "") + (p.title || "")).toLowerCase().includes(k)
      )
    );
  }

  /** ページ一覧から DomainAuthorityData を構築 */
  function buildDomainData(pages, scan) {
    const n = pages.length;
    const hasHttp = pages.some((p) => (p.url || "").startsWith("http://"));
    let hostnames = [];
    try {
      hostnames = pages.map((p) => new URL(p.url).hostname);
    } catch (_) {}
    const uniqueHosts = new Set(hostnames);
    const wwwUnified = uniqueHosts.size <= 1;

    const paramCount = pages.filter((p) => (p.url || "").includes("?")).length;
    const paramRate = n ? Math.round((paramCount / n) * 100) : 0;

    const urlCounts = {};
    for (const p of pages) {
      const u = (p.url || "").trim();
      if (u) urlCounts[u] = (urlCounts[u] || 0) + 1;
    }
    const dupUrls = Object.values(urlCounts).filter((c) => c > 1).reduce((a, c) => a + c - 1, 0);
    const dupRate = n ? Math.round((dupUrls / n) * 100) : 0;

    const orphanCount = pages.filter((p) => p.is_orphan || (p.inbound_link_count === 0)).length;
    const connected = n - orphanCount;
    const linkDensity = n ? Math.round((connected / n) * 100) : 100;
    const totalInternal = pages.reduce((sum, p) => sum + (p.internal_links || 0), 0);
    const avgInternalLinks = n ? Math.round(totalInternal / n) : 0;

    return {
      httpsEnabled: !hasHttp,
      wwwUnified,
      redirectChain: false,
      companyPageFound: checkFound(pages, keywords.company),
      privacyPolicyFound: checkFound(pages, keywords.privacy),
      organizationSchemaFound: false,
      authorSchemaFound: false,
      orphanPageCount: orphanCount,
      avgInternalLinks,
      linkDensity,
      parameterRate: paramRate,
      duplicateURLRate: dupRate,
      canonicalFullyCovered: false,
      previousScore: undefined,
      industryAvgScore: INDUSTRY_AVG_SCORE,
      lastScannedAt: scan?.updated_at || scan?.created_at || new Date().toISOString(),
    };
  }

  function calcProtocolScore(data) {
    let score = 0;
    if (data.httpsEnabled) score += 10;
    if (data.wwwUnified) score += 8;
    if (!data.redirectChain) score += 7;
    return score;
  }

  function calcEATScore(data) {
    let score = 0;
    if (data.companyPageFound) score += 7;
    if (data.privacyPolicyFound) score += 6;
    if (data.organizationSchemaFound) score += 7;
    if (data.authorSchemaFound) score += 5;
    return score;
  }

  function calcLinkScore(data) {
    let score = 25;
    const orphanPenalty = Math.min(data.orphanPageCount * 0.2, 13);
    score -= orphanPenalty;
    if (data.linkDensity < 50) score -= 5;
    else if (data.linkDensity < 70) score -= 2;
    return Math.max(0, Math.round(score));
  }

  function calcURLScore(data) {
    let score = 15;
    if (data.parameterRate > 5) score -= 5;
    if (data.duplicateURLRate > 3) score -= 5;
    if (!data.canonicalFullyCovered) score -= 1;
    return Math.max(0, score);
  }

  function calcTotalScore(data) {
    return (
      calcProtocolScore(data) +
      calcEATScore(data) +
      calcLinkScore(data) +
      calcURLScore(data)
    );
  }

  function getScoreLabel(score) {
    if (score >= 80) return LABELS.good;
    if (score >= 60) return LABELS.medium;
    if (score >= 40) return LABELS.needImprove;
    return LABELS.low;
  }

  function getScoreColor(score) {
    if (score >= 80) return COLORS.good;
    if (score >= 60) return COLORS.medium;
    if (score >= 40) return COLORS.needImprove;
    return COLORS.low;
  }

  function generateIssues(data) {
    const issues = [];

    if (data.orphanPageCount > 10) {
      issues.push({
        icon: "🔗",
        severity: "warn",
        title: `孤立ページ ${data.orphanPageCount}件 — 内部リンクを追加してください`,
        desc: `被リンク0のページが${data.orphanPageCount}件あります。関連ページからリンクを張ることでPageRankが流れ、検索順位の改善が期待できます。`,
      });
    }

    if (!data.organizationSchemaFound) {
      issues.push({
        icon: "🏢",
        severity: "warn",
        title: "Organization Schema が未設定",
        desc: "会社情報の構造化データがありません。Googleが組織情報を正確に認識できず、ブランド検索での表示強化が弱い状態です。",
      });
    }

    if (!data.authorSchemaFound) {
      issues.push({
        icon: "✍️",
        severity: "info",
        title: "著者情報・レビュースキーマが不足",
        desc: "記事ページにAuthorスキーマがありません。E-A-T強化のため著者プロフィールページとの紐付けを推奨します。",
      });
    }

    if (!data.canonicalFullyCovered) {
      issues.push({
        icon: "🔖",
        severity: "info",
        title: "Canonical タグが一部未設定",
        desc: "重複コンテンツと判断されるリスクがあります。全ページにself-canonicalを設定してください。",
      });
    }

    return issues.slice(0, 5);
  }

  function generateAIComment(data, totalScore) {
    const label = getScoreLabel(totalScore);
    const parts = [];

    if (data.httpsEnabled && data.wwwUnified) {
      parts.push("SSL・HTTPS・URL正規化は完璧に対応済みです。");
    } else if (!data.httpsEnabled) {
      parts.push("HTTPページが混在しています。HTTPSへの移行を推奨します。");
    }

    if (data.orphanPageCount > 0) {
      parts.push(
        `内部リンク構造の弱さ（孤立ページ${data.orphanPageCount}件）がスコアを下げています。`
      );
    } else {
      parts.push("内部リンク網は良好です。");
    }

    if (!data.organizationSchemaFound) {
      parts.push("Organization Schema の追加と孤立ページへの内部リンク設置を優先してください。");
    } else if (data.orphanPageCount > 0) {
      parts.push("孤立ページへの内部リンク設置を優先してください。");
    }

    return {
      label,
      text: parts.join("<br>").trim() || "ドメインの健全性を継続的に監視してください。",
    };
  }

  /** パスから親ディレクトリを取得（例: /works/kyoritsu → /works/） */
  function getParentPath(url) {
    try {
      const u = new URL(url);
      const path = u.pathname || "/";
      const segments = path.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
      if (segments.length <= 1) return "/";
      segments.pop();
      return "/" + segments.join("/") + "/";
    } catch (_) {
      return "/";
    }
  }

  /** 親パスに該当するクロール済みページが存在するか確認し、推奨文言を返す */
  function getRecommendedLinkFrom(orphanUrl, allPaths) {
    const parent = getParentPath(orphanUrl);
    const hasParentPage = allPaths.some((p) => {
      try {
        const path = new URL(p).pathname || "/";
        return path === parent || path === parent.replace(/\/$/, "") || path.startsWith(parent);
      } catch (_) {
        return false;
      }
    });
    return hasParentPage ? `${parent} からリンク追加` : `${parent} からリンク追加`;
  }

  function renderHero(container, data, totalScore, aiComment) {
    const label = getScoreLabel(totalScore);
    const color = getScoreColor(totalScore);
    const dashOffset = CIRCLE_DASH * (1 - totalScore / 100);
    const scanDate = data.lastScannedAt
      ? new Date(data.lastScannedAt).toISOString().split("T")[0]
      : "—";
    const prevDiff =
      data.previousScore != null ? totalScore - data.previousScore : null;

    container.innerHTML = `
      <div class="da-score-wrap">
        <div class="da-ring">
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" fill="none" stroke="var(--color-border-tertiary)" stroke-width="7"/>
            <circle cx="44" cy="44" r="36" fill="none" stroke="${escapeHtml(color)}" stroke-width="7"
              stroke-dasharray="${CIRCLE_DASH}" stroke-dashoffset="${dashOffset}" stroke-linecap="round"/>
          </svg>
          <div class="da-num"><span class="n">${totalScore}</span><span class="l">/100</span></div>
        </div>
        <span class="da-label" style="color:${escapeHtml(color)}">${escapeHtml(label)}</span>
      </div>
      <div class="hero-center">
        <h2>ドメイン権威性スコア — ${escapeHtml(aiComment.label)}</h2>
        <p>${aiComment.text}</p>
      </div>
      <div class="hero-right">
        <div class="mini-metric">
          <div class="ml">最終スキャン</div>
          <div class="mv" style="font-size:12px">${escapeHtml(scanDate)}</div>
        </div>
        ${
          prevDiff != null
            ? `
        <div class="mini-metric">
          <div class="ml">前回比</div>
          <div class="mv" style="color:${prevDiff >= 0 ? "#10B981" : "#EF4444"}">${prevDiff >= 0 ? "▲" : "▼"} ${prevDiff >= 0 ? "+" : ""}${prevDiff}</div>
        </div>
        `
            : ""
        }
        <div class="mini-metric">
          <div class="ml">業界平均</div>
          <div class="mv" style="font-size:13px">${data.industryAvgScore} / 100</div>
        </div>
      </div>
    `;
  }

  const CATEGORIES = [
    {
      key: "protocol",
      label: "プロトコル・正規化",
      max: 25,
      calc: calcProtocolScore,
      getNote: (d, s) => {
        if (s >= 25) return "HTTPS・www統一・リダイレクト 全て対応済み";
        const missing = [];
        if (!d.httpsEnabled) missing.push("HTTPS");
        if (!d.wwwUnified) missing.push("www統一");
        if (d.redirectChain) missing.push("リダイレクトチェーン");
        return missing.length ? missing.join("・") + "の対応が必要" : "改善の余地あり";
      },
    },
    {
      key: "eat",
      label: "信頼性要素 E-A-T",
      max: 25,
      calc: calcEATScore,
      getNote: (d, s) => {
        const missing = [];
        if (!d.organizationSchemaFound) missing.push("Organization Schema");
        if (!d.authorSchemaFound) missing.push("著者情報");
        if (!d.companyPageFound) missing.push("会社ページ");
        if (!d.privacyPolicyFound) missing.push("プライバシーポリシー");
        return missing.length ? missing.join("・") + " 未設定または不足" : "主要要素は揃っています";
      },
    },
    {
      key: "link",
      label: "内部リンク構造",
      max: 25,
      calc: calcLinkScore,
      getNote: (d) =>
        d.orphanPageCount > 0
          ? `孤立ページ${d.orphanPageCount}件。リンク密度${d.linkDensity}%は改善余地あり`
          : `リンク密度${d.linkDensity}%。良好な状態です`,
    },
    {
      key: "url",
      label: "URL設計",
      max: 15,
      calc: calcURLScore,
      getNote: (d, s) => {
        if (s >= 14) return "パラメータ・重複URLなし。Canonicalは一部未設定";
        const issues = [];
        if (d.parameterRate > 5) issues.push("パラメータ多数");
        if (d.duplicateURLRate > 3) issues.push("重複URL");
        if (!d.canonicalFullyCovered) issues.push("Canonical未完全");
        return issues.length ? issues.join("・") + " の改善が必要" : "改善の余地あり";
      },
    },
  ];

  function renderScoreBreakdown(container, data) {
    container.innerHTML = CATEGORIES.map((cat) => {
      const score = cat.calc(data);
      const pct = cat.max > 0 ? Math.round((score / cat.max) * 100) : 0;
      const color = score >= cat.max * 0.8 ? COLORS.good : score >= cat.max * 0.5 ? COLORS.medium : COLORS.needImprove;
      const note = cat.getNote(data, score);
      return `
        <div class="score-card">
          <div class="sc-label">
            <span style="width:7px;height:7px;border-radius:50%;background:${escapeHtml(color)};display:inline-block"></span>
            ${escapeHtml(cat.label)}
          </div>
          <div class="sc-score" style="color:${escapeHtml(color)}">${score}/${cat.max}</div>
          <div class="sc-bar"><div class="sc-fill" style="width:${Math.min(pct, 100)}%;background:${escapeHtml(color)}"></div></div>
          <div class="sc-note">${escapeHtml(note)}</div>
        </div>
      `;
    }).join("");
  }

  function renderIssues(container, issues) {
    if (issues.length === 0) {
      container.innerHTML = '<div class="text-xs text-slate-500 py-4">該当する改善アクションはありません。引き続き良好な状態を維持してください。</div>';
      return;
    }
    container.innerHTML = issues
      .map((i) => {
        const badgeClass = i.severity === "warn" ? "badge-warn" : "badge-info";
        const badgeText = i.severity === "warn" ? "要対応" : "推奨";
        return `
          <div class="issue-row ${i.severity}">
            <div class="issue-icon">${i.icon}</div>
            <div class="issue-body">
              <div class="issue-title">${escapeHtml(i.title)}</div>
              <div class="issue-desc">${escapeHtml(i.desc)}</div>
            </div>
            <div style="flex-shrink:0;margin-top:2px"><span class="badge ${badgeClass}">${badgeText}</span></div>
          </div>
        `;
      })
      .join("");
  }

  function pathFromUrl(url) {
    try {
      return new URL(url).pathname + new URL(url).search;
    } catch (_) {
      return url || "";
    }
  }

  const HIGH_DEFAULT_COUNT = 10;

  function renderHighAuthorityTable(body, pages) {
    const full = [...pages]
      .filter((p) => (p.inbound_link_count ?? 0) > 0 || (p.page_rank ?? 0) > 0)
      .sort((a, b) => (b.inbound_link_count ?? 0) - (a.inbound_link_count ?? 0));
    const sorted = full.slice(0, HIGH_DEFAULT_COUNT);

    body.innerHTML = sorted
      .map((p, i) => {
        const inbound = p.inbound_link_count ?? 0;
        const pr = p.page_rank ?? 0;
        const prPct = Math.min(100, Math.round(pr * 100));
        const priority = pr >= 0.5 ? "HIGH" : pr >= 0.2 ? "MEDIUM" : "LOW";
        const priorityClass = priority === "HIGH" ? "rank-high" : "rank-mid";
        const displayPath = pathFromUrl(p.url);
        return `
          <tr>
            <td style="color:var(--color-text-tertiary);font-size:11px">${i + 1}</td>
            <td>
              <div class="page-url">${escapeHtml(displayPath)}</div>
              <div class="page-title">${escapeHtml(p.title || "No Title")}</div>
            </td>
            <td style="text-align:center;font-weight:500">${inbound}</td>
            <td>
              <div style="display:flex;align-items:center">
                <div class="pr-bar-wrap"><div class="pr-bar-fill" style="width:${prPct}%"></div></div>
                <span style="font-size:11px">${pr.toFixed(2)}</span>
              </div>
            </td>
            <td><span class="rank-badge ${priorityClass}">${priority}</span></td>
          </tr>
        `;
      })
      .join("");

    const moreBtn = document.getElementById("js-show-more-high");
    if (moreBtn && full.length > HIGH_DEFAULT_COUNT) {
      moreBtn.classList.remove("hidden");
      moreBtn.onclick = () => {
        body.innerHTML = full
          .map((p, i) => {
            const inbound = p.inbound_link_count ?? 0;
            const pr = p.page_rank ?? 0;
            const prPct = Math.min(100, Math.round(pr * 100));
            const priority = pr >= 0.5 ? "HIGH" : pr >= 0.2 ? "MEDIUM" : "LOW";
            const priorityClass = priority === "HIGH" ? "rank-high" : "rank-mid";
            const displayPath = pathFromUrl(p.url);
            return `
              <tr>
                <td style="color:var(--color-text-tertiary);font-size:11px">${i + 1}</td>
                <td>
                  <div class="page-url">${escapeHtml(displayPath)}</div>
                  <div class="page-title">${escapeHtml(p.title || "No Title")}</div>
                </td>
                <td style="text-align:center;font-weight:500">${inbound}</td>
                <td>
                  <div style="display:flex;align-items:center">
                    <div class="pr-bar-wrap"><div class="pr-bar-fill" style="width:${prPct}%"></div></div>
                    <span style="font-size:11px">${pr.toFixed(2)}</span>
                  </div>
                </td>
                <td><span class="rank-badge ${priorityClass}">${priority}</span></td>
              </tr>
            `;
          })
          .join("");
        moreBtn.classList.add("hidden");
      };
    } else if (moreBtn) {
      moreBtn.classList.add("hidden");
    }
  }

  function renderOrphanTable(body, pages, allPages) {
    const orphans = pages
      .filter((p) => p.is_orphan || (p.inbound_link_count === 0))
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));

    const allPaths = allPages.map((p) => p.url);

    body.innerHTML = orphans
      .map((p) => {
        const depth = p.depth ?? 0;
        const pr = p.page_rank ?? 0;
        const prPct = Math.min(100, Math.round(pr * 100));
        const depthClass = depth >= 4 ? "color:#EF4444;font-weight:500" : "color:#F59E0B;font-weight:500";
        const rec = getRecommendedLinkFrom(p.url, allPaths);
        const displayPath = pathFromUrl(p.url);
        return `
          <tr>
            <td>
              <div class="page-url">${escapeHtml(displayPath)}</div>
              <div class="page-title">${escapeHtml(p.title || "No Title")}</div>
            </td>
            <td style="text-align:center"><span style="${depthClass}">深さ${depth}</span></td>
            <td>
              <div style="display:flex;align-items:center">
                <div class="pr-bar-wrap"><div class="pr-bar-fill" style="width:${prPct}%;background:${depth >= 4 ? "#EF4444" : "#6366F1"}"></div></div>
                <span style="font-size:11px">${pr.toFixed(2)}</span>
              </div>
            </td>
            <td style="font-size:10px;color:var(--color-text-secondary)">${escapeHtml(rec)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function exportOrphanCSV(pages) {
    const orphans = pages
      .filter((p) => p.is_orphan || (p.inbound_link_count === 0))
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    const allPaths = pages.map((p) => p.url);
    const headers = ["URL", "タイトル", "クロール深さ", "PageRank", "推奨アクション"];
    const rows = orphans.map((p) => {
      const rec = getRecommendedLinkFrom(p.url, allPaths);
      return [
        p.url,
        (p.title || "").replace(/"/g, '""'),
        String(p.depth ?? 0),
        String((p.page_rank ?? 0).toFixed(4)),
        rec,
      ];
    });
    const csvContent =
      "\uFEFF" +
      headers.join(",") +
      "\n" +
      rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orphan-pages-${scanId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    const highEl = document.getElementById("tab-high");
    const orphanEl = document.getElementById("tab-orphan");
    if (highEl) highEl.style.display = tab === "high" ? "" : "none";
    if (orphanEl) orphanEl.style.display = tab === "orphan" ? "" : "none";
  }

  let currentPages = [];

  window.addEventListener("DOMContentLoaded", () => {
    void loadScanData();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn[data-tab]");
    if (btn) switchTab(btn.dataset.tab);
  });

  document.getElementById("js-export-orphan-csv")?.addEventListener("click", () => {
    exportOrphanCSV(currentPages);
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
      const scan = data.scan || {};

      currentPages = pages;

      if (pages.length === 0) {
        showError("ページデータがありません。");
        return;
      }

      const domainData = buildDomainData(pages, scan);
      const totalScore = calcTotalScore(domainData);
      const aiComment = generateAIComment(domainData, totalScore);
      const issues = generateIssues(domainData);

      const displayUrlEl = document.getElementById("displayUrl");
      if (displayUrlEl) displayUrlEl.textContent = scan.target_url || scan.domain || "—";

      renderHero(document.getElementById("js-domain-hero"), domainData, totalScore, aiComment);
      renderScoreBreakdown(document.getElementById("js-score-breakdown"), domainData);
      renderIssues(document.getElementById("js-issues"), issues);

      const orphanCount = domainData.orphanPageCount;
      const countEl = document.getElementById("js-orphan-count");
      if (countEl) countEl.textContent = String(orphanCount);

      renderHighAuthorityTable(document.getElementById("js-high-authority-body"), pages);
      renderOrphanTable(document.getElementById("js-orphan-body"), pages, pages);
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

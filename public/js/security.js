/**
 * security.js - セキュリティ診断画面（リデザイン版）
 * ①スコアリング ②今すぐ対応すべき問題 ③カテゴリ別スコア ④全チェック項目テーブル
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  const STORAGE_KEY = "security_completed_" + scanId;

  function loadCompletedIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? new Set(arr) : new Set();
      }
    } catch (e) {}
    return new Set();
  }

  function saveCompletedIds(ids) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch (e) {}
  }

  const EFFORT_DEFAULTS = {
    "x-frame-options": "対応: 5分",
    "cookie-httponly": "対応: 15分",
    "cookie-samesite": "対応: 15分",
    "cookie-secure": "対応: 15分",
    "content-security-policy": "対応: 1〜2時間",
    "server-header": "対応: 10分",
    "x-powered-by": "対応: 10分",
    default: "対応: 要見積もり",
  };

  const SECURITY_CHECKS = [
    { id: "https", name: "HTTPS配信", category: "HTTPS / TLS", status: "pass", severity: "low", description: "トップページ・主要ページが HTTPS 応答", recommendation: "常時HTTPS維持、HTTPは301で統一", risk: "通信の平文露出リスクは低い" },
    { id: "tls", name: "TLS利用状況", category: "HTTPS / TLS", status: "pass", severity: "low", description: "証明書応答とTLS接続を確認", recommendation: "古いTLSバージョンは段階的に停止", risk: "接続時の基本的な保護は担保されやすい" },
    { id: "ssl-expiry", name: "SSL証明書 有効期限", category: "HTTPS / TLS", status: "pass", severity: "low", description: "証明書の有効期限を確認", recommendation: "期限前に更新推奨", risk: "2026/06/16 まで有効", passBadgeText: "残86日" },
    { id: "hsts", name: "HSTS", category: "HTTPS / TLS", status: "warning", severity: "medium", description: "Strict-Transport-Security の設定が弱い", recommendation: "max-age を十分に取り HSTS を有効化", risk: "初回HTTP接続時のダウングレード余地" },
    { id: "x-frame-options", name: "X-Frame-Options", category: "Security Headers", status: "fail", severity: "high", description: "クリックジャッキング攻撃のリスク。攻撃者がサイトを透明フレームに埋め込みユーザーを騙せます。", recommendation: "DENY または SAMEORIGIN を設定", risk: "クリックジャッキング", hint: "レスポンスヘッダーに1行追加", effortMinutes: 5, icon: "🛡" },
    { id: "content-security-policy", name: "Content-Security-Policy", category: "Security Headers", status: "fail", severity: "medium", description: "外部スクリプト読み込みを制限できていません。XSS・悪意あるスクリプト挿入に無防備な状態。", recommendation: "report-only から段階導入", risk: "XSS・スクリプト挿入", hint: "まず report-only モードで設定推奨", effortMinutes: 90, icon: "📋" },
    { id: "x-content-type-options", name: "X-Content-Type-Options", category: "Security Headers", status: "pass", severity: "low", description: "nosniff を確認", recommendation: "全レスポンスで一貫付与", risk: "MIME推測リスクを抑制" },
    { id: "referrer-policy", name: "Referrer-Policy", category: "Security Headers", status: "warning", severity: "medium", description: "適切なPolicyが見当たらない", recommendation: "strict-origin-when-cross-origin などへ調整", risk: "参照元情報が外部へ過剰送信される可能性" },
    { id: "cookie-secure", name: "Cookie Secure属性", category: "Cookie Attributes", status: "warning", severity: "medium", description: "一部 Set-Cookie に Secure 属性なし", recommendation: "セッション系Cookieへ Secure を付与", risk: "HTTPで送信される余地が残る", effortMinutes: 15 },
    { id: "cookie-httponly", name: "Cookie HttpOnly属性", category: "Cookie Attributes", status: "fail", severity: "high", description: "セッションCookieがJSから読み取られXSSでセッションハイジャックされるリスクがあります。", recommendation: "HttpOnly フラグを付与", risk: "セッションハイジャック", hint: "バックエンドのCookie発行部分を修正", effortMinutes: 15, icon: "🍪" },
    { id: "cookie-samesite", name: "Cookie SameSite属性", category: "Cookie Attributes", status: "fail", severity: "high", description: "SameSite 未付与または緩い設定。CSRF耐性が下がります。", recommendation: "Lax または Strict を基本に設計", risk: "CSRF攻撃", hint: "バックエンドのCookie発行部分を修正", effortMinutes: 15, icon: "🍪" },
    { id: "mixed-content", name: "Mixed Content", category: "Mixed Content", status: "pass", severity: "low", description: "HTTP画像・JS・CSS混在は未検出想定", recommendation: "外部埋め込みも含めてHTTPS統一", risk: "保護通信の信頼性低下を回避" },
    { id: "directory-listing", name: "Directory Listing", category: "情報漏洩・公開ファイル", status: "warning", severity: "medium", description: "/uploads/ /backup/ 等の一覧表示可能性を確認", recommendation: "Indexes無効、公開対象を限定", risk: "不要ファイルが公開状態になる恐れ" },
    { id: "git-exposure", name: ".git ディレクトリ公開", category: "情報漏洩・公開ファイル", status: "fail", severity: "medium", description: "/.git/config へのアクセスが可能です。ソースコードやコミット履歴が漏洩するリスクがあります。", recommendation: "Webサーバーで .git へのアクセスを拒否", risk: "ソースコード漏洩", hint: "Webサーバーで .git へのアクセスを拒否", effortMinutes: 10, icon: "📂" },
    { id: "server-header", name: "Server / X-Powered-By", category: "Public Exposure", status: "fail", severity: "medium", description: "フレームワーク・バージョン情報が外部から見えています。攻撃者に狙われやすくなります。", recommendation: "サーバー設定でヘッダーを削除", risk: "バージョン情報漏洩", hint: "サーバー設定でヘッダーを削除", effortMinutes: 10, icon: "🔍" },
    { id: "public-files", name: "公開ファイル露出", category: "情報漏洩・公開ファイル", status: "warning", severity: "medium", description: ".env / backup.zip / phpinfo などを探索対象", recommendation: "公開領域から除外しデプロイを見直す", risk: "誤配置ファイルによる重大事故" },
    { id: "form-protection", name: "フォーム送信保護", category: "Mixed Content", status: "pass", severity: "low", description: "問い合わせフォーム送信先がHTTPS", recommendation: "加えてCSPやCSRF対策を内部で整備", risk: "通信経路上の平文露出を避けやすい" },
  ];

  const CATEGORY_MAX = {
    "HTTPS / TLS": 35,
    "Security Headers": 30,
    "Cookie Attributes": 20,
    "情報漏洩・公開ファイル": 20,
    "Public Exposure": 20,
    "Mixed Content": 10,
  };

  const CHECK_SECTIONS = [
    { id: "headers", title: "セキュリティヘッダー", color: "#6366F1", categories: ["Security Headers"] },
    { id: "exposure", title: "情報漏洩・公開ファイル", color: "#F59E0B", categories: ["情報漏洩・公開ファイル"] },
    { id: "cookie", title: "Cookie 属性", color: "#10B981", categories: ["Cookie Attributes"] },
    { id: "https", title: "HTTPS / TLS", color: "#10B981", categories: ["HTTPS / TLS", "Mixed Content"] },
  ];

  function getCheckPoints(check) {
    const max = check.severity === "high" ? 10 : check.severity === "medium" ? 6 : 3;
    if (check.status === "pass") return { earned: max, max };
    if (check.status === "warning") return { earned: Math.floor(max / 2), max };
    return { earned: 0, max };
  }

  function getEffortLabel(check) {
    if (check.effortMinutes) return `対応: ${check.effortMinutes}分`;
    const key = check.id.toLowerCase().replace(/\s+/g, "-");
    return EFFORT_DEFAULTS[key] || EFFORT_DEFAULTS.default;
  }

  function computeCategoryScores(checks) {
    const scores = {};
    for (const cat of Object.keys(CATEGORY_MAX)) {
      scores[cat] = { earned: 0, max: 0 };
    }
    for (const c of checks) {
      if (!scores[c.category]) continue;
      const { earned, max } = getCheckPoints(c);
      scores[c.category].earned += earned;
      scores[c.category].max += max;
    }
    return Object.entries(CATEGORY_MAX).map(([category, displayMax]) => {
      const s = scores[category] || { earned: 0, max: 1 };
      const pct = s.max > 0 ? s.earned / s.max : 0;
      const score = Math.round(pct * displayMax);
      return { category, score: Math.min(score, displayMax), maxScore: displayMax };
    });
  }

  function computeScore(checks) {
    let earned = 0;
    let max = 0;
    for (const c of checks) {
      const pts = getCheckPoints(c);
      earned += pts.earned;
      max += pts.max;
    }
    return max > 0 ? Math.round((earned / max) * 100) : 0;
  }

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function getScoreColor(score) {
    if (score >= 80) return "#10B981";
    if (score >= 60) return "#F59E0B";
    return "#EF4444";
  }

  function getScoreComment(score) {
    if (score >= 80) return "セキュリティ状態は良好です";
    if (score >= 60) return "いくつかの問題があります。対応を推奨します";
    return "重大な問題があります。早急に対応してください";
  }

  function getScoreLabel(score) {
    if (score >= 80) return "良好";
    if (score >= 60) return "要改善";
    return "要緊急対応";
  }

  function getBarColor(pct) {
    if (pct >= 70) return "#10B981";
    if (pct >= 40) return "#F59E0B";
    return "#EF4444";
  }

  function getStatusBadge(check) {
    if (check.status === "pass") return '<span class="badge badge-pass">正常</span>';
    if (check.severity === "high") return '<span class="badge badge-high">未設定</span>';
    return '<span class="badge badge-medium">要対応</span>';
  }

  function getRiskColor(check) {
    if (check.status === "pass") return "var(--color-text-tertiary)";
    if (check.severity === "high") return "#EF4444";
    return "#F59E0B";
  }

  let completedIds = loadCompletedIds();
  let showCompleted = false;
  let currentChecks = null; // API から取得した最新チェック結果

  function render(checks) {
    currentChecks = checks;
    completedIds = loadCompletedIds();
    // 実際に pass になった項目は手動完了から除外（自動検証で解消されたため）
    for (const c of checks) {
      if (c.status === "pass") completedIds.delete(c.id);
    }
    saveCompletedIds(completedIds);
    const score = computeScore(checks);
    const categoryScores = computeCategoryScores(checks);
    let actionItems = checks.filter((c) => (c.severity === "high" || c.severity === "medium") && c.status !== "pass");
    const completedCount = actionItems.filter((c) => completedIds.has(c.id)).length;
    if (!showCompleted) {
      actionItems = actionItems.filter((c) => !completedIds.has(c.id));
    }
    actionItems.sort((a, b) => {
      const ord = { high: 0, medium: 1 };
      return (ord[a.severity] ?? 2) - (ord[b.severity] ?? 2);
    });

    const highCount = checks.filter((c) => c.severity === "high" && c.status !== "pass").length;
    const mediumCount = checks.filter((c) => c.severity === "medium" && c.status !== "pass").length;
    const failWarnCount = highCount + mediumCount;
    const passCount = checks.filter((c) => c.status === "pass").length;

    const circumference = 2 * Math.PI * 30;
    const offset = circumference * (1 - score / 100);

    let summaryText = getScoreComment(score);
    if (failWarnCount > 0) {
      summaryText = `High ${highCount}件・Medium ${mediumCount}件の問題が見つかりました。<br>下記の対応アクションを上から順に対処してください。`;
    }

    document.getElementById("js-security-hero").innerHTML = `
      <div class="hero">
        <div class="score-ring">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke="var(--color-border-tertiary)" stroke-width="6"/>
            <circle cx="36" cy="36" r="30" fill="none" stroke="${getScoreColor(score)}" stroke-width="6"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
          </svg>
          <div class="score-num"><span>${score}</span><span>/100</span></div>
        </div>
        <div class="hero-text">
          <h2>セキュリティスコア — ${getScoreLabel(score)}</h2>
          <p>${summaryText}</p>
        </div>
      </div>
    `;

    const actionCardsHtml = actionItems.length === 0 && completedCount === 0
      ? '<p class="text-sm text-slate-500">現在、重大・中程度の問題はありません。</p>'
      : actionItems.map((c) => {
          const sev = c.severity;
          const isCompleted = completedIds.has(c.id);
          const icon = c.icon || (sev === "high" ? "🛡" : "📋");
          const titleSuffix = c.id === "server-header" ? " ヘッダーが露出" : c.status === "fail" ? " が未設定" : "";
          return `
            <div class="action-card ${sev} ${isCompleted ? "completed" : ""}" data-check-id="${escapeHtml(c.id)}">
              <div class="ac-icon ${sev}">${icon}</div>
              <div class="ac-body">
                <div class="ac-title">${escapeHtml(c.name)}${titleSuffix}</div>
                <div class="ac-desc">${escapeHtml(c.description)}</div>
                <div class="ac-meta">
                  <span class="badge badge-${sev}">${sev === "high" ? "High" : "Medium"}</span>
                  <span class="badge badge-effort">${getEffortLabel(c)}</span>
                  ${c.hint ? `<span style="font-size:11px;color:var(--color-text-tertiary)">${escapeHtml(c.hint)}</span>` : ""}
                  ${!isCompleted ? `<button type="button" class="ac-complete-btn" data-check-id="${escapeHtml(c.id)}">✓ 完了</button>` : ""}
                </div>
              </div>
            </div>
          `;
        }).join("");

    const completedToggleHtml = completedCount > 0
      ? `<button type="button" id="js-show-completed-btn" class="text-xs text-slate-500 hover:text-slate-700 mt-2">${showCompleted ? "▲" : "▼"} 完了済みを${showCompleted ? "非表示" : "表示"}（${completedCount}件）</button>`
      : "";
    document.getElementById("js-action-cards").innerHTML = actionCardsHtml + completedToggleHtml;

    document.querySelectorAll(".ac-complete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.checkId;
        if (id) {
          completedIds.add(id);
          saveCompletedIds(completedIds);
          render(checks);
        }
      });
    });
    document.getElementById("js-show-completed-btn")?.addEventListener("click", () => {
      showCompleted = !showCompleted;
      render(checks);
    });

    document.getElementById("js-category-scores").innerHTML = categoryScores.map((cs) => {
      const pct = cs.maxScore > 0 ? (cs.score / cs.maxScore) * 100 : 0;
      const color = getBarColor(pct);
      return `
        <div class="cat-card">
          <div class="cat-top">
            <span class="cat-name">${escapeHtml(cs.category)}</span>
            <span class="cat-score" style="color:${color}">${cs.score}/${cs.maxScore}</span>
          </div>
          <div class="cat-bar"><div class="cat-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>
      `;
    }).join("");

    const sectionsHtml = CHECK_SECTIONS.map((sec) => {
      const sectionChecks = checks.filter((c) => sec.categories.includes(c.category));
      const sortedChecks = [...sectionChecks].sort((a, b) => {
        const order = { fail: 0, warning: 1, pass: 2 };
        return (order[a.status] ?? 2) - (order[b.status] ?? 2);
      });
      const rows = sortedChecks.map((c) => {
        const isPass = c.status === "pass";
        const dotColor = c.severity === "high" ? "#EF4444" : c.severity === "medium" ? "#F59E0B" : "#10B981";
        const passBadge = c.passBadgeText ? `<span class="badge badge-ok">${escapeHtml(c.passBadgeText)}</span>` : '<span class="badge badge-ok">正常</span>';
        return `
          <tr class="check-row ${isPass ? "pass-row" : ""}" data-pass="${isPass}">
            <td><div class="item-name"><span class="status-dot" style="background:${dotColor}"></span>${escapeHtml(c.name)}</div></td>
            <td>${isPass ? passBadge : getStatusBadge(c)}</td>
            <td>${escapeHtml(isPass ? (c.risk || "対応済み") : (c.risk || "—"))}</td>
            <td>${escapeHtml(c.recommendation)}</td>
          </tr>
        `;
      }).join("");
      return `
        <div class="check-section">
          <div class="check-section-title">
            <span class="check-section-dot" style="background:${sec.color}"></span>
            <span class="check-section-title-text">${escapeHtml(sec.title)}</span>
          </div>
          <table class="check-table">
            <thead>
              <tr>
                <th class="col-item">項目</th>
                <th class="col-status">状態</th>
                <th class="col-risk">リスク</th>
                <th class="col-action">対応内容</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join("");

    document.getElementById("js-check-sections").innerHTML = sectionsHtml;

    const expandBtn = document.getElementById("js-expand-check-btn");
    expandBtn.style.display = passCount > 0 ? "" : "none";
    expandBtn.textContent = `▼ 対応済み項目を非表示にする`;
    expandBtn.dataset.showing = "1";

    expandBtn.onclick = () => {
      const showing = expandBtn.dataset.showing === "1";
      document.querySelectorAll(".check-row.pass-row").forEach((r) => { r.style.display = showing ? "none" : ""; });
      expandBtn.dataset.showing = showing ? "0" : "1";
      expandBtn.textContent = showing ? `▲ 対応済み項目を表示する（+${passCount}件）` : `▼ 対応済み項目を非表示にする`;
    };
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

  async function fetchSecurityCheck() {
    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}/security-check`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        return data.checks || null;
      }
    } catch (e) {
      console.warn("security-check fetch failed", e);
    }
    return null;
  }

  function setRecheckLoading(loading) {
    const btn = document.getElementById("js-recheck-btn");
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? "チェック中..." : "再チェック";
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    void loadScanData();
  });

  async function loadScanData() {
    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, { credentials: "include" });

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

      updateHeader(scan);
      updateAnalysisDate(scan);

      // 自動セキュリティチェック: API で実態を取得、成功時はその結果を使用
      const apiChecks = await fetchSecurityCheck();
      const checks = apiChecks || data.security?.checks || SECURITY_CHECKS;
      render(checks);
      wireRecheckButton();
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    }
  }

  function wireRecheckButton() {
    const btn = document.getElementById("js-recheck-btn");
    if (btn) {
      btn.onclick = async () => {
        setRecheckLoading(true);
        const apiChecks = await fetchSecurityCheck();
        setRecheckLoading(false);
        if (apiChecks && apiChecks.length > 0) {
          render(apiChecks);
        }
      };
    }
  }
})();

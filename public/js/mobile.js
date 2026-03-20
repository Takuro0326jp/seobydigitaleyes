/**
 * mobile.js - モバイルフレンドリー診断画面
 * /api/scans/result/:id からスキャンデータを取得し、モバイル診断UIを表示
 */
(function () {
  "use strict";

  let allMobileData = []; // 全保持データ（APIから取得したpagesを変換）

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  /* ==========================================
   * 1. 初期化処理
   * ========================================== */
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
      const scan = data.scan || {};

      // pages をモバイル用に変換（viewportScore等がない場合は score または 80 で補完）
      allMobileData = pages.map((p) => ({
        url: p.url,
        title: p.title || "Untitled",
        depth: p.depth ?? 1,
        score: p.score ?? 80,
        viewportScore: p.viewportScore ?? p.score ?? 80,
        fontSizeScore: p.fontSizeScore ?? p.score ?? 80,
        imageScore: p.imageScore ?? p.score ?? 80,
        tapTargetScore: p.tapTargetScore ?? p.score ?? 80,
        scoreNote: p.scoreNote || "",
        deductions: p.deductions || [],
        deduction_total: p.deduction_total ?? 0,
      }));

      if (allMobileData.length === 0) {
        showError("ページデータがありません。");
        return;
      }

      const rootUrl = scan.target_url || allMobileData[0]?.url || "";
      updateSiteMetaHeader(rootUrl);
      renderTable(allMobileData);

      const lastIdx = parseInt(sessionStorage.getItem("mobile_last_idx") || "0", 10);
      const initialTarget = allMobileData[lastIdx] || allMobileData[0];
      if (initialTarget) {
        window.showUrlDetail(initialTarget, lastIdx >= allMobileData.length ? 0 : lastIdx);
      }
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

  function updateSiteMetaHeader(rootUrl) {
    if (!rootUrl) return;
    try {
      const domain = new URL(rootUrl).hostname;
      const domainEl = document.getElementById("displayDomain");
      const urlEl = document.getElementById("displayUrl");
      if (domainEl) domainEl.textContent = domain;
      if (urlEl) urlEl.textContent = `Root: ${rootUrl}`;
    } catch (e) {}
  }

  /* ==========================================
   * 2. テーブル描画 (UI Rendering)
   * ========================================== */
  function renderTable(pages) {
    const body = document.getElementById("urlTableBody");
    if (!body) return;

    if (!pages || pages.length === 0) {
      body.innerHTML =
        '<tr><td colspan="4" class="px-6 py-10 text-center text-slate-400">表示できるデータがありません。</td></tr>';
      return;
    }

    body.innerHTML = pages
      .map((page, index) => {
        const scoreColor = getScoreColorClass(page.score || 0);

        return `
            <tr class="hover:bg-slate-50 cursor-pointer transition-all border-l-4 border-transparent" id="row-${index}"
                onclick="window.showUrlDetailByIndex(${index})">
                <td class="px-3 py-3 font-mono text-slate-400 text-center" data-label="Depth">${page.depth || 1}</td>
                <td class="px-3 py-3 min-w-0 overflow-hidden" data-label="URL & Title">
                    <p class="font-bold text-slate-900 truncate">${escapeHtml(page.title || "Untitled")}</p>
                    <p class="text-[10px] text-blue-500 font-mono truncate">${escapeHtml(page.url)}</p>
                </td>
                <td class="px-3 py-3 text-center" data-label="Score">
                    <span class="font-black text-[13px] ${scoreColor}">${page.score || 0}</span>
                </td>
                <td class="px-3 py-3 text-center" data-label="Detail">
                    <button onclick="window.handleModalClick(event, ${index})"
                            class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all relative z-50">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
      })
      .join("");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ==========================================
   * 3. 詳細表示・同期 (Data Sync)
   * ========================================== */
  window.showUrlDetail = function (page, index) {
    document.querySelectorAll("#urlTableBody tr").forEach((tr) => {
      tr.classList.remove("bg-blue-50/50", "border-blue-500");
    });
    const activeRow = document.getElementById(`row-${index}`);
    if (activeRow) activeRow.classList.add("bg-blue-50/50", "border-blue-500");

    sessionStorage.setItem("mobile_last_idx", String(index));

    const preview = document.getElementById("previewFrame");
    if (preview && page?.url) {
      preview.src = `/api/proxy?url=${encodeURIComponent(page.url)}`;
    }

    updateMetricCards(page);
    window.updateAiMobileReview(page);
  };

  window.showUrlDetailByIndex = function (index) {
    window.showUrlDetail(allMobileData[index], index);
  };

  function updateMetricCards(page) {
    const metrics = [
      {
        id: "v",
        score: page.viewportScore ?? 0,
        note: (page.viewportScore ?? 0) >= 80 ? "最適化済み" : "要改善",
      },
      {
        id: "f",
        score: page.fontSizeScore ?? 0,
        note: (page.fontSizeScore ?? 0) >= 80 ? "可読性良好" : "一部小さい文字あり",
      },
      {
        id: "i",
        score: page.imageScore ?? 0,
        note: (page.imageScore ?? 0) >= 80 ? "最適化済み" : "圧縮の余地あり",
      },
      {
        id: "l",
        score: page.tapTargetScore ?? 0,
        note: (page.tapTargetScore ?? 0) >= 80 ? "適切な間隔" : "誤操作リスクあり",
      },
    ];

    metrics.forEach((m) => {
      const scoreEl = document.getElementById(`${m.id}-score`);
      const noteEl = document.getElementById(`${m.id}-note`);
      if (scoreEl) {
        scoreEl.textContent = m.score;
        scoreEl.className = `text-3xl font-black ${getScoreColorClass(m.score)}`;
      }
      if (noteEl) noteEl.textContent = m.note;
    });
  }

  window.updateAiMobileReview = function (page) {
    const reviewEl = document.getElementById("aiMobileReview");
    if (!reviewEl) return;

    let reviewText = "";
    const v = page.viewportScore ?? 0;
    const f = page.fontSizeScore ?? 0;
    const i = page.imageScore ?? 0;
    const l = page.tapTargetScore ?? 0;
    const avg = (v + f + i + l) / 4;

    if (avg >= 90)
      reviewText =
        "完璧なモバイル対応です。ユーザーは迷うことなく操作でき、Googleからも高い評価を得られる構造です。";
    else if (v < 70)
      reviewText =
        "【最優先】Viewport設定に致命的な課題があります。metaタグとメディアクエリを確認してください。";
    else if (l < 75)
      reviewText =
        "【UI】タップターゲットが近すぎます。ボタンの間隔を「48px以上」確保してください。";
    else if (f < 80)
      reviewText =
        "【可読性】一部のフォントが小さすぎます。主要テキストは16px以上に設定してください。";
    else if (i < 80)
      reviewText =
        "【速度】画像の最適化に余地があります。次世代形式(WebP)への変換を推奨します。";
    else
      reviewText =
        "全体的に良好ですが、さらなるUX向上のために80点未満の項目を微調整してください。";

    reviewEl.innerText = `「${reviewText}」`;
  };

  /* ==========================================
   * 4. UI制御 (Modal)
   * ========================================== */
  window.handleModalClick = function (e, index) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    window.openNoteModal(index);
  };

  window.openNoteModal = function (index) {
    const modal = document.getElementById("noteModal");
    const content = document.getElementById("modalNoteContent");

    if (!modal || !content) return;

    const page = allMobileData[index];
    if (!page) {
      content.innerHTML = '<p class="text-slate-500">詳細な解析データはありません。</p>';
    } else {
      content.innerHTML = buildModalContent(page);
    }

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };

  function getDeductionPt(d) {
    const val = Number(d.value ?? d.point ?? 0);
    if (val !== 0) return Math.abs(Math.round(val));
    return 0;
  }

  function buildModalContent(page) {
    const score = page.score ?? 0;
    const v = page.viewportScore ?? 100;
    const f = page.fontSizeScore ?? 100;
    const i = page.imageScore ?? 100;
    const l = page.tapTargetScore ?? 100;

    const mobileIssues = [
      { name: "表示領域 (Viewport)", score: v, desc: "設定が不完全、またはコンテンツが画面幅をはみ出しています。" },
      { name: "文字サイズ (Font Size)", score: f, desc: "12px以下の文字があり、スマホでの可読性が低下しています。" },
      { name: "画像最適化 (Image Opt)", score: i, desc: "サイズが未圧縮、または遅延読み込みが未設定です。" },
      { name: "操作性 (Tap Targets)", score: l, desc: "リンクの間隔が狭く、誤操作を招く恐れがあります。" },
    ]
      .filter((x) => x.score < 100)
      .sort((a, b) => a.score - b.score);

    const deductions = Array.isArray(page.deductions) ? page.deductions : [];
    const validDeductions = deductions.filter((d) => getDeductionPt(d) > 0);
    const deductionTotal = page.deduction_total ?? validDeductions.reduce((sum, d) => sum + getDeductionPt(d), 0);

    if (score >= 100 && validDeductions.length === 0) {
      return `
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <span class="text-4xl mb-3">✨</span>
          <p class="text-lg font-bold text-emerald-600">完璧なモバイル対応です！</p>
        </div>
      `;
    }

    let html = `
      <div class="space-y-5">
        <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
          <p class="text-[10px] text-slate-500 mb-1">スコアは 100 − 合計減点 で算出</p>
          <div class="flex items-baseline gap-2">
            <span class="text-2xl font-black text-slate-900">${score}</span>
            <span class="text-slate-500 text-sm">点 / 100点</span>
            ${deductionTotal > 0 ? `<span class="text-red-600 font-bold text-sm ml-auto">合計 ${deductionTotal}pt減点</span>` : ""}
          </div>
        </div>
    `;

    if (validDeductions.length > 0) {
      html += `
        <div class="border border-slate-100 rounded-xl overflow-hidden">
          <h4 class="px-4 py-2 bg-slate-50 text-[10px] font-black text-slate-600 uppercase tracking-wider border-b border-slate-100">減点一覧</h4>
          <ul class="divide-y divide-slate-50">
      `;
      validDeductions.forEach((d) => {
        const pt = getDeductionPt(d);
        const label = d.label || "不明";
        const reason = d.reason ? ` <span class="text-slate-400 font-normal">(${escapeHtml(d.reason)})</span>` : "";
        html += `
          <li class="flex justify-between items-start gap-3 px-4 py-3">
            <span class="text-slate-700 font-bold text-sm min-w-0">${escapeHtml(label)}${reason}</span>
            <span class="text-red-600 font-bold text-sm shrink-0">${pt}pt減点</span>
          </li>
        `;
      });
      html += `
          </ul>
        </div>
      `;
    }

    if (mobileIssues.length > 0) {
      html += '<h4 class="text-[10px] font-black text-slate-600 uppercase tracking-wider">モバイル改善推奨</h4>';
      html += '<ul class="space-y-3">';
      mobileIssues.forEach((item) => {
        const pt = Math.round(100 - item.score);
        const level = item.score < 50 ? "致命的" : item.score < 90 ? "改善推奨" : "微細な課題";
        const levelClass = item.score < 50 ? "bg-red-50 text-red-700 border-red-100" : item.score < 90 ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-slate-50 text-slate-600 border-slate-100";
        html += `
          <li class="flex gap-3 p-4 rounded-xl border ${levelClass}">
            <span class="shrink-0 text-lg">${item.score < 50 ? "⚠️" : item.score < 90 ? "💡" : "🔍"}</span>
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-center gap-2">
                <p class="font-bold text-slate-900 text-sm">${escapeHtml(item.name)}</p>
                <span class="text-red-600 font-bold text-xs shrink-0">${pt}pt減点</span>
              </div>
              <p class="text-xs text-slate-600 mt-1 leading-relaxed">${escapeHtml(item.desc)}</p>
              <p class="text-[10px] font-bold text-slate-500 mt-2">${item.score}点（100点満点）</p>
            </div>
          </li>
        `;
      });
      html += "</ul>";
    } else if (validDeductions.length === 0) {
      html += '<p class="text-slate-600 text-sm">全体的なレイアウト構成に微調整の余地があります。</p>';
    }

    html += "</div>";
    return html;
  }

  window.closeNoteModal = function () {
    const modal = document.getElementById("noteModal");
    if (modal) {
      modal.classList.add("hidden");
      document.body.style.overflow = "";
    }
  };

  /* ==========================================
   * 5. Excel Export
   * ========================================== */
  window.downloadMobileCSV = function () {
    if (!allMobileData.length) return alert("データがありません。");
    try {
      const wb = XLSX.utils.book_new();

      let maxDepthFound = 1;
      allMobileData.forEach((p) => {
        try {
          const segments = new URL(p.url).pathname.split("/").filter((s) => s);
          if (segments.length + 1 > maxDepthFound) maxDepthFound = segments.length + 1;
        } catch (e) {}
      });

      const hierarchyHeaders = Array.from(
        { length: maxDepthFound },
        (_, i) => `第${i + 1}階層`
      );
      const headerNames = [
        ...hierarchyHeaders,
        "URL",
        "総合スコア",
        "Viewport",
        "Font Size",
        "Image Opt",
        "Tap Targets",
        "優先度",
        "技術備考",
        "AI改善アドバイス",
      ];

      const rows = allMobileData.map((p) => {
        const hierarchyCells = new Array(maxDepthFound).fill("");
        try {
          const segments = new URL(p.url).pathname.split("/").filter((s) => s);
          if (segments.length === 0) hierarchyCells[0] = "top";
          else
            hierarchyCells[Math.min(segments.length, maxDepthFound - 1)] =
              segments[segments.length - 1];
        } catch (e) {
          hierarchyCells[0] = "top";
        }

        const priority = p.score < 60 ? "HIGH" : p.score < 85 ? "MID" : "LOW";
        return [
          ...hierarchyCells,
          p.url,
          p.score || 0,
          p.viewportScore || 0,
          p.fontSizeScore || 0,
          p.imageScore || 0,
          p.tapTargetScore || 0,
          priority,
          p.scoreNote || "",
          "AIアドバイス自動生成済み",
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headerNames, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "モバイル診断レポート");
      const hostname = (() => {
        try {
          return new URL(allMobileData[0].url).hostname;
        } catch {
          return "export";
        }
      })();
      XLSX.writeFile(wb, `Mobile_Audit_${hostname}.xlsx`);
    } catch (err) {
      console.error("Excel Export Error:", err);
      alert("Excel出力中にエラーが発生しました。");
    }
  };

  function getScoreColorClass(score) {
    if (score >= 80) return "text-emerald-600";
    if (score >= 50) return "text-orange-500";
    return "text-red-600";
  }
})();

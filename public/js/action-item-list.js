/**
 * 今週やるべきこと - アクションリスト（vanilla JS）
 * GSC 全タブ上部に配置する共通コンポーネント
 */
(function () {
  "use strict";

  const BORDER_COLOR = { high: "#EF4444", medium: "#F59E0B", low: "#6366F1" };
  const BADGE_STYLE = {
    high: { background: "#FEF2F2", color: "#991B1B" },
    medium: { background: "#FEF3C7", color: "#92400E" },
    low: { background: "#EEF2FF", color: "#3730A3" },
  };

  function priorityLabel(p) {
    return p === "high" ? "High" : p === "medium" ? "Medium" : "Low";
  }

  function formatDate(str) {
    if (!str) return "";
    try {
      return new Date(str).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
    } catch {
      return str;
    }
  }

  function decodeUriForDisplay(str) {
    if (!str || typeof str !== "string") return str || "";
    try {
      return decodeURIComponent(str);
    } catch {
      // Fallback: decode complete UTF-8 character sequences individually
      // Handles truncated/incomplete sequences (e.g. "チャーム%e3%83%b...")
      let result = str.replace(
        /(?:%[fF][0-7](?:%[89aAbB][0-9a-fA-F]){3})|(?:%[eE][0-9a-fA-F](?:%[89aAbB][0-9a-fA-F]){2})|(?:%[cCdD][0-9a-fA-F]%[89aAbB][0-9a-fA-F])|(?:%[0-7][0-9a-fA-F])/g,
        (seq) => { try { return decodeURIComponent(seq); } catch { return seq; } }
      );
      // Remove remaining partial percent sequences before trailing "..."
      result = result.replace(/(?:%[0-9a-fA-F]{0,2})+(?=\.\.\.$)/, "");
      return result;
    }
  }

  function getCategoryFromActionType(actionType) {
    if (!actionType) return "その他";
    const t = String(actionType);
    if (t.startsWith("fix_404_")) return "404修正";
    if (t.startsWith("fix_noindex_")) return "noindex修正";
    if (t === "fix_orphan_pages") return "孤立ページ";
    if (t.startsWith("fix_dup_title_") || t.startsWith("fix_url_param_dup_") || t.startsWith("fix_canonical_diff_")) return "重複ページ";
    if (t.startsWith("improve_ctr_")) return "CTR改善";
    if (t.startsWith("boost_near_top_")) return "順位強化";
    return "その他";
  }

  function getSourceTabUrl(sourceTab, scanId) {
    if (!sourceTab || !scanId) return null;
    const suffix = "?scan=" + encodeURIComponent(scanId);
    const map = {
      TASK: "gsc-task.html",
      SEO: "result.html",
      "INDEX HEALTH": "gsc-indexhealth.html",
      "PERFORMANCE": "gsc.html",
      "OPPORTUNITIES": "gsc-opportunities.html",
      TECHNICAL: "gsc-technical.html",
      "LINK STRUCTURE": "link-structure.html",
    };
    const path = map[sourceTab] || map[sourceTab?.toUpperCase()];
    return path ? path + suffix : null;
  }

  /**
   * アクションリストを container に描画
   * @param {HTMLElement} container
   * @param {string} scanId
   */
  window.renderActionItemList = function (container, scanId) {
    if (!container || !scanId) return;

    let isRegenerating = false;
    let items = [];

    if (!container.dataset.regenerateBound) {
      container.dataset.regenerateBound = "1";
      container.addEventListener("click", function (e) {
        if (!e.target.closest("[data-action=regenerate]")) return;
        e.preventDefault();
        e.stopPropagation();
        const currentScanId = new URLSearchParams(window.location.search).get("scan") || new URLSearchParams(window.location.search).get("scanId");
        if (!currentScanId) {
          alert("scan パラメータが見つかりません。");
          return;
        }
        if (isRegenerating) return;
        isRegenerating = true;
        render();
        fetch(`/api/action-items/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ scanId: currentScanId }),
        })
          .then((r) => {
            if (!r.ok) throw new Error("再生成に失敗しました");
            return fetchItems();
          })
          .then(() => {
            isRegenerating = false;
            render();
          })
          .catch((err) => {
            isRegenerating = false;
            render();
            console.warn("regenerate failed:", err);
            alert("タスクの再生成に失敗しました。ページを再読み込みして再度お試しください。");
          });
      });
    }
    let verifying = [];
    let completed = [];
    let totalPending = 0;
    let totalVerifying = 0;
    let totalCompleted = 0;
    let showCompleted = false;
    let selectedCategory = "";
    let animatingOut = new Set();
    let isLoading = true;
    let isLoadingMore = false;
    let categoryItems = [];
    let categoryVerifying = [];
    let categoryTotalPending = 0;
    let categoryTotalVerifying = 0;
    let categoryFetchKey = "";
    let isLoadingCategory = false;

    // 自動確認の状態管理
    let autoCheckState = "idle"; // "idle" | "running" | "done"
    let autoCheckResults = {};   // { [itemId]: { resolved, reason, checkable } }
    let autoCheckTimer = null;

    function runAutoCheck() {
      if (autoCheckState === "running") return;
      if (verifying.length === 0) return;
      autoCheckState = "running";
      render();
      fetch("/api/action-items/check-verifying", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scanId }),
      })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error("api_error_" + r.status)))
        .then((data) => {
          autoCheckState = "done";
          autoCheckResults = {};
          (data.results || []).forEach((r) => { autoCheckResults[String(r.id)] = r; });
          // resolved されたものがあればリストを再取得
          const anyResolved = (data.results || []).some((r) => r.resolved);
          if (anyResolved) {
            fetchItems().then(() => render());
          } else {
            render();
          }
        })
        .catch((err) => {
          autoCheckState = String(err?.message || "").startsWith("api_error_") ? "error" : "done";
          render();
        });
    }

    const CATEGORY_API_MAP = {
      "重複ページ": "duplicate",
      "404修正": "404",
      "noindex修正": "noindex",
      "CTR改善": "ctr",
      "順位強化": "boost",
      "孤立ページ": "orphan",
    };

    function fetchItems(extraParams = {}) {
      const qs = new URLSearchParams({ scanId });
      Object.entries(extraParams).forEach(([k, v]) => v != null && qs.set(k, v));
      return Promise.all([
        fetch(`/api/action-items?${qs}`, { credentials: "include" }).then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return { ...d, _error: r.status };
          return d;
        }),
        fetch(`/api/action-items/completed?scanId=${encodeURIComponent(scanId)}`, {
          credentials: "include",
        }).then(async (r) => (r.ok ? (await r.json().catch(() => ({}))) || { items: [] } : { items: [] })),
      ])
        .then(([pendingData, completedData]) => {
          isLoading = false;
          if (pendingData && pendingData._error) {
            items = [];
            verifying = [];
            completed = [];
            totalPending = 0;
            totalVerifying = 0;
            totalCompleted = 0;
            window.__actionItemListError = pendingData._error === 401 ? "ログインが必要です" : pendingData.error || "取得に失敗しました";
            render();
            return;
          }
          items = pendingData.items || [];
          verifying = pendingData.verifying || [];
          completed = completedData.items || [];
          totalPending = parseInt(pendingData.totalPending, 10) || 0;
          totalVerifying = parseInt(pendingData.totalVerifying, 10) || 0;
          totalCompleted = parseInt(pendingData.totalCompleted, 10) || 0;
          categoryFetchKey = "";
          categoryItems = [];
          categoryVerifying = [];
          if (selectedCategory && CATEGORY_API_MAP[selectedCategory]) {
            categoryFetchKey = CATEGORY_API_MAP[selectedCategory];
            fetch(`/api/action-items?scanId=${encodeURIComponent(scanId)}&category=${encodeURIComponent(categoryFetchKey)}&limit=100`, {
              credentials: "include",
            })
              .then((r) => (r.ok ? r.json() : { items: [], verifying: [], totalPending: 0, totalVerifying: 0 }))
              .then((d) => {
                categoryItems = d.items || [];
                categoryVerifying = d.verifying || [];
                categoryTotalPending = parseInt(d.totalPending, 10) || 0;
                categoryTotalVerifying = parseInt(d.totalVerifying, 10) || 0;
                render();
              })
              .catch(() => {});
          }
          const oldAggregateTypes = ["fix_404_internal", "fix_noindex_error", "improve_ctr_title", "boost_near_top"];
          const hasOldFormat = [...items, ...verifying].some(
            (x) => x.action_type && oldAggregateTypes.includes(String(x.action_type))
          );
          if (
            (items.length === 0 && verifying.length === 0 && completed.length === 0 && totalPending === 0 && totalVerifying === 0 && totalCompleted === 0) ||
            hasOldFormat
          ) {
            render();
            fetch(`/api/action-items/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ scanId }),
            })
              .then(() => fetchItems())
              .catch(() => render());
            return;
          }
          render();
          // 確認中アイテムがあれば3秒後に自動チェックを起動（初回のみ）
          if (verifying.length > 0 && autoCheckState === "idle") {
            if (autoCheckTimer) clearTimeout(autoCheckTimer);
            autoCheckTimer = setTimeout(() => runAutoCheck(), 3000);
          }
        })
        .catch((err) => {
          isLoading = false;
          console.warn("action-items fetch failed:", err);
          items = [];
          verifying = [];
          completed = [];
          totalPending = 0;
          totalVerifying = 0;
          totalCompleted = 0;
          render();
        });
    }

    function handleVerify(id) {
      animatingOut.add(id);
      render();

      setTimeout(() => {
        fetch(`/api/action-items/${id}/verify`, {
          method: "PATCH",
          credentials: "include",
        })
          .then((r) => r.json())
          .then(() => {
            animatingOut.delete(id);
            fetchItems();
          })
          .catch((err) => {
            animatingOut.delete(id);
            render();
            console.warn("verify failed:", err);
          });
      }, 500);
    }

    function handleConfirmComplete(id) {
      animatingOut.add(id);
      render();

      setTimeout(() => {
        fetch(`/api/action-items/${id}/complete`, {
          method: "PATCH",
          credentials: "include",
        })
          .then((r) => r.json())
          .then(() => {
            animatingOut.delete(id);
            fetchItems();
          })
          .catch((err) => {
            animatingOut.delete(id);
            render();
            console.warn("complete failed:", err);
          });
      }, 500);
    }

    function handleUndo(id) {
      fetch(`/api/action-items/${id}/undo`, {
        method: "PATCH",
        credentials: "include",
      })
        .then(() => fetchItems())
        .catch((err) => console.warn("undo failed:", err));
    }

    function filterByCategory(arr) {
      if (!selectedCategory) return arr;
      return arr.filter((item) => getCategoryFromActionType(item.action_type) === selectedCategory);
    }

    function loadMoreItems() {
      if (isLoadingMore || items.length >= totalPending) return;
      isLoadingMore = true;
      render();
      fetch(
        `/api/action-items?scanId=${encodeURIComponent(scanId)}&offset=${items.length}&limit=20`,
        { credentials: "include" }
      )
        .then((r) => r.json())
        .then((data) => {
          const more = data.items || [];
          items = [...items, ...more];
          isLoadingMore = false;
          render();
        })
        .catch(() => {
          isLoadingMore = false;
          render();
        });
    }

    function escapeHtml(s) {
      if (s == null) return "";
      const div = document.createElement("div");
      div.textContent = String(s);
      return div.innerHTML;
    }

    function render() {
      const hasError = !!window.__actionItemListError;
      const errMsg = hasError ? window.__actionItemListError : "";
      if (hasError) delete window.__actionItemListError;
      if (isLoading) {
        container.innerHTML = `
          <div class="mb-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">今週やるべきこと</span>
            </div>
            <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div class="animate-pulse inline-block w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mb-2"></div>
              <div class="text-sm text-slate-500 dark:text-slate-400">取得中...</div>
            </div>
          </div>
        `;
        return;
      }
      const isEmpty = items.length === 0 && verifying.length === 0 && completed.length === 0 && !hasError;
      const allDone = items.length === 0 && verifying.length === 0 && completed.length > 0;
      const errorState = errMsg
        ? `
        <div class="p-5 text-center rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
          <div class="text-sm font-medium text-red-700 dark:text-red-400">${escapeHtml(errMsg)}</div>
          <div class="text-xs text-red-500 dark:text-red-500/80 mt-1">ページを再読み込みしてください</div>
        </div>
      `
        : "";
      const allCategories = ["404修正", "noindex修正", "重複ページ", "CTR改善", "順位強化", "孤立ページ", "その他"];
      const usedCategories = new Set();
      [...items, ...verifying, ...completed].forEach((x) => usedCategories.add(getCategoryFromActionType(x.action_type)));
      const alwaysShowCategories = ["404修正", "noindex修正", "重複ページ", "CTR改善", "順位強化", "孤立ページ"];
      const categoryOptions = [
        "",
        ...allCategories.filter((c) => usedCategories.has(c) || alwaysShowCategories.includes(c)),
      ];

      const categoryFilterHtml =
        categoryOptions.length > 1
          ? `
        <div class="flex flex-wrap gap-1.5 mb-3 overflow-x-auto py-1 -mx-1">
          ${categoryOptions
            .map(
              (cat) => `
            <button type="button" class="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-colors cursor-pointer border ${
              selectedCategory === cat
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            }" data-category="${escapeHtml(cat)}">
              ${cat || "すべて"}
            </button>
          `
            )
            .join("")}
        </div>
      `
          : "";

      const useCategoryApi = selectedCategory && CATEGORY_API_MAP[selectedCategory];
      let filteredItems = useCategoryApi ? categoryItems : filterByCategory(items);
      let filteredVerifying = useCategoryApi ? categoryVerifying : filterByCategory(verifying);
      // When using category API, always apply client-side filter as safety net
      // (server may not support all category filters yet)
      if (useCategoryApi && selectedCategory) {
        filteredItems = filteredItems.filter(
          (x) => getCategoryFromActionType(x.action_type) === selectedCategory
        );
        filteredVerifying = filteredVerifying.filter(
          (x) => getCategoryFromActionType(x.action_type) === selectedCategory
        );
      }
      const filteredCompleted = filterByCategory(completed);

      const hasNoFilteredResults = filteredItems.length === 0 && filteredVerifying.length === 0 && (!showCompleted || filteredCompleted.length === 0);
      const hasAnyData =
        useCategoryApi
          ? categoryTotalPending + categoryTotalVerifying + filterByCategory(completed).length > 0
          : items.length > 0 || verifying.length > 0 || completed.length > 0;
      const categoryLoadingHtml =
        useCategoryApi && isLoadingCategory
          ? `
        <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div class="animate-pulse inline-block w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mb-2"></div>
          <div class="text-sm text-slate-500 dark:text-slate-400">${selectedCategory}を読み込み中...</div>
        </div>
      `
          : "";
      const emptyState = allDone
        ? `
        <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div class="text-2xl mb-2">🎉</div>
          <div class="text-sm font-medium text-slate-700 dark:text-slate-300">今週のアクションはすべて完了です</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">次回スキャン後に新しいアクションが生成されます</div>
        </div>
      `
        : hasNoFilteredResults && hasAnyData && selectedCategory
          ? `
        <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div class="text-sm font-medium text-slate-600 dark:text-slate-400">このカテゴリに該当するアイテムはありません</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">別のカテゴリを選ぶか、タスクを再生成して確認してください</div>
          <button type="button" class="mt-3 px-4 py-2 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 cursor-pointer disabled:opacity-60 disabled:cursor-wait" data-action="regenerate" ${isRegenerating ? "disabled" : ""}>
            ${isRegenerating ? "再生成中..." : "タスクを再生成"}
          </button>
        </div>
      `
          : `
        <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div class="text-xl mb-2">📋</div>
          <div class="text-sm font-medium text-slate-700 dark:text-slate-300">スキャン完了後にアクションが自動生成されます</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">スキャン結果に基づき「今週やるべきこと」が表示されます</div>
          <button type="button" class="mt-3 px-4 py-2 rounded-lg text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 cursor-pointer disabled:opacity-60 disabled:cursor-wait" data-action="regenerate" ${isRegenerating ? "disabled" : ""}>
            ${isRegenerating ? "再生成中..." : "タスクを再生成"}
          </button>
        </div>
      `;

      const displayCount = filteredItems.length + filteredVerifying.length;
      const hasMore = !selectedCategory && items.length < totalPending;
      const footerHtml = `
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
            <span>${selectedCategory ? `表示中 ${displayCount}件（${selectedCategory}）` : `表示中 ${items.length}件 / 候補 ${totalPending + totalVerifying + totalCompleted}件`}（優先度順）</span>
          </div>
          ${hasMore ? `
            <button type="button" class="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed" data-action="load-more" ${isLoadingMore ? "disabled" : ""}>
              ${isLoadingMore ? "読み込み中..." : `もっと見る（あと${Math.min(20, totalPending - items.length)}件）`}
            </button>
          ` : ""}
        </div>
      `;

      const verifyingSection =
        filteredVerifying.length > 0
          ? `
        <div class="mt-4">
          <div class="flex items-center gap-2 mb-2">
            <p class="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">確認中</p>
            ${autoCheckState === "running"
              ? `<span class="flex items-center gap-1 text-[10px] text-indigo-500 font-bold">
                   <span class="animate-spin inline-block w-3 h-3 border border-indigo-400 border-t-transparent rounded-full"></span>
                   自動確認中...
                 </span>`
              : autoCheckState === "done"
              ? `<span class="text-[10px] text-slate-400">自動確認済み</span>
                 <button type="button" class="text-[10px] text-indigo-500 bg-transparent border-none cursor-pointer hover:underline" data-action="recheck">再チェック</button>`
              : autoCheckState === "error"
              ? `<span class="text-[10px] text-amber-500">※サーバー再起動後に利用可能</span>
                 <button type="button" class="text-[10px] text-indigo-500 bg-transparent border-none cursor-pointer hover:underline" data-action="recheck">再試行</button>`
              : `<button type="button" class="text-[10px] text-indigo-500 bg-transparent border-none cursor-pointer hover:underline" data-action="recheck">自動確認を実行</button>`
            }
          </div>
          <div class="flex flex-col gap-2">
            ${filteredVerifying
              .map(
                (item) => {
                  const chk = autoCheckResults[String(item.id)];
                  const statusBadge = chk
                    ? chk.resolved
                      ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">✓ 修正済み</span>`
                      : chk.checkable
                      ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">未修正</span>`
                      : `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">手動確認</span>`
                    : `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">確認中</span>`;
                  const checkNote = chk && !chk.resolved && chk.checkable
                    ? `<span class="text-[10px] text-red-500">${escapeHtml(chk.reason)}</span>` : "";
                  return `
              <div class="flex items-start gap-2 p-3 rounded-r-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10 mb-2" style="border-left: 3px solid #F59E0B;">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span class="text-xs font-medium">${escapeHtml(decodeUriForDisplay(item.title))}</span>
                    ${statusBadge}
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">対応: ${escapeHtml(item.effort)}</span>
                    ${checkNote}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-1 whitespace-pre-line">${escapeHtml(decodeUriForDisplay(item.description))}</div>
                  <div class="flex gap-2 items-center flex-wrap">
                    <span class="text-[10px] text-slate-400 dark:text-slate-500">${escapeHtml(item.source)}</span>
                    ${(function () {
                      const u = getSourceTabUrl(item.sourceTab, scanId);
                      const lbl = item.sourceTab ? `→ ${escapeHtml(item.sourceTab)}で確認` : "";
                      return u ? `<a href="${escapeHtml(u)}" class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">${lbl}</a>` : lbl ? `<span class="text-[10px] text-indigo-600 dark:text-indigo-400">${lbl}</span>` : "";
                    })()}
                    <button type="button" class="text-[10px] font-medium px-2 py-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer border-none" data-confirm-complete-id="${item.id}">完了</button>
                    <button type="button" class="text-[10px] text-slate-500 dark:text-slate-400 bg-transparent border-none cursor-pointer hover:underline" data-undo-id="${item.id}">元に戻す</button>
                  </div>
                </div>
              </div>
            `;
                }
              )
              .join("")}
          </div>
        </div>
      `
          : "";

      const completedSection =
        completed.length > 0
          ? `
        <div class="mt-4">
          <button type="button" class="text-xs text-slate-500 dark:text-slate-400 bg-transparent border-none cursor-pointer hover:underline p-0" data-action="toggle-completed">
            ${showCompleted ? "▲" : "▼"} 完了済みを${showCompleted ? "非表示" : "表示"}（${filteredCompleted.length}件）
          </button>
          ${
            showCompleted
              ? `
            <div class="mt-2 flex flex-col gap-1">
              ${filteredCompleted
                .map(
                  (item) => `
                <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 opacity-75">
                  <span class="text-emerald-600 text-sm">✓</span>
                  <span class="text-xs text-slate-600 dark:text-slate-400 line-through flex-1">${escapeHtml(decodeUriForDisplay(item.title))}</span>
                  <span class="text-[10px] text-slate-500">${formatDate(item.completedAt)} 完了</span>
                  <button type="button" class="text-[10px] text-indigo-600 dark:text-indigo-400 bg-transparent border-none cursor-pointer hover:underline" data-undo-id="${item.id}">元に戻す</button>
                </div>
              `
                )
                .join("")}
            </div>
          `
              : ""
          }
        </div>
      `
          : "";

      const itemsHtml =
        errMsg
          ? errorState
          : categoryLoadingHtml
            ? categoryLoadingHtml
            : (items.length === 0 && !selectedCategory) || hasNoFilteredResults
              ? emptyState
              : filteredItems
              .map(
                (item) => {
                  const opacity = animatingOut.has(String(item.id)) ? "opacity-0 transition-opacity duration-500" : "";
                  const tabUrl = getSourceTabUrl(item.sourceTab, scanId);
                  const tabLabel = item.sourceTab ? `→ ${escapeHtml(item.sourceTab)}で確認` : "";
                  const tabHtml = tabUrl
                    ? `<a href="${escapeHtml(tabUrl)}" class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">${tabLabel}</a>`
                    : tabLabel ? `<span class="text-[10px] text-indigo-600 dark:text-indigo-400">${tabLabel}</span>` : "";
                  return `
                <div class="flex items-start gap-2 p-3 rounded-r-xl border border-slate-200 dark:border-slate-700 mb-2 ${opacity}" style="border-left: 3px solid ${BORDER_COLOR[item.priority] || BORDER_COLOR.low};">
                  <input type="checkbox" class="w-4 h-4 cursor-pointer accent-amber-500 mt-0.5 shrink-0" data-verify-id="${item.id}" title="確認中にする" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span class="text-xs font-medium">${escapeHtml(decodeUriForDisplay(item.title))}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style="background:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).background};color:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).color}">${priorityLabel(item.priority)}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">対応: ${escapeHtml(item.effort)}</span>
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-1 whitespace-pre-line">${escapeHtml(decodeUriForDisplay(item.description))}</div>
                    <div class="flex gap-2 items-center flex-wrap">
                      <span class="text-[10px] text-slate-400 dark:text-slate-500">${escapeHtml(item.source)}</span>
                      ${tabHtml}
                    </div>
                  </div>
                </div>
              `;
                }
              )
              .join("");

      // --- Progress card ---
      const totalAll = totalPending + totalVerifying + totalCompleted;
      const pct = totalAll > 0 ? Math.round((totalCompleted / totalAll) * 100) : 0;
      function progressMessage(p) {
        if (p === 100) return { emoji: "🎉", text: "すべて完了！素晴らしい成果です" };
        if (p >= 75)   return { emoji: "✨", text: "もう少し！ゴールが見えています" };
        if (p >= 50)   return { emoji: "🔥", text: "よく進んでます！半分以上クリアしています" };
        if (p >= 25)   return { emoji: "👍", text: "順調に進んでいます！この調子で続けましょう" };
        if (p >= 1)    return { emoji: "🌱", text: "スタートしましたね！この調子で進めましょう" };
        return           { emoji: "💪", text: "さあ始めましょう！改善の第一歩を踏み出しましょう" };
      }
      const msg = progressMessage(pct);
      const barColor = pct === 100 ? "#10B981" : pct >= 50 ? "#6366F1" : "#F59E0B";
      const progressCardHtml = !isLoading && totalAll > 0 ? `
        <div class="mb-6 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <span class="text-2xl">${msg.emoji}</span>
              <span class="text-base font-bold text-slate-700">${msg.text}</span>
            </div>
            <span class="text-sm font-bold text-slate-500 shrink-0">${pct}%</span>
          </div>
          <div class="relative h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
            <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${barColor};"></div>
          </div>
          <div class="flex gap-6 text-xs text-slate-500">
            <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>${totalCompleted}件完了</span>
            <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400"></span>${totalVerifying}件確認中</span>
            <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-slate-300"></span>${totalPending}件未着手</span>
          </div>
        </div>
      ` : "";

      container.innerHTML = `
        <div class="mb-4">
          ${progressCardHtml}
          ${categoryFilterHtml}
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">今週やるべきこと</span>
            <span class="text-[11px] text-slate-400 dark:text-slate-500">${totalVerifying}件確認中 / ${totalCompleted}件完了 / 候補 ${totalPending + totalVerifying + totalCompleted}件</span>
          </div>
          ${itemsHtml}
          ${verifyingSection}
          ${items.length > 0 || verifying.length > 0 ? footerHtml : ""}
          ${completedSection}
        </div>
      `;

      container.querySelectorAll("[data-verify-id]").forEach((el) => {
        el.addEventListener("change", () => handleVerify(el.dataset.verifyId));
      });
      container.querySelectorAll("[data-confirm-complete-id]").forEach((el) => {
        el.addEventListener("click", () => handleConfirmComplete(el.dataset.confirmCompleteId));
      });
      container.querySelectorAll("[data-undo-id]").forEach((el) => {
        el.addEventListener("click", () => handleUndo(el.dataset.undoId));
      });
      container.querySelector("[data-action=toggle-completed]")?.addEventListener("click", () => {
        showCompleted = !showCompleted;
        render();
      });
      container.querySelector("[data-action=load-more]")?.addEventListener("click", loadMoreItems);
      container.querySelector("[data-action=recheck]")?.addEventListener("click", () => {
        autoCheckState = "idle";
        autoCheckResults = {};
        runAutoCheck();
      });
      container.querySelectorAll("[data-category]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedCategory = (btn.dataset.category || "").trim();
          const apiKey = CATEGORY_API_MAP[selectedCategory];
          if (apiKey) {
            categoryFetchKey = apiKey;
            isLoadingCategory = true;
            render();
            fetch(`/api/action-items?scanId=${encodeURIComponent(scanId)}&category=${encodeURIComponent(apiKey)}&limit=500`, {
              credentials: "include",
            })
              .then((r) => (r.ok ? r.json() : { items: [], verifying: [], totalPending: 0, totalVerifying: 0 }))
              .then((d) => {
                // Apply client-side filter as safety net (in case server doesn't support category param)
                const cat = selectedCategory;
                categoryItems = (d.items || []).filter((x) => getCategoryFromActionType(x.action_type) === cat);
                categoryVerifying = (d.verifying || []).filter((x) => getCategoryFromActionType(x.action_type) === cat);
                categoryTotalPending = categoryItems.length;
                categoryTotalVerifying = categoryVerifying.length;
                isLoadingCategory = false;
                render();
              })
              .catch(() => {
                isLoadingCategory = false;
                render();
              });
          } else {
            render();
          }
        });
      });
    }

    render();
    fetchItems();
  };

  function initActionItemList() {
    const container = document.getElementById("action-item-list-container");
    if (!container) return;
    const sp = new URLSearchParams(window.location.search);
    const scanId = sp.get("scan") || sp.get("scanId");
    if (!scanId) {
      container.innerHTML = `<div class="p-5 text-center rounded-xl bg-amber-50 border border-amber-200"><div class="text-sm text-amber-800">スキャンID（?scan= または ?scanId=）が必要です。</div><a href="seo.html" class="inline-block mt-3 text-indigo-600 font-bold text-xs">診断一覧へ</a></div>`;
      return;
    }
    if (container.dataset.initialized) return;
    container.dataset.initialized = "1";
    renderActionItemList(container, scanId);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initActionItemList);
  } else {
    initActionItemList();
  }
  window.addEventListener("load", initActionItemList);

  window.initActionItemList = initActionItemList;

})();

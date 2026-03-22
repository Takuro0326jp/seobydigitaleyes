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

  /**
   * アクションリストを container に描画
   * @param {HTMLElement} container
   * @param {string} scanId
   */
  window.renderActionItemList = function (container, scanId) {
    if (!container || !scanId) return;

    let items = [];
    let completed = [];
    let totalPending = 0;
    let totalCompleted = 0;
    let showCompleted = false;
    let animatingOut = new Set();

    function fetchItems() {
      return Promise.all([
        fetch(`/api/action-items?scanId=${encodeURIComponent(scanId)}`, { credentials: "include" }).then((r) =>
          r.json()
        ),
        fetch(`/api/action-items/completed?scanId=${encodeURIComponent(scanId)}`, {
          credentials: "include",
        }).then((r) => r.json()),
      ]).then(([pendingData, completedData]) => {
        items = pendingData.items || [];
        completed = completedData.items || [];
        totalPending = pendingData.totalPending ?? 0;
        totalCompleted = pendingData.totalCompleted ?? 0;
        render();
      });
    }

    function handleComplete(id) {
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

    function openAllModal() {
      const modal = document.getElementById("action-items-modal");
      if (modal) {
        modal.classList.remove("hidden");
        renderAllModal();
      }
    }

    function closeAllModal() {
      const modal = document.getElementById("action-items-modal");
      if (modal) modal.classList.add("hidden");
    }

    function renderAllModal() {
      const body = document.getElementById("action-items-modal-body");
      if (!body) return;
      fetch(`/api/action-items/all?scanId=${encodeURIComponent(scanId)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          const allItems = data.items || [];
          body.innerHTML = allItems
            .map(
              (item) => `
            <div class="flex items-start gap-2 p-3 rounded-xl border border-slate-200 ${item.completedAt ? "opacity-60" : ""}" style="border-left: 3px solid ${item.completedAt ? "#94a3b8" : BORDER_COLOR[item.priority] || BORDER_COLOR.low};">
              ${item.completedAt ? '<span class="text-emerald-600 text-sm">✓</span>' : ""}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="text-sm font-medium ${item.completedAt ? "line-through text-slate-500" : ""}">${escapeHtml(item.title)}</span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).background};color:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).color}">${priorityLabel(item.priority)}</span>
                  <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">対応: ${escapeHtml(item.effort)}</span>
                </div>
                <div class="text-xs text-slate-500 leading-relaxed">${escapeHtml(item.description)}</div>
                <div class="flex gap-2 mt-2 text-[10px] text-slate-400">
                  <span>${escapeHtml(item.source)}</span>
                  <span class="text-indigo-600">→ ${escapeHtml(item.sourceTab)}で確認</span>
                </div>
              </div>
            </div>
          `
            )
            .join("");
        })
        .catch(() => {
          body.innerHTML = '<p class="text-sm text-slate-500">読み込みに失敗しました</p>';
        });
    }

    function escapeHtml(s) {
      if (s == null) return "";
      const div = document.createElement("div");
      div.textContent = String(s);
      return div.innerHTML;
    }

    function render() {
      const emptyState = `
        <div class="p-5 text-center rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div class="text-2xl mb-2">🎉</div>
          <div class="text-sm font-medium text-slate-700 dark:text-slate-300">今週のアクションはすべて完了です</div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">次回スキャン後に新しいアクションが生成されます</div>
        </div>
      `;

      const footerHtml = `
        <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
          <span>表示中 ${Math.min(items.length, 5)}件（優先度順）</span>
          <button type="button" class="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer bg-transparent border-none" data-action="open-all">
            全候補を見る（${totalPending}件）→
          </button>
        </div>
      `;

      const completedSection =
        completed.length > 0
          ? `
        <div class="mt-4">
          <button type="button" class="text-xs text-slate-500 dark:text-slate-400 bg-transparent border-none cursor-pointer hover:underline p-0" data-action="toggle-completed">
            ${showCompleted ? "▲" : "▼"} 完了済みを${showCompleted ? "非表示" : "表示"}（${completed.length}件）
          </button>
          ${
            showCompleted
              ? `
            <div class="mt-2 flex flex-col gap-1">
              ${completed
                .map(
                  (item) => `
                <div class="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 opacity-75">
                  <span class="text-emerald-600 text-sm">✓</span>
                  <span class="text-xs text-slate-600 dark:text-slate-400 line-through flex-1">${escapeHtml(item.title)}</span>
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
        items.length === 0
          ? emptyState
          : items
              .map(
                (item) => {
                  const opacity = animatingOut.has(String(item.id)) ? "opacity-0 transition-opacity duration-500" : "";
                  return `
                <div class="flex items-start gap-2 p-3 rounded-r-xl border border-slate-200 dark:border-slate-700 mb-2 ${opacity}" style="border-left: 3px solid ${BORDER_COLOR[item.priority] || BORDER_COLOR.low};">
                  <input type="checkbox" class="w-4 h-4 cursor-pointer accent-emerald-600 mt-0.5 shrink-0" data-complete-id="${item.id}" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span class="text-xs font-medium">${escapeHtml(item.title)}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style="background:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).background};color:${(BADGE_STYLE[item.priority] || BADGE_STYLE.low).color}">${priorityLabel(item.priority)}</span>
                      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">対応: ${escapeHtml(item.effort)}</span>
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-1">${escapeHtml(item.description)}</div>
                    <div class="flex gap-2 items-center flex-wrap">
                      <span class="text-[10px] text-slate-400 dark:text-slate-500">${escapeHtml(item.source)}</span>
                      <span class="text-[10px] text-indigo-600 dark:text-indigo-400 cursor-pointer">→ ${escapeHtml(item.sourceTab)}で確認</span>
                    </div>
                  </div>
                </div>
              `;
                }
              )
              .join("");

      container.innerHTML = `
        <div class="mb-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">今週やるべきこと</span>
            <span class="text-[11px] text-slate-400 dark:text-slate-500">${totalCompleted}件完了 / 候補 ${totalPending + totalCompleted}件</span>
          </div>
          ${itemsHtml}
          ${items.length > 0 ? footerHtml : ""}
          ${completedSection}
        </div>
      `;

      container.querySelectorAll("[data-complete-id]").forEach((el) => {
        el.addEventListener("change", () => handleComplete(el.dataset.completeId));
      });
      container.querySelectorAll("[data-undo-id]").forEach((el) => {
        el.addEventListener("click", () => handleUndo(el.dataset.undoId));
      });
      container.querySelector("[data-action=toggle-completed]")?.addEventListener("click", () => {
        showCompleted = !showCompleted;
        render();
      });
      container.querySelector("[data-action=open-all]")?.addEventListener("click", openAllModal);
    }

    fetchItems();
  };

  // auto-init: action-item-list-container と URL の scan があれば描画
  document.addEventListener("DOMContentLoaded", function () {
    const container = document.getElementById("action-item-list-container");
    const sp = new URLSearchParams(window.location.search);
    const scanId = sp.get("scan") || sp.get("scanId");
    if (container && scanId) {
      renderActionItemList(container, scanId);
    }
  });

  // モーダル用のマークアップを document に追加（既存でなければ）
  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("action-items-modal")) {
      const modal = document.createElement("div");
      modal.id = "action-items-modal";
      modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 hidden";
      modal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onclick="event.stopPropagation()">
          <div class="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 class="text-base font-bold text-slate-800 dark:text-slate-200">全候補</h3>
            <button type="button" class="text-slate-500 hover:text-slate-700 text-xl leading-none p-1 bg-transparent border-none cursor-pointer" data-modal-close>×</button>
          </div>
          <div id="action-items-modal-body" class="p-4 overflow-y-auto flex-1"></div>
        </div>
      `;
      modal.addEventListener("click", (e) => {
        if (e.target === modal || e.target.closest("[data-modal-close]")) {
          modal.classList.add("hidden");
        }
      });
      document.body.appendChild(modal);
    }
  });
})();

/**
 * strategy.js - キーワード戦略管理 UI
 * GET /api/strategy でデータ取得、承認・削除・追加・AI提案
 */
(function () {
  "use strict";

  let strategyData = [];
  let currentSort = { key: "rank", asc: true };

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function intentLabel(intent) {
    const map = { Informational: "情報収集", Comparative: "比較検討", Transactional: "購入・コンバージョン" };
    return map[intent || "Informational"] || intent;
  }

  function getScoreColor(s) {
    return s >= 80 ? "text-emerald-600" : s >= 60 ? "text-orange-500" : "text-red-500";
  }
  function getRankColor(r) {
    return r <= 10 && r > 0 ? "text-emerald-600 font-black" : r === 0 || r > 50 ? "text-red-300" : "text-slate-800";
  }

  function updateScoreCards() {
    const acceptedList = strategyData.filter((d) => d.accepted);
    const avgRel =
      acceptedList.length > 0
        ? Math.round(acceptedList.reduce((acc, cur) => acc + (cur.relevance || 0), 0) / acceptedList.length)
        : 0;
    const total = strategyData.length;
    const coverage = total > 0 ? Math.round((acceptedList.length / total) * 100) : 0;
    const outCount = strategyData.filter((d) => d.rank === 0 || d.rank > 50).length;

    const intents = new Set(strategyData.map((d) => d.intent || "Informational"));
    const intentCoverage = intents.size >= 3 ? 100 : intents.size >= 2 ? 66 : intents.size >= 1 ? 33 : 0;

    const avgEl = document.getElementById("avgRelevance");
    if (avgEl) avgEl.textContent = `${avgRel}/100`;

    const kwEl = document.getElementById("kwCountDisplay");
    if (kwEl) kwEl.textContent = `${acceptedList.length} / ${total}`;

    const covEl = document.getElementById("intentCoverage");
    if (covEl) covEl.textContent = `${intentCoverage}%`;

    const outEl = document.getElementById("outOfRank");
    if (outEl) outEl.textContent = outCount;

    const hintEl = document.getElementById("aiHint");
    if (hintEl) hintEl.textContent = `承認済みキーワードの平均適合度は ${avgRel}% です。FAQの追加により、さらに向上可能です。`;

    const actionEl = document.getElementById("aiAction");
    if (actionEl) actionEl.textContent = outCount > 0 ? `圏外となっている ${outCount} 件のキーワードに対し、専用のLPを割り当ててください。` : "圏外キーワードはありません。";
  }

  function renderTable(data) {
    const body = document.getElementById("strategyTableBody");
    if (!body) return;

    const sorted = [...data].sort((a, b) => {
      let vA = a[currentSort.key];
      let vB = b[currentSort.key];
      if (currentSort.key === "keyword") {
        vA = (vA || "").toLowerCase();
        vB = (vB || "").toLowerCase();
        return currentSort.asc ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
      }
      if (currentSort.key === "rank") {
        if (vA === 0) vA = 999;
        if (vB === 0) vB = 999;
      }
      if (currentSort.key === "relevance") {
        vA = vA ?? 0;
        vB = vB ?? 0;
      }
      return currentSort.asc ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
    });

    if (sorted.length === 0) {
      body.innerHTML = `
        <tr><td colspan="6" class="p-12 text-center text-slate-400">キーワードがありません。「手動で追加」または「AI提案を取得」から登録してください。</td></tr>
      `;
      return;
    }

    body.innerHTML = sorted
      .map((item) => {
        const isPending = item.is_ai && !item.accepted;
        return `
          <tr class="hover:bg-slate-50/50 transition-colors ${isPending ? "bg-slate-50/30" : ""}">
            <td class="p-4 sm:p-6">
              <div class="flex items-center gap-2">
                <span class="font-bold ${isPending ? "text-slate-400 italic" : "text-slate-800"}">${escapeHtml(item.keyword)}</span>
                ${item.is_ai ? `<span class="text-[8px] font-black ${isPending ? "bg-slate-100 text-slate-400" : "bg-indigo-50 text-indigo-500"} px-1.5 py-0.5 rounded border border-transparent uppercase">AI</span>` : ""}
              </div>
            </td>
            <td class="p-4 sm:p-6"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${escapeHtml(intentLabel(item.intent))}</span></td>
            <td class="p-4 sm:p-6 text-center font-bold ${getScoreColor(item.relevance || 0)}">${item.relevance ?? 0}%</td>
            <td class="p-4 sm:p-6 text-center font-bold ${getRankColor(item.rank ?? 0)}">${item.rank === 0 ? "--" : item.rank}</td>
            <td class="p-4 sm:p-6 text-center">
              <div class="flex items-center justify-center gap-2">
                ${isPending ? `
                  <button data-action="accept" data-id="${item.id}" class="p-1.5 bg-emerald-500 text-white rounded-md hover:bg-emerald-600 transition" title="戦略に採用">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button data-action="reject" data-id="${item.id}" class="p-1.5 bg-white border border-slate-200 text-slate-400 rounded-md hover:text-red-500 hover:border-red-200 transition" title="却下">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                ` : `
                  <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest">Active</span>
                `}
              </div>
            </td>
            <td class="p-4 sm:p-6 text-center"><button data-action="detail" data-id="${item.id}" class="text-slate-300 hover:text-blue-600">❯</button></td>
          </tr>
        `;
      })
      .join("");

    body.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === "accept") acceptKeyword(id);
        else if (action === "reject") rejectKeyword(id);
        else if (action === "detail") openDetailModal(id);
      });
    });
  }

  function sortStrategy(key) {
    currentSort.asc = currentSort.key === key ? !currentSort.asc : true;
    currentSort.key = key;
    renderTable(strategyData);
  }

  async function fetchStrategy() {
    try {
      const res = await fetch("/api/strategy", { credentials: "include" });
      if (res.status === 401) {
        window.location.replace("/");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        if (res.status === 503) {
          const body = document.getElementById("strategyTableBody");
          if (body) {
            body.innerHTML = `<tr><td colspan="6" class="p-12 text-center"><p class="text-amber-600 font-bold mb-2">${escapeHtml(msg)}</p><p class="text-xs text-slate-500">ターミナルで <code class="bg-slate-100 px-1 rounded">node scripts/run-migration-strategy.js</code> を実行してください。</p></td></tr>`;
          }
          return;
        }
        if (res.status === 400) {
          const body = document.getElementById("strategyTableBody");
          if (body) {
            body.innerHTML = `<tr><td colspan="6" class="p-12 text-center"><p class="text-amber-600 font-bold">${escapeHtml(msg)}</p></td></tr>`;
          }
          return;
        }
        throw new Error(msg);
      }
      strategyData = Array.isArray(data) ? data : [];
      updateScoreCards();
      renderTable(strategyData);
    } catch (e) {
      console.error(e);
      const body = document.getElementById("strategyTableBody");
      if (body) {
        body.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-red-500">${escapeHtml(e.message)}</td></tr>`;
      }
    }
  }

  async function acceptKeyword(id) {
    try {
      const res = await fetch("/api/strategy/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "承認に失敗しました");
      }
      const item = strategyData.find((d) => d.id === id);
      if (item) item.accepted = true;
      updateScoreCards();
      renderTable(strategyData);
    } catch (e) {
      alert(e.message);
    }
  }

  async function rejectKeyword(id) {
    if (!confirm("この提案を削除しますか？")) return;
    try {
      const res = await fetch(`/api/strategy/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "削除に失敗しました");
      }
      strategyData = strategyData.filter((d) => d.id !== id);
      updateScoreCards();
      renderTable(strategyData);
    } catch (e) {
      alert(e.message);
    }
  }

  function openAddKeywordModal() {
    const body = document.getElementById("modalBody");
    const overlay = document.getElementById("modalOverlay");
    if (!body || !overlay) return;

    body.innerHTML = `
      <div class="space-y-6">
        <h2 class="text-xl font-black text-slate-900">戦略キーワードの手動追加</h2>
        <div class="space-y-4">
          <div class="space-y-2">
            <label class="text-[10px] font-black text-slate-400 uppercase">キーワード</label>
            <input id="newKw" type="text" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="例: 彦根 ホテル">
          </div>
          <div class="space-y-2">
            <label class="text-[10px] font-black text-slate-400 uppercase">検索意図</label>
            <select id="newIntent" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none bg-white">
              <option value="Informational">情報収集</option>
              <option value="Comparative">比較検討</option>
              <option value="Transactional">購入・コンバージョン</option>
            </select>
          </div>
        </div>
        <button id="btnAddConfirm" class="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm shadow-xl hover:bg-slate-800 transition">登録して分析を開始</button>
      </div>
    `;
    overlay.classList.remove("hidden");

    document.getElementById("btnAddConfirm")?.addEventListener("click", addNewKeyword);
  }

  async function addNewKeyword() {
    const kwInput = document.getElementById("newKw");
    const intentSelect = document.getElementById("newIntent");
    const kw = (kwInput?.value || "").trim();
    if (!kw) {
      alert("キーワードを入力してください");
      return;
    }
    const intent = intentSelect?.value || "Informational";

    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyword: kw, intent, accepted: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "追加に失敗しました");
      }
      const created = await res.json();
      strategyData.push(created);
      closeModal();
      updateScoreCards();
      renderTable(strategyData);
    } catch (e) {
      alert(e.message);
    }
  }

  function openDetailModal(id) {
    const d = strategyData.find((x) => x.id === id);
    const body = document.getElementById("modalBody");
    const overlay = document.getElementById("modalOverlay");
    if (!d || !body || !overlay) return;

    body.innerHTML = `
      <div class="space-y-8">
        <div class="flex justify-between items-end border-b border-slate-100 pb-6">
          <div>
            <h2 class="text-2xl font-black text-slate-900">${escapeHtml(d.keyword)}</h2>
            <p class="text-xs text-blue-600 font-bold mt-1">Status: ${d.accepted ? "Accepted" : "Proposed"}</p>
          </div>
          <div class="text-right">
            <p class="text-[10px] font-black text-slate-400 uppercase">Target Relevance</p>
            <p class="text-4xl font-black ${getScoreColor(d.relevance || 0)}">${d.relevance ?? 0}%</p>
          </div>
        </div>
        <p class="text-sm text-slate-500 leading-relaxed font-medium">このキーワードに対する戦略的な適合度スコアです。80%以上を目指すことで、上位表示の確率が飛躍的に高まります。</p>
      </div>
    `;
    overlay.classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("modalOverlay")?.classList.add("hidden");
  }

  async function fetchAiProposals() {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get("scan") || params.get("scanId");
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = (scanId && mappings[scanId]) || "";
    if (!propertyUrl) {
      alert("GSC プロパティが紐づけられていません。seo.html のサイト設定から GSC プロパティを選択・保存してください。");
      return;
    }

    const btn = document.getElementById("btnAiProposals");
    if (btn) btn.disabled = true;

    try {
      const res = await fetch("/api/strategy/ai-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId }),
      });
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Google 連携が必要です");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI提案の取得に失敗しました");
      }
      const data = await res.json();
      if (data.added > 0) {
        await fetchStrategy();
        const trendEl = document.getElementById("aiTrend");
        if (trendEl) trendEl.textContent = `${data.added} 件のキーワードを AI 提案として登録しました。承認してモニタリングを開始してください。`;
      } else {
        const trendEl = document.getElementById("aiTrend");
        if (trendEl) trendEl.textContent = "新規の AI 提案はありませんでした。条件: impression > 100 かつ rank > 10";
      }
    } catch (e) {
      alert(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    fetchStrategy();

    document.getElementById("btnAddKeyword")?.addEventListener("click", openAddKeywordModal);
    document.getElementById("btnAiProposals")?.addEventListener("click", fetchAiProposals);
    document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);
    document.getElementById("modalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") closeModal();
    });

    document.getElementById("thKeyword")?.addEventListener("click", () => sortStrategy("keyword"));
    document.getElementById("thRelevance")?.addEventListener("click", () => sortStrategy("relevance"));
    document.getElementById("thRank")?.addEventListener("click", () => sortStrategy("rank"));
  });
})();

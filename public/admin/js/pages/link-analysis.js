/**
 * リンク分析（PageRank）
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const scans = await adminApi.scans.scanList();
  container.innerHTML = `
    <div class="mb-8">
      <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight">リンク分析</h2>
      <p class="text-slate-500 mt-2 font-medium">PageRank による内部リンク構造の分析。</p>
    </div>
    <div class="mb-6 p-6 bg-white rounded-2xl border border-slate-200/60 shadow-sm">
      <label class="block text-sm font-medium text-slate-700 mb-2">スキャンを選択</label>
      <div class="flex gap-3 items-center flex-wrap">
        <select id="scan-select" class="px-4 py-2.5 border border-slate-200 rounded-xl w-full max-w-md text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
          <option value="">-- スキャンを選択 --</option>
          ${scans.map((s) => `
            <option value="${escapeHtml(s.id)}">${escapeHtml(s.target_url || s.id)} (${s.status})</option>
          `).join("")}
        </select>
        <button id="btn-analyze" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95">分析実行</button>
      </div>
    </div>
    <div id="link-result" class="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50/50 border-b border-slate-200/60">
          <tr>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">PageRank</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">URL</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Depth</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Internal</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">External</th>
          </tr>
        </thead>
        <tbody id="link-tbody" class="divide-y divide-slate-100"></tbody>
      </table>
    </div>
    <p id="link-message" class="text-sm text-slate-500 mt-4 hidden"></p>
  `;

  container.querySelector("#btn-analyze")?.addEventListener("click", async () => {
    const scanId = container.querySelector("#scan-select")?.value;
    if (!scanId) {
      alert("スキャンを選択してください");
      return;
    }
    const btn = container.querySelector("#btn-analyze");
    btn.disabled = true;
    btn.textContent = "分析中...";
    try {
      const data = await adminApi.linkAnalysis(scanId);
      const tbody = container.querySelector("#link-tbody");
      const resultDiv = container.querySelector("#link-result");
      const msgEl = container.querySelector("#link-message");

      if (!data.pages || data.pages.length === 0) {
        msgEl.textContent = "リンクデータがありません。スキャンに scan_links が保存されている必要があります。再スキャンしてください。";
        msgEl.classList.remove("hidden");
        resultDiv.classList.add("hidden");
      } else {
        msgEl.classList.add("hidden");
        resultDiv.classList.remove("hidden");
        tbody.innerHTML = data.pages.map((p, i) => `
          <tr class="hover:bg-slate-50/80 transition-colors">
            <td class="px-6 py-4 text-sm font-bold text-indigo-600">${p.page_rank.toFixed(4)}</td>
            <td class="px-6 py-4 text-sm text-slate-900 max-w-md truncate" title="${escapeHtml(p.url)}">${escapeHtml(p.url)}</td>
            <td class="px-6 py-4 text-sm text-slate-600">${p.depth ?? "—"}</td>
            <td class="px-6 py-4 text-sm text-slate-600">${p.internal_links ?? 0}</td>
            <td class="px-6 py-4 text-sm text-slate-600">${p.external_links ?? 0}</td>
          </tr>
        `).join("");
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "分析実行";
    }
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

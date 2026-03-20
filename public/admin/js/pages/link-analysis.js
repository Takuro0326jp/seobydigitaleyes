/**
 * リンク分析（PageRank）
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const scans = await adminApi.scans.scanList();
  container.innerHTML = `
    <h2 class="text-2xl font-bold text-slate-900 mb-6">リンク分析（PageRank）</h2>
    <div class="mb-6">
      <label class="block text-sm font-medium text-slate-700 mb-2">スキャンを選択</label>
      <select id="scan-select" class="px-4 py-2 border border-slate-200 rounded-lg w-full max-w-md">
        <option value="">-- スキャンを選択 --</option>
        ${scans.map((s) => `
          <option value="${escapeHtml(s.id)}">${escapeHtml(s.target_url || s.id)} (${s.status})</option>
        `).join("")}
      </select>
      <button id="btn-analyze" class="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">分析実行</button>
    </div>
    <div id="link-result" class="bg-white rounded-xl border border-slate-200 overflow-hidden hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">PageRank</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">URL</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Depth</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Internal</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">External</th>
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
          <tr class="hover:bg-slate-50">
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

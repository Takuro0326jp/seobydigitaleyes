/**
 * スキャン管理
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const scans = await adminApi.scans.list();
  container.innerHTML = `
    <h2 class="text-2xl font-bold text-slate-900 mb-6">スキャン管理</h2>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">ID</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Target URL</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">User</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Status</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Score</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">作成日</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${scans.map((s) => `
            <tr class="hover:bg-slate-50">
              <td class="px-6 py-4 text-sm font-mono text-slate-600">${escapeHtml((s.id || "").slice(0, 8))}...</td>
              <td class="px-6 py-4 text-sm text-slate-900 max-w-xs truncate">${escapeHtml(s.target_url || "")}</td>
              <td class="px-6 py-4 text-sm text-slate-600">${escapeHtml(s.user_email || "—")}</td>
              <td class="px-6 py-4"><span class="px-2 py-1 text-xs font-medium rounded ${s.status === "completed" ? "bg-emerald-100 text-emerald-700" : s.status === "running" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}">${escapeHtml(s.status || "")}</span></td>
              <td class="px-6 py-4 text-sm font-medium">${s.avg_score != null ? s.avg_score : "—"}</td>
              <td class="px-6 py-4 text-sm text-slate-500">${formatDate(s.created_at)}</td>
              <td class="px-6 py-4">
                <a href="/result.html?scan=${encodeURIComponent(s.id)}" class="text-indigo-600 text-sm hover:underline" target="_blank">結果</a>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("ja-JP");
}

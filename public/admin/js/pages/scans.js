/**
 * スキャン管理
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const scans = await adminApi.scans.list();
  container.innerHTML = `
    <div class="mb-8">
      <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight">スキャン管理</h2>
      <p class="text-slate-500 mt-2 font-medium">実行済みスキャン一覧と結果へのリンク。</p>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50/50 border-b border-slate-200/60">
          <tr>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">ID</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Target URL</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">User</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Score</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">作成日</th>
            <th class="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${scans.map((s) => `
            <tr class="hover:bg-slate-50/80 transition-colors">
              <td class="px-6 py-4 text-sm font-mono text-slate-600">${escapeHtml((s.id || "").slice(0, 8))}...</td>
              <td class="px-6 py-4 text-sm font-medium text-slate-900 max-w-xs truncate">${escapeHtml(s.target_url || "")}</td>
              <td class="px-6 py-4 text-sm text-slate-600">${escapeHtml(s.user_email || "—")}</td>
              <td class="px-6 py-4"><span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${s.status === "completed" ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : s.status === "running" ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-slate-100 text-slate-600 border border-slate-200"}">${escapeHtml(s.status || "")}</span></td>
              <td class="px-6 py-4 text-sm font-bold">${s.avg_score != null ? s.avg_score : "—"}</td>
              <td class="px-6 py-4 text-sm text-slate-500">${formatDate(s.created_at)}</td>
              <td class="px-6 py-4 text-right">
                <a href="/result.html?scan=${encodeURIComponent(s.id)}" class="text-slate-400 hover:text-indigo-600 font-bold text-xs uppercase tracking-widest transition-colors" target="_blank">結果</a>
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

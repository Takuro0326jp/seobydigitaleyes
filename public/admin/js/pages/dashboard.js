/**
 * ダッシュボード
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const data = await adminApi.dashboard();
  container.innerHTML = `
    <header class="mb-8">
      <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight">ダッシュボード</h2>
      <p class="text-slate-500 mt-2 font-medium">システムの概況を確認できます。</p>
    </header>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div class="bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm transition-all hover:shadow-md">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">総ユーザー数</p>
        <p class="text-3xl font-bold text-slate-900 mt-2">${data.users ?? 0}</p>
      </div>
      <div class="bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm transition-all hover:shadow-md">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">スキャン数</p>
        <p class="text-3xl font-bold text-slate-900 mt-2">${data.scans ?? 0}</p>
      </div>
      <div class="bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm transition-all hover:shadow-md">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">企業数</p>
        <p class="text-3xl font-bold text-slate-900 mt-2">${data.companies ?? 0}</p>
      </div>
      <div class="bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm transition-all hover:shadow-md">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">総ページ数</p>
        <p class="text-3xl font-bold text-slate-900 mt-2">${data.pages ?? 0}</p>
      </div>
    </div>
  `;
}

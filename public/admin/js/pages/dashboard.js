/**
 * ダッシュボード
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const data = await adminApi.dashboard();
  container.innerHTML = `
    <h2 class="text-2xl font-bold text-slate-900 mb-6">ダッシュボード</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <p class="text-sm text-slate-500 font-medium">ユーザー数</p>
        <p class="text-3xl font-bold text-slate-900 mt-1">${data.users ?? 0}</p>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <p class="text-sm text-slate-500 font-medium">スキャン数</p>
        <p class="text-3xl font-bold text-slate-900 mt-1">${data.scans ?? 0}</p>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <p class="text-sm text-slate-500 font-medium">企業数</p>
        <p class="text-3xl font-bold text-slate-900 mt-1">${data.companies ?? 0}</p>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-6">
        <p class="text-sm text-slate-500 font-medium">総ページ数</p>
        <p class="text-3xl font-bold text-slate-900 mt-1">${data.pages ?? 0}</p>
      </div>
    </div>
  `;
}

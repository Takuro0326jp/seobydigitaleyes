/**
 * ダッシュボード
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const data = await adminApi.dashboard();
  container.innerHTML = `
    <header class="mb-8">
      <h2 class="text-2xl font-bold text-slate-900 tracking-tight">ダッシュボード</h2>
      <p class="text-slate-500 mt-1 text-sm">システムの概況を確認できます。</p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
      <!-- 総ユーザー数 -->
      <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-widest">総ユーザー数</span>
          <div class="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
            <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
            </svg>
          </div>
        </div>
        <div>
          <p class="text-3xl font-bold text-slate-900">${data.users ?? 0}</p>
          <div class="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-indigo-400 rounded-full" style="width: 60%"></div>
          </div>
        </div>
      </div>

      <!-- スキャン数 -->
      <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-widest">スキャン数</span>
          <div class="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
            <svg class="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
        </div>
        <div>
          <p class="text-3xl font-bold text-slate-900">${data.scans ?? 0}</p>
          <div class="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-violet-400 rounded-full" style="width: 40%"></div>
          </div>
        </div>
      </div>

      <!-- 企業数 -->
      <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-widest">企業数</span>
          <div class="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center">
            <svg class="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
        </div>
        <div>
          <p class="text-3xl font-bold text-slate-900">${data.companies ?? 0}</p>
          <div class="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-sky-400 rounded-full" style="width: 25%"></div>
          </div>
        </div>
      </div>

      <!-- 総ページ数 -->
      <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-widest">総ページ数</span>
          <div class="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
            <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
        </div>
        <div>
          <p class="text-3xl font-bold text-slate-900">${(data.pages ?? 0).toLocaleString()}</p>
          <div class="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-400 rounded-full" style="width: 80%"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- クイックリンク -->
    <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-slate-700 mb-4">クイックアクセス</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <a href="#/users" class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group">
          <div class="w-8 h-8 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
            <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
          </div>
          <span class="text-sm font-medium text-slate-700 group-hover:text-indigo-700">ユーザー管理</span>
        </a>
        <a href="#/companies" class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-sky-200 hover:bg-sky-50 transition-all group">
          <div class="w-8 h-8 rounded-lg bg-sky-50 group-hover:bg-sky-100 flex items-center justify-center transition-colors">
            <svg class="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
          </div>
          <span class="text-sm font-medium text-slate-700 group-hover:text-sky-700">企業管理</span>
        </a>
        <a href="#/scans" class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50 transition-all group">
          <div class="w-8 h-8 rounded-lg bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
            <svg class="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <span class="text-sm font-medium text-slate-700 group-hover:text-violet-700">スキャン管理</span>
        </a>
        <a href="#/link-analysis" class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50 transition-all group">
          <div class="w-8 h-8 rounded-lg bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
            <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
          </div>
          <span class="text-sm font-medium text-slate-700 group-hover:text-emerald-700">リンク分析</span>
        </a>
      </div>
    </div>
  `;
}

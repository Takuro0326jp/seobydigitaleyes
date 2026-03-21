/**
 * スキャン一覧 — API呼び出し層
 * 他画面から流用する場合はこのファイルだけ差し替え可能
 */

const jsonOrThrow = async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.error || data.message || `HTTP ${res.status}`
    );
    err.status = res.status;
    throw err;
  }
  return data;
};

export async function fetchMe() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  const data = await res.json().catch(() => null);
  return data;
}

/**
 * GET /api/scans
 * @returns {Promise<Array<{id, domain, status, created_at}>>}
 */
export async function fetchScansList() {
  const res = await fetch("/api/scans", { credentials: "include" });
  const data = await jsonOrThrow(res);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.history)) {
    return data.history.map((row) => ({
      id: row.id,
      domain: row.target_url
        ? new URL(row.target_url).hostname.replace(/^www\./i, "")
        : row.id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
      avg_score: row.avg_score,
      company_id: row.company_id ?? null,
      gsc_property_url: row.gsc_property_url ?? null,
    }));
  }
  return [];
}

/** POST /api/scans/start（/api/scan/start も可）— { url } → { scanId, status } */
export async function createScan(target_url) {
  const res = await fetch("/api/scan-start", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: String(target_url).trim(),
      target_url: String(target_url).trim(),
    }),
  });
  return jsonOrThrow(res);
}

export async function fetchScanProgress(scanId) {
  const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}/progress`, {
    credentials: "include",
  });
  return jsonOrThrow(res);
}

/** DELETE /api/scans/:scanId */
export async function deleteScan(scanId) {
  const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

export async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include"
  });
}

/** GET /api/gsc/status — { linked: boolean } (scanId: そのURL専用の連携状態) */
export async function fetchGscStatus(scanId = null) {
  const url = scanId ? `/api/gsc/status?scan_id=${encodeURIComponent(scanId)}` : "/api/gsc/status";
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  return data;
}

/** GET /api/gsc/sites — { sites: [{ siteUrl, permissionLevel }] } (scanId: そのURLに紐づいたGoogleアカウントのプロパティ) */
export async function fetchGscSites(scanId = null) {
  const url = scanId ? `/api/gsc/sites?scan_id=${encodeURIComponent(scanId)}` : "/api/gsc/sites";
  const res = await fetch(url, { credentials: "include" });
  return jsonOrThrow(res);
}

/** DELETE /api/gsc/disconnect (scanId: そのURL専用の連携解除) */
export async function disconnectGsc(scanId = null) {
  const url = scanId ? `/api/gsc/disconnect?scan_id=${encodeURIComponent(scanId)}` : "/api/gsc/disconnect";
  const res = await fetch(url, {
    method: "DELETE",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

/** GET /api/companies — クライアント一覧 */
export async function fetchCompanies() {
  const res = await fetch("/api/companies", { credentials: "include" });
  return jsonOrThrow(res);
}

/** POST /api/admin/scans/:id/reset — 進行中のスキャンを強制リセット（管理者のみ） */
export async function resetStuckScan(scanId) {
  const res = await fetch(`/api/admin/scans/${encodeURIComponent(scanId)}/reset`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

/** PATCH /api/scans/:scanId — 設定更新（company_id, gsc_property_url） */
export async function patchScanSettings(scanId, { company_id, gsc_property_url }) {
  const body = {};
  if (company_id !== undefined) body.company_id = company_id;
  if (gsc_property_url !== undefined) body.gsc_property_url = gsc_property_url;
  const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

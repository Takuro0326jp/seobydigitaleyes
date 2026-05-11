/**
 * GET /api/scans/result/:id がページ分割応答になったとき、/pages を追跡フェッチして結合する。
 */
(function () {
  "use strict";

  window.fetchScanResultBundle = async function (scanId) {
    const enc = encodeURIComponent(scanId);
    const cred = { credentials: "include" };
    const res = await fetch(`/api/scans/result/${enc}`, cred);
    if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
    if (res.status === 404) throw Object.assign(new Error("not found"), { status: 404 });
    if (!res.ok) {
      let body = {};
      try {
        body = await res.json();
      } catch (_) {}
      throw Object.assign(new Error(body.error || res.statusText || "request failed"), {
        status: res.status,
        body,
      });
    }
    const data = await res.json();
    const pag = data.pagination;
    if (!pag || !pag.chunked) {
      return data;
    }
    const total = Number(pag.total) || 0;
    const pageSize = Number(pag.pageSize) || 220;
    const pages = Array.isArray(data.pages) ? [...data.pages] : [];
    while (pages.length < total) {
      const cr = await fetch(
        `/api/scans/result/${enc}/pages?offset=${pages.length}&limit=${pageSize}`,
        cred
      );
      if (!cr.ok) {
        let bx = {};
        try {
          bx = await cr.json();
        } catch (_) {}
        throw Object.assign(new Error(bx.error || "chunk fetch failed"), { status: cr.status, body: bx });
      }
      const part = await cr.json();
      const add = Array.isArray(part.pages) ? part.pages : [];
      if (add.length === 0) break;
      pages.push(...add);
    }
    delete data.pagination;
    data.pages = pages;
    return data;
  };
})();

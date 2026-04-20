/**
 * SEO Scan ヒートマップトラッカー
 *
 * 使い方:
 * <script src="https://your-host/js/seoscan-tracker.js" data-site-key="YOUR_KEY" async></script>
 */
(function () {
  "use strict";

  /* ── 設定読み取り ── */
  // document.currentScript は GTM 等の動的挿入では null になるため fallback
  var scriptEl = document.currentScript ||
    document.querySelector('script[data-site-key][src*="seoscan-tracker"]');
  if (!scriptEl) return;
  var SITE_KEY = scriptEl.getAttribute("data-site-key");
  if (!SITE_KEY) return;

  var ENDPOINT =
    scriptEl.getAttribute("data-endpoint") ||
    scriptEl.src.replace(/\/js\/seoscan-tracker\.js.*$/, "/api/heatmap/collect");

  var FLUSH_INTERVAL = 5000; // 5秒
  var FLUSH_SIZE = 10;       // 10イベント

  /* ── セッショントークン ── */
  var SESSION_KEY = "__seoscan_sid";
  var sessionToken = sessionStorage.getItem(SESSION_KEY);
  if (!sessionToken) {
    sessionToken = crypto.randomUUID ? crypto.randomUUID() : generateUUID();
    sessionStorage.setItem(SESSION_KEY, sessionToken);
  }

  function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /* ── イベントキュー ── */
  var queue = [];
  var timer = null;

  function getPageHeight() {
    return Math.max(
      document.body.scrollHeight || 0,
      document.documentElement.scrollHeight || 0
    );
  }

  function getScrollDepth() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
    var viewportH = window.innerHeight || 0;
    var pageH = getPageHeight();
    if (pageH <= 0) return 0;
    return Math.min(100, ((scrollTop + viewportH) / pageH) * 100);
  }

  function buildPayload() {
    return {
      site_key: SITE_KEY,
      session_token: sessionToken,
      page_url: location.origin + location.pathname,
      viewport_w: window.innerWidth || 0,
      viewport_h: window.innerHeight || 0,
      page_h: getPageHeight(),
      events: queue.splice(0)
    };
  }

  function send(payload) {
    if (!payload.events.length) return;
    var data = JSON.stringify(payload);
    // sendBeacon を優先（ページ離脱時でも送信可能）
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, data);
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", ENDPOINT, true);
      xhr.setRequestHeader("Content-Type", "text/plain");
      xhr.send(data);
    }
  }

  function flush() {
    if (queue.length === 0) return;
    send(buildPayload());
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      flush();
    }, FLUSH_INTERVAL);
  }

  /* ── クリック監視 ── */
  document.addEventListener(
    "click",
    function (e) {
      var pageW = document.documentElement.scrollWidth || 1;
      var pageH = getPageHeight() || 1;

      queue.push({
        type: "click",
        x_pct: +((e.pageX / pageW) * 100).toFixed(4),
        y_pct: +((e.pageY / pageH) * 100).toFixed(4),
        x_px: e.pageX,
        y_px: e.pageY,
        tag: e.target.tagName || "",
        text: (e.target.textContent || "").trim().slice(0, 100),
        scroll_depth: +getScrollDepth().toFixed(2),
        ts: Date.now()
      });

      if (queue.length >= FLUSH_SIZE) {
        flush();
      } else {
        scheduleFlush();
      }
    },
    true
  );

  /* ── ページ離脱時に残りを送信 ── */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
})();

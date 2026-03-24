/**
 * gsc-task.js - TASK ページ（今週やるべきこと）
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  function updateNavLinks() {
    const suffix = "?scan=" + encodeURIComponent(scanId);
    const taskLink = document.getElementById("nav-task");
    const perfLink = document.getElementById("nav-performance");
    const indexLink = document.getElementById("nav-indexHealth");
    const techLink = document.getElementById("nav-technical");
    const oppLink = document.getElementById("nav-opportunities");
    if (taskLink) taskLink.setAttribute("href", "gsc-task.html" + suffix);
    if (perfLink) perfLink.setAttribute("href", "gsc.html" + suffix);
    if (indexLink) indexLink.setAttribute("href", "gsc-indexhealth.html" + suffix);
    if (techLink) techLink.setAttribute("href", "gsc-technical.html" + suffix);
    if (oppLink) oppLink.setAttribute("href", "gsc-opportunities.html" + suffix);
  }

  function bootstrap() {
    updateNavLinks();
    if (window.initActionItemList) {
      window.initActionItemList();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();

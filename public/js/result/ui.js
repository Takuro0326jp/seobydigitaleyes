/*
UI EVENT CONTROLLER
CSP SAFE VERSION
DIGITALEYES / SEO SCAN
*/

document.addEventListener("DOMContentLoaded", () => {

    /* =========================
       Search Filters
    ========================= */

    const siteSearchInput = document.getElementById("siteSearchInput");
    if (siteSearchInput && typeof filterAndRenderSites === "function") {
        siteSearchInput.addEventListener("input", filterAndRenderSites);
    }

    const sortOrder = document.getElementById("sortOrder");
    if (sortOrder && typeof filterAndRenderSites === "function") {
        sortOrder.addEventListener("change", filterAndRenderSites);
    }

    const dirHealthSearch = document.getElementById("dirHealthSearch");
    if (dirHealthSearch && typeof filterDirectoryHealth === "function") {
        dirHealthSearch.addEventListener("input", filterDirectoryHealth);
    }

    const dirSearchInput = document.getElementById("dirSearchInput");
    if (dirSearchInput && typeof filterDirList === "function") {
        dirSearchInput.addEventListener("input", filterDirList);
    }

    const searchInput = document.getElementById("searchInput");
    if (searchInput && typeof filterAndRenderTable === "function") {
        searchInput.addEventListener("input", filterAndRenderTable);
    }


    /* =========================
       Modal Controls
    ========================= */

    const openScanBtn = document.getElementById("openScanBtn");
    if (openScanBtn && typeof openNewScanModal === "function") {
        openScanBtn.addEventListener("click", openNewScanModal);
    }

    const closeScanBtn = document.getElementById("closeScanBtn");
    if (closeScanBtn && typeof closeNewScanModal === "function") {
        closeScanBtn.addEventListener("click", closeNewScanModal);
    }

    const openScheduleBtn = document.getElementById("openScheduleModalBtn");
    if (openScheduleBtn && typeof openScheduleModal === "function") {
        openScheduleBtn.addEventListener("click", openScheduleModal);
    }

    const closeScheduleBtn = document.getElementById("closeScheduleModalBtn");
    if (closeScheduleBtn && typeof closeScheduleModal === "function") {
        closeScheduleBtn.addEventListener("click", closeScheduleModal);
    }

    const saveScheduleBtn = document.getElementById("saveScheduleBtn");
    if (saveScheduleBtn && typeof saveSchedule === "function") {
        saveScheduleBtn.addEventListener("click", saveSchedule);
    }


    /* =========================
       History Modal
    ========================= */

    const showHistoryBtn = document.getElementById("showHistoryModalBtn");
    if (showHistoryBtn && typeof showHistoryModal === "function") {
        showHistoryBtn.addEventListener("click", (e) => {
            e.preventDefault();
            showHistoryModal();
        });
    }

    const closeHistoryModalBtn = document.getElementById("closeHistoryModalBtn");
    if (closeHistoryModalBtn && typeof closeHistoryModal === "function") {
        closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
    }

    const closeHistoryModalBtn2 = document.getElementById("closeHistoryModalBtn2");
    if (closeHistoryModalBtn2 && typeof closeHistoryModal === "function") {
        closeHistoryModalBtn2.addEventListener("click", closeHistoryModal);
    }

    const historyModal = document.getElementById("historyModal");
    if (historyModal && typeof closeHistoryModal === "function") {
        historyModal.addEventListener("click", (e) => {
            if (e.target === historyModal) closeHistoryModal();
        });
    }


    /* =========================
       Directory Menu
    ========================= */

    const toggleDirMenuBtn = document.getElementById("toggleDirMenuBtn");
    if (toggleDirMenuBtn && typeof toggleDirMenu === "function") {
        toggleDirMenuBtn.addEventListener("click", toggleDirMenu);
    }


    /* =========================
       Sitemap
    ========================= */

    const submitSitemapBtn = document.getElementById("submitSitemapBtn");
    if (submitSitemapBtn && typeof submitSitemap === "function") {
        submitSitemapBtn.addEventListener("click", submitSitemap);
    }

    const exportSitemapBtn = document.getElementById("exportSitemapBtn");
    if (exportSitemapBtn && typeof exportSitemap === "function") {
        exportSitemapBtn.addEventListener("click", exportSitemap);
    }


    /* =========================
       Excel Export
    ========================= */

    const exportExcelBtn = document.getElementById("exportExcelBtn");
    if (exportExcelBtn && typeof exportExcel === "function") {
        exportExcelBtn.addEventListener("click", exportExcel);
    }

    const exportDirectoryExcelBtn = document.getElementById("exportDirectoryExcelBtn");
    if (exportDirectoryExcelBtn && typeof exportDirectoryExcel === "function") {
        exportDirectoryExcelBtn.addEventListener("click", exportDirectoryExcel);
    }


    /* =========================
       Critical Issues Card
    ========================= */

    const criticalIssuesCard = document.getElementById("criticalIssuesCard");
    if (criticalIssuesCard && typeof filterCriticalIssues === "function") {
        criticalIssuesCard.addEventListener("click", filterCriticalIssues);
    }


    /* =========================
       Rescan
    ========================= */

    const rescanBtn = document.getElementById("rescanBtn");
    if (rescanBtn && typeof startRescan === "function") {
        rescanBtn.addEventListener("click", startRescan);
    }


    /* =========================
       Back To Top
    ========================= */

    const backToTop = document.getElementById("backToTop");

    if (backToTop) {

        window.addEventListener("scroll", () => {

            if (window.scrollY > 400) {
                backToTop.style.opacity = "1";
            } else {
                backToTop.style.opacity = "0";
            }

        });

        backToTop.addEventListener("click", () => {

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

        });
    }


});

document.addEventListener("DOMContentLoaded", () => {

  const card = document.getElementById("criticalIssuesCard");

  if(!card) return;

  card.addEventListener("click", () => {

    // ① 重大ページ抽出
    const criticalPages = (SEOState.allCrawlData || [])
      .filter(p => isCritical(p));

    // ② テーブル再描画
    renderTable(criticalPages);

    // ③ テーブルへスクロール
    const table = document.getElementById("tableBody");

    if(table){
      table.scrollIntoView({
        behavior:"smooth",
        block:"start"
      });
    }

  });

});

let criticalFilterActive = false;

document.addEventListener("DOMContentLoaded", () => {

  const card = document.getElementById("criticalIssuesCard");
  const badge = document.getElementById("criticalFilterBadge");

  if(!card) return;

  card.addEventListener("click", () => {

    criticalFilterActive = !criticalFilterActive;

    if(criticalFilterActive){

      const criticalPages =
        (SEOState.allCrawlData || []).filter(p => isCritical(p));

      renderTable(criticalPages);

      badge.classList.remove("hidden");
      card.classList.add("ring-2","ring-red-500");

    }else{

      renderTable(SEOState.allCrawlData);

      badge.classList.add("hidden");
      card.classList.remove("ring-2","ring-red-500");

    }

    const table = document.getElementById("tableBody");

    if(table){
      table.scrollIntoView({
        behavior:"smooth",
        block:"start"
      });
    }

  });

});
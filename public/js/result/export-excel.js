/* =========================================
   階層カラー
========================================= */

function getDepthColor(depth){

  if(depth === 1) return "FFD9EAD3"; // 緑
  if(depth === 2) return "FFC9DAF8"; // 青
  if(depth === 3) return "FFFFE599"; // 黄
  if(depth >= 4) return "FFEAD1DC";  // 紫

  return "FFFFFFFF";

}


/* =========================================
   URL → 階層分解
========================================= */

function splitUrlDepth(url){

  try{

    const u = new URL(url);
    const path = u.pathname || "/";

    if(path === "/" || path === ""){
      return ["top","","",""];
    }

    const parts = path
      .replace(/^\/+|\/+$/g,"")
      .split("/")
      .filter(Boolean);

    return [
      parts[0] || "",
      parts[1] || "",
      parts[2] || "",
      parts[3] || ""
    ];

  }catch{

    return ["","","",""];

  }

}


/* =========================================
   備考生成
========================================= */

function buildRemark(p){

  const d = p.deductions || [];

  if(!d.length){
    return "良好";
  }

  return d.map(x=>x.label).join(" / ");

}


/* =========================================
   優先度
========================================= */

function buildPriority(p){

  if((p.status || 0) >= 400) return "HIGH";
  if((p.score || 0) < 60) return "HIGH";
  if((p.score || 0) < 80) return "MID";

  return "LOW";

}


/* =========================================
   行の階層判定
========================================= */

function detectDepth(r){

  if(r[3]) return 4;
  if(r[2]) return 3;
  if(r[1]) return 2;
  if(r[0]) return 1;

  return 1;

}


/* =========================================
   行カラー適用
========================================= */

function applyRowColor(ws, rows){

  rows.slice(1).forEach((r,i)=>{

    const rowIndex = i + 2;
    const depth = detectDepth(r);
    const color = getDepthColor(depth);

    const cols = Object.keys(ws);

    cols.forEach(c=>{

      if(!c.match(/^[A-Z]+[0-9]+$/)) return;

      const row = parseInt(c.replace(/[A-Z]/g,""));

      if(row !== rowIndex) return;

      if(!ws[c]) return;

      ws[c].s = ws[c].s || {};

      ws[c].s.fill = {
        patternType:"solid",
        fgColor:{rgb:color}
      };

    });

  });

}


/* =========================================
   Directory Excel
========================================= */
function exportDirectoryExcel(){

  const ok = confirm("ディレクトリ分析データをExcel(.xlsx)形式で出力します。\n実行しますか？");
  if(!ok) return;

  const pages = SEOState?.allCrawlData;

  if(!pages || !pages.length){
    alert("データがありません");
    return;
  }

  const map = new Map();

  pages.forEach(p=>{

    const [lv1] = splitUrlDepth(p.url || "");

    const key = lv1 || "top";

    if(!map.has(key)){
      map.set(key,{
        lv1:key,
        pages:0,
        score:0,
        issues:0,
        index:0,
        links:0,
        titleLen:0
      });
    }

    const row = map.get(key);

    row.pages += 1;
    row.score += Number(p.score || 0);
    row.links += Number(p.internal_links || 0);
    row.titleLen += (p.title || "").length;

    if((p.deduction_total || 0) > 0){
      row.issues += 1;
    }

    if(p.index_status === "index"){
      row.index += 1;
    }

  });

  const totalPages = pages.length;

  const rows = [[
    "ディレクトリ",
    "ページ数",
    "スコア",
    "問題数",
    "インデックス率",
    "シェア",
    "平均内リンク数",
    "平均タイトル文字数"
  ]];

  map.forEach(v=>{

    rows.push([
      v.lv1,
      v.pages,
      Math.round(v.score / v.pages),
      v.issues,
      Math.round((v.index / v.pages) * 100) + "%",
      Math.round((v.pages / totalPages) * 100) + "%",
      Math.round(v.links / v.pages),
      Math.round(v.titleLen / v.pages)
    ]);

  });

 const ws = XLSX.utils.aoa_to_sheet(rows);

/* 列幅 */
ws["!cols"] = [
  {wch:24},
  {wch:10},
  {wch:10},
  {wch:10},
  {wch:12},
  {wch:8},
  {wch:16},
  {wch:16}
];

/* ヘッダー固定（おすすめ） */
ws["!freeze"] = { xSplit:0, ySplit:1 };

/* 架線 */
applyBorders(ws);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    "ディレクトリ"
  );

  XLSX.writeFile(
    wb,
    "SEO_Directory_Report.xlsx"
  );

}


/* =========================================
   Full SEO Excel（ツリー構造）
========================================= */

function exportExcel(){

  const ok = confirm("ページ分析データをExcel(.xlsx)形式で出力します。\n実行しますか？");
  if(!ok) return;
  
  const data = SEOState?.allCrawlData;

  if(!data || !data.length){
    alert("データがありません");
    return;
  }

  const rows = [[
    "第1階層",
    "第2階層",
    "第3階層",
    "第4階層",
    "URL",
    "STATUS",
    "INDEX",
    "TITLE",
    "TitleLength",
    "H1",
    "InternalLinks",
    "Score",
    "Priority",
    "備考"
  ]];

  /* =====================================
     URL階層取得
  ===================================== */

  function getLevels(url){

    try{

      const u = new URL(url);
      const path = decodeURIComponent(u.pathname);

      const parts = path
        .replace(/^\/+|\/+$/g,"")
        .split("/")
        .filter(Boolean);

      return [
        parts[0] || "",
        parts[1] || "",
        parts[2] || "",
        parts[3] || ""
      ];

    }catch{

      return ["","","",""];

    }

  }

  /* =====================================
     ツリー生成
  ===================================== */

  const tree = {};

  data.forEach(p=>{

    const [lv1,lv2,lv3,lv4] = getLevels(p.url || "");

    if(!tree[lv1]) tree[lv1] = {};
    if(!tree[lv1][lv2]) tree[lv1][lv2] = [];

    tree[lv1][lv2].push({
      lv1,lv2,lv3,lv4,p
    });

  });

  /* =====================================
     ツリー展開
  ===================================== */

  Object.keys(tree).sort().forEach(lv1=>{

    // 第1階層（lv1が空＝ルート直下のときは "top" 表示で空行を防ぐ）
    const displayLv1 = lv1 || "top";
    rows.push([
      displayLv1,"","","","","","","","","","","","",""
    ]);

    const lv2Group = tree[lv1];

    Object.keys(lv2Group).sort().forEach(lv2=>{

      // 第2階層（lv2が空のときは見出し行を出さない＝空行を防ぐ）
      if (lv2) {
        rows.push([
          "",
          lv2,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ]);
      }

      const pages = lv2Group[lv2];

      pages.forEach(item=>{

        const p = item.p;

        rows.push([
          "",
          "",
          item.lv3,
          item.lv4,
          decodeURIComponent(p.url || ""),
          p.status || "",
          p.index_status || "",
          p.title || "",
          p.title ? p.title.length : 0,
          p.h1_count || 0,
          p.internal_links || 0,
          p.score || 0,
          buildPriority(p),
          buildRemark(p)
        ]);

      });

    });

  });

  /* =====================================
     シート生成
  ===================================== */

  const ws = XLSX.utils.aoa_to_sheet(rows);

  /* =====================================
     ディレクトリ太字
  ===================================== */

  rows.forEach((r,i)=>{

    if(i === 0) return;

    const rowIndex = i + 1;

    if(r[0] && !r[4]){

      const cell = ws["A"+rowIndex];

      if(cell){

        cell.s = cell.s || {};
        cell.s.font = {bold:true};

      }

    }

    if(r[1] && !r[4]){

      const cell = ws["B"+rowIndex];

      if(cell){

        cell.s = cell.s || {};
        cell.s.font = {bold:true};

      }

    }

  });

  /* =====================================
     階層カラー
  ===================================== */

  applyRowColor(ws, rows);
  applyBorders(ws);
  
  /* =====================================
     列幅
  ===================================== */

  ws["!cols"] = [
    {wch:18},
    {wch:18},
    {wch:18},
    {wch:18},
    {wch:70}, // URL
    {wch:10},
    {wch:10},
    {wch:45}, // TITLE
    {wch:10},
    {wch:8},
    {wch:14},
    {wch:10},
    {wch:10},
    {wch:60}  // 備考
  ];

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    "SEO Scan"
  );

  XLSX.writeFile(
    wb,
    "SEO_Full_Report.xlsx"
  );

}

/* =========================================
   架線（グリッド）
========================================= */

function applyBorders(ws){

  const range = XLSX.utils.decode_range(ws["!ref"]);

  for(let R = range.s.r; R <= range.e.r; ++R){

    for(let C = range.s.c; C <= range.e.c; ++C){

      const cellRef = XLSX.utils.encode_cell({r:R,c:C});
      const cell = ws[cellRef];

      if(!cell) continue;

      cell.s = cell.s || {};

      cell.s.border = {
        top:{style:"thin",color:{rgb:"FFDDDDDD"}},
        bottom:{style:"thin",color:{rgb:"FFDDDDDD"}},
        left:{style:"thin",color:{rgb:"FFDDDDDD"}},
        right:{style:"thin",color:{rgb:"FFDDDDDD"}}
      };

    }

  }

}
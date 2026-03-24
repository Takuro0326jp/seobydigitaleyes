/**
 * 今週やるべきこと - アクションアイテム自動生成
 * スキャン完了後または GSC ページ表示時に呼び出し
 */
const crypto = require("crypto");
const pool = require("../db");
const { getAuthenticatedClient } = require("../services/googleOAuth");
const { searchconsole } = require("@googleapis/searchconsole");

/** URLエンコードされた文字列を日本語等にデコード（表示用） */
function decodeUriForDisplay(str) {
  if (!str || typeof str !== "string") return str || "";
  try {
    return decodeURIComponent(str);
  } catch {
    // Fallback: decode complete UTF-8 character sequences individually
    let result = str.replace(
      /(?:%[fF][0-7](?:%[89aAbB][0-9a-fA-F]){3})|(?:%[eE][0-9a-fA-F](?:%[89aAbB][0-9a-fA-F]){2})|(?:%[cCdD][0-9a-fA-F]%[89aAbB][0-9a-fA-F])|(?:%[0-7][0-9a-fA-F])/g,
      (seq) => { try { return decodeURIComponent(seq); } catch { return seq; } }
    );
    result = result.replace(/(?:%[0-9a-fA-F]{0,2})+(?=\.\.\.$)/, "");
    return result;
  }
}

/** パラメータ種別: タスク化するか */
const PARAM_TASK_TARGET = {
  tracking: ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"],
  session: ["sessionid", "sid", "token", "session", "phpsessid"],
};
const PARAM_SKIP = {
  pagination: ["page", "p", "offset", "limit", "start"],
  sortFilter: ["sort", "order", "filter", "orderby", "dir"],
};

function hasTaskTargetParams(urlStr) {
  if (!urlStr || !urlStr.includes("?")) return false;
  try {
    const u = new URL(urlStr);
    const includeOther = process.env.DUPLICATE_TASK_INCLUDE_OTHER_PARAMS !== "0";
    let hasTarget = false;
    let onlySkippedParams = true;
    for (const [key] of u.searchParams) {
      const k = key.toLowerCase();
      const isTracking = PARAM_TASK_TARGET.tracking.some((p) => k === p || k.startsWith("utm_"));
      const isSession = PARAM_TASK_TARGET.session.some((p) => k.includes(p));
      const isSkip =
        PARAM_SKIP.pagination.some((p) => k === p || k === "p") ||
        PARAM_SKIP.sortFilter.some((p) => k.includes(p));
      if (isSkip) continue;
      onlySkippedParams = false;
      if (isTracking || isSession) hasTarget = true;
      else if (includeOther) hasTarget = true;
    }
    return hasTarget || (includeOther && !onlySkippedParams);
  } catch {
    return false;
  }
}

function getNormalizedBaseUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const u = new URL(urlStr);
    return u.origin + (u.pathname || "/");
  } catch {
    return urlStr;
  }
}

function normalizePropertyUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("sc-domain:")) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      u.hash = "";
      u.search = "";
      let p = u.pathname || "/";
      if (!p.endsWith("/")) p += "/";
      return u.origin + p;
    } catch {
      return null;
    }
  }
  return `sc-domain:${s.replace(/^sc-domain:/, "").split("/")[0].split("?")[0]}`;
}

/**
 * アクション生成メイン
 * @param {string} scanId
 * @param {number} userId
 * @param {object} req - Express req（getAuthenticatedClient 用。バックグラウンド呼び出し時は mockReq）
 */
async function generateActionItems(scanId, userId, req) {
  // スキャン情報取得
  const [[scan]] = await pool.query(
    "SELECT user_id, gsc_property_url, target_url FROM scans WHERE id = ? LIMIT 1",
    [scanId]
  );
  if (!scan) return;

  // 確認中・完了済み action_type（再生成しない）
  let skipRows;
  try {
    [skipRows] = await pool.query(
      "SELECT action_type FROM gsc_action_items WHERE scan_id = ? AND (verifying_at IS NOT NULL OR completed_at IS NOT NULL)",
      [scanId]
    );
  } catch (colErr) {
    if (colErr.code === "ER_BAD_FIELD_ERROR" || (colErr.message && colErr.message.includes("verifying_at"))) {
      [skipRows] = await pool.query(
        "SELECT action_type FROM gsc_action_items WHERE scan_id = ? AND completed_at IS NOT NULL",
        [scanId]
      );
    } else {
      throw colErr;
    }
  }
  const completedTypes = new Set((skipRows || []).map((r) => r.action_type));

  // scan_pages 取得（title は重複判定用）
  let pages = [];
  let titleColumnExists = true;
  try {
    const [pagesRows] = await pool.query(
      `SELECT url, status_code, is_noindex, is_orphan, inbound_link_count, title
       FROM scan_pages WHERE scan_id = ?`,
      [scanId]
    );
    pages = pagesRows || [];
  } catch (colErr) {
    if (colErr?.message && /Unknown column|title/.test(colErr.message)) {
      titleColumnExists = false;
      console.warn("[actionItemGeneration] scan_pages に title カラムがありません。タイトル重複判定をスキップします。");
      const [pagesRows] = await pool.query(
        `SELECT url, status_code, is_noindex, is_orphan, inbound_link_count
         FROM scan_pages WHERE scan_id = ?`,
        [scanId]
      );
      pages = (pagesRows || []).map((r) => ({ ...r, title: null }));
    } else {
      throw colErr;
    }
  }

  // scan_links 取得（404＋内部リンク経由の判定用）
  const [linksRows] = await pool.query(
    "SELECT from_url, to_url FROM scan_links WHERE scan_id = ?",
    [scanId]
  );
  const linkEdges = linksRows || [];
  const toUrlSet = new Set(linkEdges.map((e) => e.to_url));
  const toUrlFromUrls = new Map();
  for (const e of linkEdges) {
    if (!toUrlFromUrls.has(e.to_url)) toUrlFromUrls.set(e.to_url, []);
    toUrlFromUrls.get(e.to_url).push(e.from_url);
  }
  const urlToPage = new Map(pages.map((p) => [p.url, p]));

  const candidates = [];

  // ===== High: 内部リンク経由の404（1件ずつ個別アクション） =====
  const deadLinks = pages.filter((p) => p.status_code === 404 && toUrlSet.has(p.url));
  if (deadLinks.length > 0) {
    await pool.query(
      "DELETE FROM gsc_action_items WHERE scan_id = ? AND action_type = ?",
      [scanId, "fix_404_internal"]
    );
  }
  for (const p of deadLinks) {
    const actionType = "fix_404_" + crypto.createHash("md5").update(p.url).digest("hex").slice(0, 24);
    if (completedTypes.has(actionType)) continue;
    const fromUrls = toUrlFromUrls.get(p.url) || [];
    const fromPaths = fromUrls.slice(0, 3).map((u) => decodeUriForDisplay(u.replace(/^https?:\/\/[^/]+/, "") || "/"));
    const fromHint = fromUrls.length > 0
      ? `（${fromPaths.join("、")}${fromUrls.length > 3 ? ` 他${fromUrls.length - 3}件` : ""} からリンク）`
      : "";
    const displayUrl = decodeUriForDisplay(p.url);
    const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
    candidates.push({
      scanId,
      userId,
      actionType,
      priority: "high",
      title: `404を修正: ${shortUrl}`,
      description: `対象URL: ${displayUrl}\nこのURLは404を返しています${fromHint}。①正しいURLへ301リダイレクトを設定する または ②リンク元のURLを修正する のいずれかで対応してください。`,
      effort: "5分",
      source: "GSC: カバレッジ",
      sourceTab: "INDEX HEALTH",
    });
  }

  // ===== High: noindex 誤設定（1件ずつ個別アクション） =====
  const noindexPages = pages.filter((p) => p.is_noindex);
  if (noindexPages.length > 0) {
    await pool.query(
      "DELETE FROM gsc_action_items WHERE scan_id = ? AND action_type = ?",
      [scanId, "fix_noindex_error"]
    );
  }
  for (const p of noindexPages) {
    const actionType = "fix_noindex_" + crypto.createHash("md5").update(p.url).digest("hex").slice(0, 24);
    if (completedTypes.has(actionType)) continue;
    const displayUrl = decodeUriForDisplay(p.url);
    const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
    candidates.push({
      scanId,
      userId,
      actionType,
      priority: "high",
      title: `noindex修正: ${shortUrl}`,
      description: `対象URL: ${displayUrl}\nこのページにnoindexが設定されています。インデックスさせたい場合はmetaタグやX-Robots-Tagを削除してください。`,
      effort: "5分",
      source: "GSC: カバレッジ",
      sourceTab: "INDEX HEALTH",
    });
  }

  // ===== Medium: 孤立ページ =====
  const orphanPages = pages.filter((p) => p.is_orphan);
  if (orphanPages.length > 5 && !completedTypes.has("fix_orphan_pages")) {
    candidates.push({
      scanId,
      userId,
      actionType: "fix_orphan_pages",
      priority: "medium",
      title: `孤立ページ上位5件に内部リンクを追加する`,
      description: `被リンク0のページが${orphanPages.length}件あります。関連ページからリンクを張ることでPageRankが流れ、検索順位の改善が期待できます。`,
      effort: "30分",
      source: "内部リンク構造",
      sourceTab: "LINK STRUCTURE",
    });
  }

  // ===== GSC データを先行取得（重複ページのURL収集に必要） =====
  let gscPages = [];
  const propertyUrl = normalizePropertyUrl(scan.gsc_property_url);
  if (propertyUrl) {
    const client = await getAuthenticatedClient(userId, req, scanId);
    if (client) {
      try {
        const gsc = searchconsole({ version: "v1", auth: client });
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const startStr = startDate.toISOString().slice(0, 10);
        const endStr = endDate.toISOString().slice(0, 10);

        const { data: perfData } = await gsc.searchanalytics.query({
          siteUrl: propertyUrl,
          requestBody: {
            startDate: startStr,
            endDate: endStr,
            dimensions: ["page"],
            rowLimit: 500,
            aggregationType: "byPage",
          },
        });
        const gscRows = perfData?.rows || [];

        gscPages = gscRows.map((row) => {
          const keys = row.keys || [];
          const url = keys[0] || "";
          const impressions = Number(row.impressions) || 0;
          const ctr = Number(row.ctr) || 0;
          const position = Number(row.position) || 0;
          return { url, impressions, ctr, position };
        });

        // High: CTR が低い（表示100以上・CTR2%未満）1件ずつ個別アクション
        const lowCtrPages = gscPages
          .filter((p) => p.impressions >= 100 && p.ctr < 0.02)
          .sort((a, b) => b.impressions - a.impressions);
        if (lowCtrPages.length > 0) {
          await pool.query(
            "DELETE FROM gsc_action_items WHERE scan_id = ? AND action_type = ?",
            [scanId, "improve_ctr_title"]
          );
        }
        for (const p of lowCtrPages) {
          if (!p.url) continue;
          const actionType = "improve_ctr_" + crypto.createHash("md5").update(p.url).digest("hex").slice(0, 24);
          if (completedTypes.has(actionType)) continue;
          const displayUrl = decodeUriForDisplay(p.url);
          const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
          const ctrPct = ((p.ctr || 0) * 100).toFixed(2);
          candidates.push({
            scanId,
            userId,
            actionType,
            priority: "high",
            title: `CTR改善: ${shortUrl}`,
            description: `対象URL: ${displayUrl}\n表示回数${p.impressions}、CTR ${ctrPct}%です。タイトルに検索キーワードを含め、クリックされやすい文言に変更してください。`,
            effort: "5分",
            source: "GSC: CTR分析",
            sourceTab: "PERFORMANCE",
          });
        }

        // Medium: 11〜20位のページ（1件ずつ個別アクション）
        const nearTopPages = gscPages
          .filter((p) => p.position >= 11 && p.position <= 20 && p.impressions >= 50)
          .sort((a, b) => b.impressions - a.impressions);
        if (nearTopPages.length > 0) {
          await pool.query(
            "DELETE FROM gsc_action_items WHERE scan_id = ? AND action_type = ?",
            [scanId, "boost_near_top"]
          );
        }
        for (const p of nearTopPages) {
          if (!p.url) continue;
          const actionType = "boost_near_top_" + crypto.createHash("md5").update(p.url).digest("hex").slice(0, 24);
          if (completedTypes.has(actionType)) continue;
          const displayUrl = decodeUriForDisplay(p.url);
          const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
          const pos = Math.round(p.position || 0);
          candidates.push({
            scanId,
            userId,
            actionType,
            priority: "medium",
            title: `順位強化: ${shortUrl}（${pos}位）`,
            description: `対象URL: ${displayUrl}\n表示回数${p.impressions}、順位${pos}位です。関連ページからの内部リンクを追加し、順位改善を狙ってください。`,
            effort: "5分",
            source: "GSC: 検索パフォーマンス",
            sourceTab: "OPPORTUNITIES",
          });
        }
      } catch (err) {
        console.warn("[actionItemGeneration] GSC fetch failed:", err?.message);
      }
    }
  }

  // ===== Medium: URLパラメータ重複（改善版） =====
  const allUrls = [...new Set([...pages.map((p) => p.url).filter(Boolean), ...gscPages.map((p) => p.url).filter(Boolean)])];
  const paramUrls = allUrls.filter((u) => {
    if (!u) return false;
    try {
      const parsed = new URL(u);
      return parsed.search && parsed.search.length > 1;
    } catch {
      return u.includes("?") || u.includes("&");
    }
  });
  const paramDupByNormalized = new Map();
  for (const url of paramUrls) {
    if (!hasTaskTargetParams(url)) continue;
    const norm = getNormalizedBaseUrl(url);
    if (!norm) continue;
    if (!paramDupByNormalized.has(norm)) {
      paramDupByNormalized.set(norm, url);
    }
  }
  const usedFallbackParamFilter = paramDupByNormalized.size === 0 && paramUrls.length > 0;
  if (usedFallbackParamFilter) {
    for (const url of paramUrls) {
      const norm = getNormalizedBaseUrl(url);
      if (!norm) continue;
      if (!paramDupByNormalized.has(norm)) {
        paramDupByNormalized.set(norm, url);
      }
    }
  }
  for (const [normBase, exampleUrl] of paramDupByNormalized) {
    const actionType = "fix_url_param_dup_" + crypto.createHash("md5").update(normBase).digest("hex").slice(0, 24);
    if (completedTypes.has(actionType)) continue;
    const displayUrl = decodeUriForDisplay(exampleUrl);
    const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
    const paramDesc = usedFallbackParamFilter
      ? "このURLにはパラメータ（?や&）が含まれており"
      : "このURLにはトラッキングやセッション系パラメータ（utm_*, gclid, sessionid 等）が含まれており";
    candidates.push({
      scanId,
      userId,
      actionType,
      priority: "medium",
      title: `URLパラメータ重複対策: ${shortUrl}`,
      description: `対象URL: ${displayUrl}\n\n${paramDesc}、同一コンテンツの重複ページとして認識される可能性があります。\n\n【修正方法】\n①Canonicalタグで正規URLを指定する\n②Search Consoleの「URLパラメータ」設定で不要なパラメータを無視するよう指定する\n③正規URLへ301リダイレクトを設定する\n\nいずれかの方法で重複を解消してください。`,
      effort: "10分",
      source: "SEO診断: 重複ページ",
      sourceTab: "SEO",
    });
  }

  // ===== Medium: タイトル重複（1タスク/正規化タイトル、冪等性担保） =====
  if (titleColumnExists) {
    const titleCount = {};
    const titleToUrls = new Map();
    for (const p of pages) {
      const t = ((p.title || "") + "").trim().toLowerCase();
      if (t) {
        titleCount[t] = (titleCount[t] || 0) + 1;
        if (!titleToUrls.has(t)) titleToUrls.set(t, []);
        titleToUrls.get(t).push({ url: p.url, title: (p.title || "").trim() });
      }
    }
    for (const [normTitle, urlList] of titleToUrls) {
      if (titleCount[normTitle] < 2) continue;
      const actionType = "fix_dup_title_" + crypto.createHash("md5").update(normTitle).digest("hex").slice(0, 24);
      if (completedTypes.has(actionType)) continue;
      const displayTitle = normTitle || "（タイトルなし）";
      const urlListDecoded = urlList.map((o) => decodeUriForDisplay(o.url)).slice(0, 5);
      const otherList = urlListDecoded.join("\n");
      const suffix = urlList.length > 5 ? `\n...他${urlList.length - 5}件` : "";
      candidates.push({
        scanId,
        userId,
        actionType,
        priority: "medium",
        title: `タイトル重複を解消: 「${displayTitle.slice(0, 40)}${displayTitle.length > 40 ? "..." : ""}」（${urlList.length}件）`,
        description: `タイトル「${displayTitle}」が${urlList.length}件のページで重複しています。\n\n重複しているページ:\n${otherList}${suffix}\n\n【修正方法】\n①正規ページを1つ決め、他のページに canonical タグを設定する\n②各ページのタイトルを差別化し、内容に応じた独自のタイトルにする\n\nいずれかの方法で対応してください。`,
        effort: "10分",
        source: "SEO診断: 重複ページ",
        sourceTab: "SEO",
      });
    }
  }
  const dupTitleCount = titleColumnExists
    ? (() => {
        const tc = {};
        for (const p of pages) {
          const t = ((p.title || "") + "").trim().toLowerCase();
          if (t) tc[t] = (tc[t] || 0) + 1;
        }
        return Object.values(tc).filter((c) => c >= 2).length;
      })()
    : 0;
  // ===== Medium: canonical 別ページ指定（重複ページ扱い） =====
  const canonicalDiffPages = pages.filter(
    (p) => Array.isArray(p.issues) && p.issues.some((i) => i.code === "canonical_diff")
  );
  for (const p of canonicalDiffPages) {
    if (!p.url) continue;
    const issue = (p.issues || []).find((i) => i.code === "canonical_diff");
    const canonicalTarget = issue?.canonical || "";
    const actionType = "fix_canonical_diff_" + crypto.createHash("md5").update(p.url).digest("hex").slice(0, 24);
    if (completedTypes.has(actionType)) continue;
    const displayUrl = decodeUriForDisplay(p.url);
    const shortUrl = displayUrl.length > 55 ? displayUrl.slice(0, 52) + "..." : displayUrl;
    const displayCanonical = decodeUriForDisplay(canonicalTarget);
    candidates.push({
      scanId,
      userId,
      actionType,
      priority: "medium",
      title: `canonical設定確認: ${shortUrl}`,
      description: `対象URL: ${displayUrl}\n\nこのページのcanonicalタグが別のURL（${displayCanonical}）を指定しています。Googleはこのページをインデックスせず、指定先ページを正規URLとして扱います。\n\n【確認事項】\n①意図的な設定か確認する（例: ページネーションや印刷用ページなど、意図的であれば問題なし）\n②誤設定の場合は、canonicalタグをこのページ自身のURLに修正する`,
      effort: "5分",
      source: "SEO診断: 重複ページ",
      sourceTab: "SEO",
    });
  }

  console.log(
    "[actionItemGeneration] 重複ページ: paramUrls=" +
      paramUrls.length +
      ", paramDupTasks=" +
      paramDupByNormalized.size +
      ", dupTitleTasks=" +
      dupTitleCount +
      ", canonicalDiffTasks=" +
      canonicalDiffPages.length
  );

  // DB に挿入（重複ページは UPSERT、それ以外は INSERT IGNORE）
  const duplicateActionPrefixes = ["fix_url_param_dup_", "fix_dup_title_", "fix_canonical_diff_"];
  for (const item of candidates) {
    const isDuplicatePage = duplicateActionPrefixes.some((pre) => String(item.actionType || "").startsWith(pre));
    try {
      if (isDuplicatePage) {
        await pool.query(
          `INSERT INTO gsc_action_items
            (scan_id, user_id, action_type, priority, title, description, effort, source, source_tab)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title = VALUES(title),
             description = VALUES(description),
             effort = VALUES(effort),
             source = VALUES(source),
             source_tab = VALUES(source_tab),
             generated_at = CURRENT_TIMESTAMP`,
          [
            item.scanId,
            item.userId,
            item.actionType,
            item.priority,
            item.title,
            item.description,
            item.effort,
            item.source,
            item.sourceTab,
          ]
        );
      } else {
        await pool.query(
          `INSERT IGNORE INTO gsc_action_items
            (scan_id, user_id, action_type, priority, title, description, effort, source, source_tab)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.scanId,
            item.userId,
            item.actionType,
            item.priority,
            item.title,
            item.description,
            item.effort,
            item.source,
            item.sourceTab,
          ]
        );
      }
    } catch (e) {
      console.warn("[actionItemGeneration] insert skip:", e?.message);
    }
  }
}

module.exports = { generateActionItems };

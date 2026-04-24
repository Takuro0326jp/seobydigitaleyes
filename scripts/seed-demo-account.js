/**
 * デモアカウント＋ダミーデータ投入スクリプト
 *
 * 使い方:
 *   node scripts/seed-demo-account.js
 *
 * 作成されるもの:
 *   - デモ会社「株式会社デモ」
 *   - デモユーザー demo@seoscan.jp (パスワード: demo1234)
 *   - ダミーのスキャン 2 件（各 10 ページ程度）
 *   - スキャン履歴（推移表示用）
 *   - キーワード戦略データ
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");

const DEMO_EMAIL = "demo@seoscan.jp";
const DEMO_PASSWORD = "demo1234";
const DEMO_COMPANY = "株式会社デモ";
const TARGET_URL_1 = "https://demo-example.com";
const TARGET_URL_2 = "https://demo-shop.jp";

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  });

  try {
    // ── 1. 会社 ──
    const [existingCompany] = await conn.execute(
      "SELECT id FROM companies WHERE name = ?",
      [DEMO_COMPANY]
    );
    let companyId;
    if (existingCompany.length) {
      companyId = existingCompany[0].id;
      console.log(`会社「${DEMO_COMPANY}」は既に存在 (id=${companyId})`);
    } else {
      const [res] = await conn.execute(
        "INSERT INTO companies (name, created_at) VALUES (?, NOW())",
        [DEMO_COMPANY]
      );
      companyId = res.insertId;
      console.log(`会社「${DEMO_COMPANY}」を作成 (id=${companyId})`);
    }

    // ── 2. デモユーザー ──
    const [existingUser] = await conn.execute(
      "SELECT id FROM users WHERE email = ?",
      [DEMO_EMAIL]
    );
    let userId;
    if (existingUser.length) {
      userId = existingUser[0].id;
      console.log(`ユーザー ${DEMO_EMAIL} は既に存在 (id=${userId})`);
    } else {
      const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
      const [res] = await conn.execute(
        `INSERT INTO users (email, password, username, role, company_id, created_at)
         VALUES (?, ?, 'デモユーザー', 'admin', ?, NOW())`,
        [DEMO_EMAIL, hash, companyId]
      );
      userId = res.insertId;
      console.log(`ユーザー ${DEMO_EMAIL} を作成 (id=${userId})`);
    }

    // ── 3. company_urls + user_url_access ──
    for (const url of [TARGET_URL_1, TARGET_URL_2]) {
      const [exists] = await conn.execute(
        "SELECT id FROM company_urls WHERE company_id = ? AND url = ?",
        [companyId, url]
      );
      if (!exists.length) {
        await conn.execute(
          "INSERT INTO company_urls (company_id, url, created_at) VALUES (?, ?, NOW())",
          [companyId, url]
        );
      }
      // user_url_access（url直接格納スキーマ）
      const [uaExists] = await conn.execute(
        "SELECT id FROM user_url_access WHERE user_id = ? AND url = ?",
        [userId, url]
      );
      if (!uaExists.length) {
        await conn.execute(
          "INSERT INTO user_url_access (user_id, url) VALUES (?, ?)",
          [userId, url]
        );
      }
    }
    console.log("URL アクセス権を設定");

    // ── 4. スキャン 1 ──
    const scanId1 = randomUUID();
    await conn.execute(
      `INSERT INTO scans (id, user_id, company_id, target_url, status, avg_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'completed', 72, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY))`,
      [scanId1, userId, companyId, TARGET_URL_1]
    );

    const pages1 = [
      { url: "/", title: "トップページ | デモサイト", score: 92, depth: 0, status_code: 200, internal: 15, external: 3, h1: 1, words: 1200, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/about", title: "会社概要 | デモサイト", score: 85, depth: 1, status_code: 200, internal: 8, external: 1, h1: 1, words: 800, issues: [{ code: "short_title", label: "タイトル文字数不足" }], breakdown: { deductions: [{ label: "タイトル文字数不足", value: -5, reason: "15文字" }], totalDeduction: -5 } },
      { url: "/services", title: "サービス一覧", score: 78, depth: 1, status_code: 200, internal: 12, external: 2, h1: 1, words: 600, issues: [{ code: "short_title", label: "タイトル文字数不足" }], breakdown: { deductions: [{ label: "タイトル文字数不足", value: -10, reason: "8文字" }], totalDeduction: -10 } },
      { url: "/services/consulting", title: "コンサルティング | デモサイト", score: 70, depth: 2, status_code: 200, internal: 5, external: 0, h1: 1, words: 450, issues: [{ code: "short_title", label: "タイトル文字数不足" }], breakdown: { deductions: [{ label: "コンテンツ量不足", value: -15, reason: "450文字" }], totalDeduction: -15 } },
      { url: "/services/development", title: "システム開発 | デモサイト", score: 82, depth: 2, status_code: 200, internal: 6, external: 1, h1: 1, words: 950, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/blog", title: "ブログ | デモサイト", score: 88, depth: 1, status_code: 200, internal: 20, external: 0, h1: 1, words: 300, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/blog/seo-tips", title: "SEO対策の基本 | デモサイト", score: 90, depth: 2, status_code: 200, internal: 4, external: 5, h1: 1, words: 2500, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/contact", title: "", score: 35, depth: 1, status_code: 200, internal: 3, external: 0, h1: 0, words: 100, issues: [{ code: "no_title", label: "タイトル未設定" }, { code: "no_h1", label: "H1未設定" }], breakdown: { deductions: [{ label: "タイトル未設定", value: -30 }, { label: "H1未設定", value: -10 }], totalDeduction: -40 } },
      { url: "/old-page", title: "旧ページ", score: 0, depth: 2, status_code: 404, internal: 0, external: 0, h1: 0, words: 0, issues: [{ code: "http", label: "HTTP 404" }], breakdown: { deductions: [{ label: "HTTPエラー", value: -100 }], totalDeduction: -100 } },
      { url: "/privacy", title: "プライバシーポリシー | デモサイト", score: 60, depth: 1, status_code: 200, internal: 2, external: 0, h1: 1, words: 3000, noindex: 1, issues: [{ code: "noindex", label: "noindex設定" }], breakdown: { deductions: [{ label: "noindex", value: -30, reason: "noindex設定" }], totalDeduction: -30 } },
    ];

    for (const p of pages1) {
      await conn.execute(
        `INSERT INTO scan_pages (scan_id, url, depth, score, status_code, internal_links, external_links,
          title, h1_count, word_count, is_noindex, issues, score_breakdown)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId1, TARGET_URL_1 + p.url, p.depth, p.score, p.status_code,
          p.internal, p.external, p.title, p.h1, p.words, p.noindex || 0,
          JSON.stringify(p.issues), JSON.stringify(p.breakdown),
        ]
      );
    }
    console.log(`スキャン1 を作成 (${TARGET_URL_1}, ${pages1.length}ページ)`);

    // ── 5. スキャン 2 ──
    const scanId2 = randomUUID();
    await conn.execute(
      `INSERT INTO scans (id, user_id, company_id, target_url, status, avg_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'completed', 65, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [scanId2, userId, companyId, TARGET_URL_2]
    );

    const pages2 = [
      { url: "/", title: "デモショップ - オンラインストア", score: 88, depth: 0, status_code: 200, internal: 25, external: 4, h1: 1, words: 1500, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/products", title: "商品一覧 | デモショップ", score: 80, depth: 1, status_code: 200, internal: 30, external: 0, h1: 1, words: 400, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/products/item-1", title: "プレミアムウィジェット | デモショップ", score: 75, depth: 2, status_code: 200, internal: 8, external: 1, h1: 1, words: 700, issues: [{ code: "short_title", label: "タイトル文字数不足" }], breakdown: { deductions: [{ label: "タイトル文字数不足", value: -5 }], totalDeduction: -5 } },
      { url: "/products/item-2", title: "スタンダードウィジェット | デモショップ", score: 73, depth: 2, status_code: 200, internal: 8, external: 1, h1: 1, words: 650, issues: [{ code: "short_title", label: "タイトル文字数不足" }], breakdown: { deductions: [{ label: "タイトル文字数不足", value: -5 }], totalDeduction: -5 } },
      { url: "/cart", title: "カート", score: 40, depth: 1, status_code: 200, internal: 3, external: 0, h1: 0, words: 50, noindex: 1, issues: [{ code: "no_h1", label: "H1未設定" }, { code: "noindex", label: "noindex設定" }], breakdown: { deductions: [{ label: "H1未設定", value: -10 }, { label: "noindex", value: -30 }], totalDeduction: -40 } },
      { url: "/category/sale", title: "セール | デモショップ", score: 68, depth: 1, status_code: 200, internal: 15, external: 0, h1: 1, words: 350, issues: [], breakdown: { deductions: [{ label: "コンテンツ量不足", value: -10 }], totalDeduction: -10 } },
      { url: "/blog/review-guide", title: "商品レビューの書き方ガイド | デモショップ", score: 91, depth: 2, status_code: 200, internal: 6, external: 3, h1: 1, words: 2800, issues: [], breakdown: { deductions: [], totalDeduction: 0 } },
      { url: "/help", title: "ヘルプ | デモショップ", score: 55, depth: 1, status_code: 200, internal: 10, external: 0, h1: 1, words: 200, issues: [{ code: "dup_title", label: "タイトル重複" }], breakdown: { deductions: [{ label: "タイトル重複", value: -15 }, { label: "コンテンツ量不足", value: -10 }], totalDeduction: -25 } },
    ];

    for (const p of pages2) {
      await conn.execute(
        `INSERT INTO scan_pages (scan_id, url, depth, score, status_code, internal_links, external_links,
          title, h1_count, word_count, is_noindex, issues, score_breakdown)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId2, TARGET_URL_2 + p.url, p.depth, p.score, p.status_code,
          p.internal, p.external, p.title, p.h1, p.words, p.noindex || 0,
          JSON.stringify(p.issues), JSON.stringify(p.breakdown),
        ]
      );
    }
    console.log(`スキャン2 を作成 (${TARGET_URL_2}, ${pages2.length}ページ)`);

    // ── 6. スキャン履歴（推移グラフ用） ──
    // scan_history: id, email, url, timestamp, average_score, page_count, raw_data, status, user_id
    const historyData = [
      // scan1 の履歴
      { url: TARGET_URL_1, avg: 58, pages: 8, daysAgo: 30 },
      { url: TARGET_URL_1, avg: 62, pages: 9, daysAgo: 23 },
      { url: TARGET_URL_1, avg: 65, pages: 10, daysAgo: 16 },
      { url: TARGET_URL_1, avg: 68, pages: 10, daysAgo: 9 },
      { url: TARGET_URL_1, avg: 72, pages: 10, daysAgo: 3 },
      // scan2 の履歴
      { url: TARGET_URL_2, avg: 50, pages: 6, daysAgo: 28 },
      { url: TARGET_URL_2, avg: 55, pages: 7, daysAgo: 21 },
      { url: TARGET_URL_2, avg: 58, pages: 8, daysAgo: 14 },
      { url: TARGET_URL_2, avg: 62, pages: 8, daysAgo: 7 },
      { url: TARGET_URL_2, avg: 65, pages: 8, daysAgo: 1 },
    ];

    for (const h of historyData) {
      await conn.execute(
        `INSERT INTO scan_history (email, url, timestamp, average_score, page_count, status, user_id)
         VALUES (?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), ?, ?, 'completed', ?)`,
        [DEMO_EMAIL, h.url, h.daysAgo, h.avg, h.pages, userId]
      );
    }
    console.log("スキャン履歴を作成（推移グラフ用）");

    // ── 7. キーワード戦略 ──
    const keywords = [
      { keyword: "SEO対策", intent: "Informational", relevance: 95, rank: 12, url: TARGET_URL_1 + "/blog/seo-tips", accepted: 1 },
      { keyword: "SEO ツール おすすめ", intent: "Comparative", relevance: 88, rank: 8, url: TARGET_URL_1 + "/services", accepted: 1 },
      { keyword: "ウェブサイト改善", intent: "Informational", relevance: 82, rank: 25, url: TARGET_URL_1 + "/services/consulting", accepted: 1 },
      { keyword: "サイト診断", intent: "Transactional", relevance: 90, rank: 5, url: TARGET_URL_1 + "/", accepted: 1 },
      { keyword: "内部リンク 最適化", intent: "Informational", relevance: 75, rank: 18, url: TARGET_URL_1 + "/blog/seo-tips", accepted: 0, is_ai: 1 },
      { keyword: "コンテンツマーケティング", intent: "Informational", relevance: 70, rank: 35, url: TARGET_URL_1 + "/blog", accepted: 0, is_ai: 1 },
      { keyword: "ECサイト SEO", intent: "Informational", relevance: 85, rank: 15, url: TARGET_URL_2 + "/", accepted: 1 },
      { keyword: "商品ページ 最適化", intent: "Transactional", relevance: 80, rank: 22, url: TARGET_URL_2 + "/products", accepted: 1 },
      { keyword: "オンラインショップ 集客", intent: "Informational", relevance: 78, rank: 30, url: TARGET_URL_2 + "/blog/review-guide", accepted: 0, is_ai: 1 },
      { keyword: "レビュー 書き方", intent: "Informational", relevance: 65, rank: 9, url: TARGET_URL_2 + "/blog/review-guide", accepted: 1 },
    ];

    for (const kw of keywords) {
      await conn.execute(
        `INSERT INTO strategy_keywords (company_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [companyId, kw.keyword, kw.intent, kw.relevance, kw.rank, kw.is_ai || 0, kw.accepted, kw.url]
      );
    }
    console.log(`キーワード戦略データを作成（${keywords.length}件）`);

    // ── 完了 ──
    console.log("\n✅ デモアカウント作成完了!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  メール: ${DEMO_EMAIL}`);
    console.log(`  パスワード: ${DEMO_PASSWORD}`);
    console.log(`  ロール: admin`);
    console.log(`  会社: ${DEMO_COMPANY}`);
    console.log(`  サイト1: ${TARGET_URL_1} (スコア: 72)`);
    console.log(`  サイト2: ${TARGET_URL_2} (スコア: 65)`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});

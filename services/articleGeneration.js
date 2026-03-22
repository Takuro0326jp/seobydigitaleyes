/**
 * 記事構成案・本文生成（Gemini API）
 * 環境変数: GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_KEY のいずれか
 */
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

function getGeminiKey() {
  return (
    (process.env.GEMINI_API_KEY || "").trim() ||
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim() ||
    (process.env.GOOGLE_AI_API_KEY || "").trim() ||
    (process.env.GEMINI_KEY || "").trim()
  );
}

async function callGemini(prompt, options = {}) {
  const key = getGeminiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY が設定されていません。.env に追加してください。");
  }

  const url = `${GEMINI_API_BASE}/models/${options.model || DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? 8192,
        temperature: options.temperature ?? 0.7,
        ...(options.responseMimeType && { responseMimeType: options.responseMimeType }),
        ...(options.responseSchema && { responseJsonSchema: options.responseSchema }),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) {
    throw new Error(data.error?.message || "Gemini から応答がありませんでした");
  }
  return text;
}

/**
 * 記事構成案を3パターン生成
 */
async function generateArticleOutlines(keyword, intent) {
  const intentLabel = {
    Informational: "情報収集",
    Comparative: "比較検討",
    Transactional: "購入・コンバージョン",
  }[intent || "Informational"] || "情報収集";

  const prompt = `あなたはSEOの専門家です。以下のキーワードで上位表示を狙うための記事構成案を3パターン提案してください。

キーワード: ${keyword}
検索意図: ${intentLabel}

以下のJSON形式のみで返答してください。前置き・説明文・マークダウン記法は一切不要。純粋なJSONのみ出力:
{
  "outlines": [
    {
      "type": "解説型",
      "title": "記事タイトル",
      "headings": ["H2見出し1", "  H3見出し1-1", "H2見出し2"],
      "wordCount": 2800,
      "readingMinutes": 8
    },
    {
      "type": "比較型",
      "title": "記事タイトル",
      "headings": ["H2見出し1", "H2見出し2"],
      "wordCount": 2500,
      "readingMinutes": 7
    },
    {
      "type": "事例型",
      "title": "記事タイトル",
      "headings": ["H2見出し1", "H2見出し2"],
      "wordCount": 3000,
      "readingMinutes": 9
    }
  ]
}`;

  const schema = {
    type: "object",
    properties: {
      outlines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "解説型/比較型/事例型" },
            title: { type: "string", description: "記事タイトル" },
            headings: {
              type: "array",
              items: { type: "string" },
              description: "H2/H3見出しリスト",
            },
            wordCount: { type: "integer", description: "想定文字数" },
            readingMinutes: { type: "integer", description: "読了分数" },
          },
          required: ["type", "title", "headings"],
        },
      },
    },
    required: ["outlines"],
  };

  let text;
  try {
    text = await callGemini(prompt, {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: schema,
    });
  } catch (schemaErr) {
    if (schemaErr.message?.includes("400") || schemaErr.message?.includes("Invalid")) {
      text = await callGemini(prompt, { maxOutputTokens: 4096 });
    } else {
      throw schemaErr;
    }
  }

  const parseOutlineJson = (str) => {
    let jsonStr = str.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    // 末尾カンマ削除
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(jsonStr);
  };

  const repairTruncatedJson = (str) => {
    // 途中切れのJSON: 最後の完全なoutlineオブジェクトで打ち切って閉じる
    const match = str.match(/"outlines"\s*:\s*\[/);
    if (!match) return null;
    const start = match.index + match[0].length;
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastCompleteEnd = -1;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === "\\") { escape = true; continue; }
        if (c === inString) inString = false;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; continue; }
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === 0) lastCompleteEnd = i;
      }
    }
    if (lastCompleteEnd >= 0) {
      const fragment = str.slice(0, lastCompleteEnd + 1) + "]}";
      try {
        return JSON.parse(fragment.replace(/,(\s*[}\]])/g, "$1"));
      } catch (_) {}
    }
    return null;
  };

  let parsed;
  try {
    parsed = parseOutlineJson(text);
  } catch (_) {
    parsed = repairTruncatedJson(text);
  }
  if (!parsed) {
    try {
      const objMatch = text.trim().match(/\{[\s\S]*\}/);
      if (objMatch) {
        const fixed = objMatch[0].replace(/,(\s*[}\]])/g, "$1");
        parsed = JSON.parse(fixed);
      }
    } catch (_) {}
  }
  if (!parsed?.outlines) {
    console.warn("[articleGeneration] パース失敗。応答先頭:", text.slice(0, 800));
    throw new Error("AIの応答のJSON形式が不正です。サーバーログを確認してください。");
  }

  return Array.isArray(parsed.outlines) ? parsed.outlines : [];
}

/**
 * 記事本文を生成
 */
async function generateArticleBody(keyword, outline, companyInfo = "") {
  const headings = Array.isArray(outline.headings) ? outline.headings : [];

  const prompt = `あなたはSEOライターです。以下の条件で記事本文を執筆してください。

キーワード: ${keyword}
タイトル: ${outline.title || ""}
構成:
${headings.join("\n")}
会社情報: ${companyInfo || "特になし"}
目標文字数: ${outline.wordCount || 2500}字

条件:
- キーワードをタイトルと最初のH2に必ず含める
- 各H2セクションは300〜500字
- 最後にFAQを3問追加する
- マークダウン形式で出力する`;

  return callGemini(prompt, { maxOutputTokens: 8000 });
}

/**
 * 記事本文をストリーミングで生成（Gemini のストリーミング API 使用）
 */
async function generateArticleBodyStream(keyword, outline, companyInfo, onChunk) {
  const key = getGeminiKey();
  if (!key) throw new Error("GEMINI_API_KEY が設定されていません。");

  const headings = Array.isArray(outline.headings) ? outline.headings : [];
  const prompt = `あなたはSEOライターです。以下の条件で記事本文を執筆してください。

キーワード: ${keyword}
タイトル: ${outline.title || ""}
構成:
${headings.join("\n")}
会社情報: ${companyInfo || "特になし"}
目標文字数: ${outline.wordCount || 2500}字

条件:
- キーワードをタイトルと最初のH2に必ず含める
- 各H2セクションは300〜500字
- 最後にFAQを3問追加する
- マークダウン形式で出力する`;

  const url = `${GEMINI_API_BASE}/models/${DEFAULT_MODEL}:streamGenerateContent?key=${encodeURIComponent(key)}&alt=sse`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8000 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]" || !jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) onChunk(text);
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  generateArticleOutlines,
  generateArticleBody,
  generateArticleBodyStream,
};

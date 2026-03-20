/**
 * SEOスコア計算（唯一の算出箇所）
 * score = 100 - 合計減点
 * deductions: [{ label, value, reason }] value は負の値
 */
function calculateScore(data) {
  const deductions = Array.isArray(data.deductions) ? data.deductions : [];
  const totalDeduction = deductions.reduce((sum, d) => sum + Math.abs(Number(d.value) || 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  console.log({ totalDeduction, score, deductionCount: deductions.length });
  return { deductions, totalDeduction, score };
}
module.exports = { calculateScore };

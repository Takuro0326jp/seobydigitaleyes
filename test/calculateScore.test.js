/**
 * スコア計算のテスト
 * 条件: onPage=10, structure=30, performance=0, penalty=5 → score=35
 */
const { calculateScore } = require("../services/scanCrawl");

function test() {
  const result = calculateScore({
    onPage: 10,
    structure: 30,
    performance: 0,
    penalty: 5,
  });

  const expected = 35;
  const pass = result.score === expected;

  console.log("Input: onPage=10, structure=30, performance=0, penalty=5");
  console.log("Expected score:", expected);
  console.log("Actual score:", result.score);
  console.log(pass ? "PASS" : "FAIL");

  process.exit(pass ? 0 : 1);
}

test();

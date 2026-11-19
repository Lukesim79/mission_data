// 청라 레이크포레 입력값 산출 검산 — 검증 3종(표본 3셀 · 합계 일치 · 역산)을 테스트로 고정
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./cheongna.js");
const Calc = require("./calc.js");
const near = (a, b, e = 0.005) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);

test("검증1 표본 3셀: 세대당 분양가 = 공급면적 × 평당가 ÷ 100 (사업계획서 표와 반올림 일치)", () => {
  for (const t of C.TYPES) assert.equal(Math.round(t.pyeong * t.hope / 100), t.pdf, t.name);
  near(C.TYPES[0].pyeong * C.TYPES[0].hope / 100, 464.82);
  near(C.TYPES[2].pyeong * C.TYPES[2].hope / 100, 610.75);
  near(C.TYPES[3].pyeong * C.TYPES[3].hope / 100, 614.22);
});

test("공급면적 합계 19,238.8평 · 세대수 612", () => {
  const d = C.derive();
  near(d.area, 19238.8, 0.001);
  assert.equal(d.units, 612);
});

test("공란 4개 산출", () => {
  const d = C.derive();
  near(d.total, 351880.84);            // 총분양가 = 아파트 341,650.84 + 근린 10,230
  near(d.school, 2815.05, 0.01);       // 총분양가 × 0.8%
  assert.equal(d.agency, 1836);        // 612 × 3.0
  assert.equal(d.reserve, 5670);       // 189,000 × 3%
  near(d.mid, 15989.26, 0.01);         // 아파트 분양가 × 60% × 5.2% × 18/12
});

test("검증2 합계 일치: 총투자비 = 고정비 + 변동비 + 상쇄", () => {
  const d = C.derive();
  assert.equal(d.listed, 345296);
  assert.equal(d.fixed, 349094);
  near(d.totalInvest, d.fixed + d.variable + d.offset, 1e-6);
  near(d.totalInvest, 371606.31, 0.01);
  // 구분별 소계 합 = 고정비
  near(C.fixedByGroup().reduce((s, g) => s + g.v, 0), d.fixed, 1e-6);
  assert.equal(d.other, 23450);
  assert.equal(d.sub, 48000);
  assert.equal(d.pfCost, 24534);
});

test("검증3 역산: 희망가·분양률 100% 기말현금을 소요자금 표로 손계산 = 앱 계산기", () => {
  const d = C.derive();
  const hand = d.total + d.other - d.fixed - d.school - d.agency;      // 상쇄 항목은 유입=지출
  const input = { types: C.TYPES.map(t => ({ pyeong: t.pyeong, units: t.units, sqm: t.sqm })), price: d.avgHope,
    retail: d.shop / 100, other: d.other / 100, fixed: d.fixed / 100, pf: d.pf / 100, pfCost: d.pfCost / 100, sub: d.sub / 100 };
  near(Calc.endCash(input, 1) * 100, hand, 0.01);
  near(hand, 21585.79, 0.01);
});

test("프리셋(앱 입력값, 억원)", () => {
  const p = C.preset();
  assert.equal(p.fixed, 3490.94);
  assert.equal(p.other, 234.5);
  assert.equal(p.sub, 480);
  assert.equal(p.pf, 1300);
  assert.equal(p.rate, 85);
  assert.equal(p.price, 1766);
});

// 검산 테스트 — Node 내장 test runner 사용 (npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const Calc = require("./calc.js");

// 샘플 A: 해운대 그린테라스
const A = {
  types: [
    { pyeong: 25.6, units: 200 },
    { pyeong: 34.6, units: 320 },
  ],
  price: 2420, retail: 150, other: 175, fixed: 3815.0,
  pf: 2450, pfCost: 480, sub: 400,
};

test("샘플 A (분양률 100%): 기말현금 +380.3억 · DSCR 1.27 · LTV 60.2%", () => {
  const r = Calc.calculate(A, 1);
  assert.equal(r.endCash.toFixed(1), "380.3");
  assert.equal(r.dscr.toFixed(2), "1.27");
  assert.equal((r.ltv * 100).toFixed(1), "60.2");
});

test("합계: 공급면적 16,192평 · 520세대", () => {
  assert.equal(Calc.totalArea(A.types).toFixed(1), "16192.0");
  assert.equal(Calc.totalUnits(A.types), 520);
});

test("분양률 50%: 분양수입 절반, 팔린 세대도 절반", () => {
  const full = Calc.salesRevenue(A, 1);
  assert.ok(Math.abs(Calc.salesRevenue(A, 0.5) - full / 2) < 1e-9);
  const expected = full / 2 * 0.992 - 260 * 0.03 + 175 - 3815;
  assert.ok(Math.abs(Calc.endCash(A, 0.5) - expected) < 1e-9);
});

test("LTV는 분양률과 무관 (항상 100% 기준)", () => {
  assert.equal(Calc.ltv(A), Calc.calculate(A, 0.6).ltv);
});

test("분모가 0이면 null", () => {
  assert.equal(Calc.dscr({ ...A, pf: 0, pfCost: 0 }, 1), null);
  assert.equal(Calc.ltv({ ...A, types: [], retail: 0 }), null);
});

test("샘플 A 한계선: 기말현금 0 → 90.5% · 2,183만원", () => {
  const l = Calc.limits(A).zero;
  assert.equal((l.rateAtPlan * 100).toFixed(1), "90.5");
  assert.equal(l.priceAtFull.toFixed(0), "2183");
});

test("샘플 A 한계선: 상환 한계 → 80.6% · 1,934만원", () => {
  const l = Calc.limits(A).repay;
  assert.equal((l.rateAtPlan * 100).toFixed(1), "80.6");
  assert.equal(l.priceAtFull.toFixed(0), "1934");
});

test("한계선 역검증: 한계 분양률·평당가에서 기말현금이 목표값", () => {
  const l = Calc.limits(A);
  assert.ok(Math.abs(Calc.endCash(A, l.zero.rateAtPlan)) < 1e-9);
  assert.ok(Math.abs(Calc.endCash({ ...A, price: l.repay.priceAtFull }, 1) + A.sub) < 1e-9);
});

test("상환 가능 = 기말현금 ≥ −후순위 (경계 포함)", () => {
  const r = Calc.limits(A).repay.rateAtPlan;
  assert.equal(Calc.repayable(A, r + 0.001), true);
  assert.equal(Calc.repayable(A, r - 0.001), false);
});

test("민감도 표: 6행(75~100%) × 7열(−500~+100만원), 칸 값이 endCash와 일치", () => {
  const rates = [0.75, 0.8, 0.85, 0.9, 0.95, 1];
  const deltas = [-500, -400, -300, -200, -100, 0, 100];
  const t = Calc.sensitivity(A, rates, deltas);
  assert.equal(t.length, 6);
  assert.equal(t[0].length, 7);
  const c = t[5][5]; // 분양률 100%, 계획 평당가
  assert.equal(c.cash.toFixed(1), "380.3");
  assert.equal(c.ok, true);
  assert.equal(t[0][0].ok, false); // 75%, −500만원 → 상환 불가
});

test("샘플 A 기말현금 구성: 학교용지 32.5억 · 분양대행 15.6억", () => {
  const b = Calc.breakdown(A, 1);
  assert.equal(b.schoolFee.toFixed(1), "32.5");
  assert.equal(b.agencyFee.toFixed(1), "15.6");
  assert.equal(b.soldUnits, 520);
});

test("샘플 A 한계선 여유: 분양률 19.4%p · 평당가 486만원 · 고정비 780.3억", () => {
  const m = Calc.margins(A, 1);
  assert.equal((m.rateMarginRepay * 100).toFixed(1), "19.4");
  assert.equal(m.priceMarginRepay.toFixed(0), "486");
  assert.equal(m.fixedMargin.toFixed(1), "780.3");
  assert.equal((m.rateMarginZero * 100).toFixed(1), "9.5");
});

test("입력이 비면 한계선·여유가 null (근거 없는 숫자를 만들지 않음)", () => {
  const empty = { types: [], price: 0, retail: 0, other: 0, fixed: 0, pf: 0, pfCost: 0, sub: 0 };
  assert.equal(Calc.limits(empty).zero.rateAtPlan, null);
  assert.equal(Calc.limits(empty).zero.priceAtFull, null);
  assert.equal(Calc.margins(empty, 1).rateMarginRepay, null);
});

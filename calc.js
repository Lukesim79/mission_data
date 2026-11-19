/* 사업수지 계산 모듈 — 화면(index.html)과 분리됨.
 * 브라우저에서는 window.Calc, Node에서는 require("./calc.js")로 사용.
 * 금액 단위: 억원 (평당가만 만원), 면적: 평 */

// 상수
const SCHOOL_RATE = 0.008;   // 학교용지부담금 0.8%
const AGENCY_FEE_EOK = 0.03; // 분양대행수수료 세대당 300만원 = 0.03억원

/** 주택형 표에서 공급면적 합계(평) = Σ 공급평 × 세대수 */
function totalArea(types) {
  return types.reduce((s, t) => s + (t.pyeong || 0) * (t.units || 0), 0);
}

/** 주택형 표에서 세대수 합계 */
function totalUnits(types) {
  return types.reduce((s, t) => s + (t.units || 0), 0);
}

/** 분양수입(억원) = (공급면적 × 평당가 ÷ 10,000 + 상가) × 분양률
 *  rate: 분양률 (0~1) */
function salesRevenue(input, rate) {
  const base = totalArea(input.types) * input.price / 10000 + input.retail;
  return base * rate;
}

/** 기말현금(억원) = 분양수입 × (1 − 학교용지 0.8%)
 *                  − 팔린 세대 × 분양대행 300만원 + 기타유입 − 고정비
 *  팔린 세대 = 전체 세대수 × 분양률 */
function endCash(input, rate) {
  const revenue = salesRevenue(input, rate);
  const soldUnits = totalUnits(input.types) * rate;
  return revenue * (1 - SCHOOL_RATE)
    - soldUnits * AGENCY_FEE_EOK
    + input.other
    - input.fixed;
}

/** 만기 누적 DSCR = 1 + (기말현금 + 후순위) ÷ (본PF + 본PF 금융비용)
 *  상환 대상이 0이면 null 반환 */
function dscr(input, rate) {
  const debt = input.pf + input.pfCost;
  if (!debt) return null;
  return 1 + (endCash(input, rate) + input.sub) / debt;
}

/** LTV = 본PF ÷ 분양률 100%일 때 분양수입 (비율, 0.602 = 60.2%)
 *  분양수입이 0이면 null 반환 */
function ltv(input) {
  const full = salesRevenue(input, 1);
  if (!full) return null;
  return input.pf / full;
}

/** 분양률을 받아 사업수지 전체를 한 번에 계산 */
function calculate(input, rate) {
  return {
    rate,
    area: totalArea(input.types),
    units: totalUnits(input.types),
    revenue: salesRevenue(input, rate),
    endCash: endCash(input, rate),
    dscr: dscr(input, rate),
    ltv: ltv(input),
  };
}

/** 분양률 1당 기말현금 증가분(억원) — 기말현금이 분양률에 비례하는 부분의 계수.
 *  = 분양수입(100%) × (1 − 학교용지) − 전체 세대수 × 분양대행수수료 */
function cashSlope(input) {
  return salesRevenue(input, 1) * (1 - SCHOOL_RATE) - totalUnits(input.types) * AGENCY_FEE_EOK;
}

/** 상환 가능 여부: 기말현금이 −후순위 이상이면 true (PF 전액 상환 가능) */
function repayable(input, rate) {
  return endCash(input, rate) >= -input.sub;
}

/** 주어진 평당가에서 기말현금이 target(억원)이 되는 분양률 (비율, 0.905 = 90.5%)
 *  target=0 → 기말현금 0 한계선, target=−후순위 → 상환 한계선
 *  분양률에 따라 늘지 않는 구조(계수 ≤ 0)면 null */
function breakEvenRate(input, price, target) {
  const slope = cashSlope({ ...input, price });
  if (slope <= 0) return null;
  return (target - input.other + input.fixed) / slope;
}

/** 주어진 분양률에서 기말현금이 target(억원)이 되는 평당가 (만원)
 *  공급면적이나 분양률이 0이면 null */
function breakEvenPrice(input, rate, target) {
  const area = totalArea(input.types);
  if (!area || rate <= 0) return null;
  const need = (target - input.other + input.fixed) / rate + totalUnits(input.types) * AGENCY_FEE_EOK;
  const revenue100 = need / (1 - SCHOOL_RATE);
  return (revenue100 - input.retail) * 10000 / area;
}

/** 두 한계선 계산: 기말현금 0 / 상환 한계(−후순위)
 *  각각 계획 평당가에서의 분양률(rateAtPlan)과, 분양률 100%에서의 평당가(priceAtFull) */
function limits(input) {
  const out = {};
  for (const [key, target] of [["zero", 0], ["repay", -input.sub]]) {
    out[key] = {
      rateAtPlan: breakEvenRate(input, input.price, target),
      priceAtFull: breakEvenPrice(input, 1, target),
    };
  }
  return out;
}

/** 민감도 표: 행=분양률 목록, 열=계획 평당가 + 증감(만원) 목록
 *  칸마다 { rate, price, cash, ok } 반환 (ok = 상환 가능) */
function sensitivity(input, rates, priceDeltas) {
  return rates.map(rate => priceDeltas.map(d => {
    const price = input.price + d;
    const cash = endCash({ ...input, price }, rate);
    return { rate, price, cash, ok: cash >= -input.sub };
  }));
}

/** 기말현금 구성 항목(억원): 학교용지부담금, 분양대행수수료, 팔린 세대 수 */
function breakdown(input, rate) {
  const revenue = salesRevenue(input, rate);
  const soldUnits = totalUnits(input.types) * rate;
  return {
    revenue,
    soldUnits,
    schoolFee: revenue * SCHOOL_RATE,
    agencyFee: soldUnits * AGENCY_FEE_EOK,
  };
}

/** 두 한계선까지의 여유 (계획이 한계선에서 얼마나 떨어져 있는가, 음수면 이미 미달)
 *  - rateMarginZero/Repay: 계획 분양률 − 한계 분양률 (비율)
 *  - priceMarginZero/Repay: 계획 평당가 − 한계 평당가 (만원, 계획 분양률 기준)
 *  - fixedMargin: 고정비가 이만큼(억원) 늘면 상환 한계 = 기말현금 + 후순위 */
function margins(input, rate) {
  const m = {};
  for (const [key, target] of [["Zero", 0], ["Repay", -input.sub]]) {
    const r = breakEvenRate(input, input.price, target);
    const p = breakEvenPrice(input, rate, target);
    m["limitRate" + key] = r;
    m["limitPrice" + key] = p;
    m["rateMargin" + key] = r == null ? null : rate - r;
    m["priceMargin" + key] = p == null ? null : input.price - p;
  }
  m.fixedMargin = endCash(input, rate) + input.sub;
  return m;
}

const Calc = { totalArea, totalUnits, salesRevenue, endCash, dscr, ltv, calculate,
  breakdown, margins, cashSlope, repayable, breakEvenRate, breakEvenPrice, limits, sensitivity };
if (typeof module !== "undefined" && module.exports) module.exports = Calc;
if (typeof window !== "undefined") window.Calc = Calc;

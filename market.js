/* 시장 분석 계산 모듈 — 화면과 분리됨 (브라우저에서는 window.Market, Node에서는 require).
 * 공공데이터에서 받은 값만 사용하며, 값이 없으면 null을 돌려준다 (근거 없는 숫자를 만들지 않음).
 * 금액 단위: 만원(거래가·분양가·평당가), 면적: ㎡ / 평 */

const SQM_PER_PYEONG = 3.305785; // 1평 = 3.305785㎡

/** ㎡ → 평 */
function pyeong(sqm) { return sqm / SQM_PER_PYEONG; }

/** 전용 84㎡형 여부: 전용면적 84.00㎡ 이상 85.00㎡ 미만 */
function is84(sqm) { return sqm >= 84 && sqm < 85; }

/** 최근 12개월 계약월 목록 (현재 월 포함, 오래된 순) 예: ["202412", ..., "202511"] */
function months12(now = new Date()) {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** 단지명 정규화: 공백·괄호·특수문자 제거, 소문자, 끝의 '아파트' 제거 */
function normApt(name) {
  return String(name || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^0-9a-z가-힣]/g, "").replace(/아파트$/, "");
}

/** 같은 단지인지: 정규화한 이름이 같거나, 4자 이상 이름이 서로 포함되면 같은 단지로 본다 */
function sameComplex(a, b) {
  const x = normApt(a), y = normApt(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

/** 공공분양·신혼희망타운 등 공공 공급 단지인지 (민간 분양가와 섞이지 않게 구분) */
function isPublicHousing(name) { return /공공|신혼희망|행복주택|뉴홈/.test(String(name || "")); }

/** 우리 사업의 84㎡형 찾기. 전용 84~85㎡ 주택형이 정확히 하나일 때만 반환.
 *  types: [{ name, sqm, pyeong, units }], price: 평당가(만원)
 *  반환: { name, sqm, pyeong, priceEok(세대당 분양가, 억원) } 또는 null */
function ourHousehold84(types, price) {
  const c = types.filter(t => is84(t.sqm) && t.pyeong > 0);
  if (!c.length || !(price > 0)) return null;
  // 84㎡형이 여러 개(A·B)면 세대수 가중평균 공급평으로 본다
  const units = c.reduce((s, t) => s + (t.units || 1), 0);
  const pyeong = c.reduce((s, t) => s + t.pyeong * (t.units || 1), 0) / units;
  const sqm = c.reduce((s, t) => s + t.sqm * (t.units || 1), 0) / units;
  return { name: c.map(t => t.name).join("·"), sqm, pyeong, priceEok: pyeong * price / 10000 };
}

/** ② 잔금 여력: 84㎡ 신규 전세 평균 ÷ 우리 84㎡ 세대당 분양가
 *  rentMonths: [{ jeonse84: [보증금(만원)...] }] (받아온 달만), ourEok: 세대당 분양가(억원)
 *  반환: { n, avgDeposit(만원), ratio } 또는 null (전세 거래가 없거나 분양가가 없을 때) */
function jeonseCapacity(rentMonths, ourEok) {
  const all = rentMonths.flatMap(m => m.jeonse84 || []);
  if (!all.length || !(ourEok > 0)) return null;
  const avg = all.reduce((s, x) => s + x, 0) / all.length;
  return { n: all.length, avgDeposit: avg, ratio: avg / (ourEok * 10000) };
}

/** ③ 인근 신규 84㎡ 공급평당 분양가.
 *  complexes: [{ info:{name,date}, detail:{types:[{ty,sqm,ar,supply,amount}]} }]
 *  공급평당 분양가(만원) = 분양최고금액(만원) ÷ 공급면적(평). 분양최고금액이 없는 주택형은 뺀다.
 *  반환: { rows[], avg } (avg는 주택형 단순평균, 없으면 null) */
function nearbyPrice84(complexes, opts = {}) {
  const rows = [];
  for (const c of complexes) {
    if (!c.detail) continue;
    if (opts.since && c.info.date < opts.since) continue;            // 공고일이 기준일보다 오래된 단지 제외
    if (opts.privateOnly && isPublicHousing(c.info.name)) continue;  // 공공분양·신혼희망타운 제외
    for (const t of c.detail.types) {
      if (!is84(t.sqm) || !(t.amount > 0) || !(t.ar > 0)) continue;
      rows.push({ name: c.info.name, date: c.info.date, pub: isPublicHousing(c.info.name), ty: t.ty, sqm: t.sqm, ar: t.ar, pyeong: pyeong(t.ar),
        amount: t.amount, ppp: t.amount / pyeong(t.ar) });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const avg = rows.length ? rows.reduce((s, r) => s + r.ppp, 0) / rows.length : null;
  return { rows, avg };
}

/** ④ 분양권 웃돈 = 분양권 거래가 − 같은 단지 같은 주택형 분양가(분양최고금액).
 *  silvMonths: [{ trades:[{apt,ar,amount}] }] (입주권·해제 거래는 이미 빠진 상태)
 *  단지: 단지명 정규화 일치, 주택형: 전용면적 차이 0.05㎡ 이내. 같은 이름의 단지가 여럿이면 공고일이 최근인 단지.
 *  반환: { rows[], matched, unmatched, total } */
function premiums(silvMonths, complexes) {
  const trades = silvMonths.flatMap(m => m.trades || []);
  const sorted = [...complexes].filter(c => c.detail).sort((a, b) => b.info.date.localeCompare(a.info.date));
  const groups = new Map();
  let matched = 0;
  for (const tr of trades) {
    let hit = null;
    for (const c of sorted) {
      if (!sameComplex(tr.apt, c.info.name)) continue;
      const t = c.detail.types.find(x => x.amount > 0 && Math.abs(x.sqm - tr.ar) < 0.05);
      if (t) { hit = { c, t }; break; }
    }
    if (!hit) continue;
    matched++;
    const k = hit.c.info.id + "|" + hit.t.ty;
    if (!groups.has(k)) groups.set(k, { name: hit.c.info.name, ty: hit.t.ty, sqm: hit.t.sqm, price: hit.t.amount, sum: 0, n: 0 });
    const g = groups.get(k); g.sum += tr.amount; g.n++;
  }
  const rows = [...groups.values()].map(g => ({ name: g.name, ty: g.ty, sqm: g.sqm, price: g.price, n: g.n,
    avgDeal: g.sum / g.n, premium: g.sum / g.n - g.price, ratio: (g.sum / g.n - g.price) / g.price }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ko"));
  return { rows, matched, unmatched: trades.length - matched, total: trades.length };
}

/** ⑤ 1·2순위 미달 주택형 · 잔여세대.
 *  일반공급 세대수(주택형별 분양정보) 대비 1순위 접수건수 합(거주지역 전체)이 모자라면 1순위 미달,
 *  2순위 접수까지 합해도 모자란 만큼이 잔여세대. 접수 자료가 없는 주택형은 판정하지 않는다.
 *  반환: { rows[] (미달 주택형), checked(판정한 주택형 수), noRates(접수 자료 없는 주택형 수) } */
function shortages(complexes, since) {
  const rows = [];
  let checked = 0, noRates = 0, supplyChecked = 0, remainChecked = 0;
  for (const c of complexes) {
    if (!c.detail) continue;
    if (since && c.info.date < since) continue;
    for (const t of c.detail.types) {
      if (!(t.supply > 0)) continue;
      const rs = c.detail.rates.filter(r => r.ty === t.ty);
      if (!rs.length) { noRates++; continue; }
      checked++;
      const r1 = rs.filter(r => r.rank === 1).reduce((s, r) => s + r.req, 0);
      const r2 = rs.filter(r => r.rank === 2).reduce((s, r) => s + r.req, 0);
      supplyChecked += t.supply; remainChecked += Math.max(0, t.supply - r1 - r2);
      if (r1 >= t.supply) continue;
      rows.push({ name: c.info.name, date: c.info.date, ty: t.ty, sqm: t.sqm, amount: t.amount, supply: t.supply,
        req1: r1, req2: r2, rate1: r1 / t.supply, rate2: r2 / t.supply, remain: Math.max(0, t.supply - r1 - r2) });
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "ko"));
  // supplyChecked/remainChecked: 판정한 주택형의 일반공급 합과 잔여 합 (청약 단계 소진률 = 1 − 잔여 ÷ 공급)
  return { rows, checked, noRates, supplyChecked, remainChecked };
}

/** 시장 대비 여유 = 인근 신규 84㎡ 공급평당 평균 − 상환 한계 평당가 (만원)
 *  양수면 인근 신규 분양가가 우리 상환 한계보다 높다. 둘 중 하나라도 없으면 null */
function marketRoom(limitPrice, nearbyAvg) {
  if (limitPrice == null || nearbyAvg == null) return null;
  return nearbyAvg - limitPrice;
}

const Market = { SQM_PER_PYEONG, pyeong, is84, months12, normApt, sameComplex, ourHousehold84, jeonseCapacity,
  nearbyPrice84, premiums, shortages, marketRoom, isPublicHousing };
if (typeof module !== "undefined" && module.exports) module.exports = Market;
if (typeof window !== "undefined") window.Market = Market;

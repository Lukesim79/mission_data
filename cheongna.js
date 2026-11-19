/* 청라 레이크포레 — 원자료(02·03·06·07·01) 입력값 산출 모듈. 화면과 분리됨 (window.Cheongna / require).
 * 금액 단위: 백만원 (평당가만 만원). 앱 입력값(억원)으로 바꾸는 것은 preset()이 한다.
 * 모든 합계·파생값은 아래 원자료에서 계산하며, 숫자를 손으로 고쳐 쓰지 않는다. */

const Cheongna = (function () {
/* 03 분양계획(안) — 공급면적(평) 기준 희망 평당가 */
const TYPES = [
  { name: "59㎡A", sqm: 59.82, pyeong: 25.4, units: 168, hope: 1830, pdf: 465 },
  { name: "74㎡",  sqm: 74.55, pyeong: 31.2, units: 152, hope: 1790, pdf: 558 },
  { name: "84㎡A", sqm: 84.91, pyeong: 34.9, units: 196, hope: 1750, pdf: 611 },
  { name: "84㎡B", sqm: 84.96, pyeong: 35.3, units: 96,  hope: 1740, pdf: 614 },
];
const RETAIL = { units: 18, pyeong: 620, hope: 1650 };

/* 02 소요자금 — 금액이 있는 항목 (g: fixed 고정비 / offset 상쇄 / debt 금융비용 / sub 후순위 포함 여부는 아래 규칙) */
const ITEMS = [
  ["I. 토지비", "토지매입비", 86000], ["I. 토지비", "토지취득세", 4140], ["I. 토지비", "토지용역비", 1850], ["I. 토지비", "감정평가수수료", 96],
  ["II. 직접공사비", "직접공사비", 189000],
  ["III. 간접공사비", "설계비", 2980], ["III. 간접공사비", "감리비", 3420], ["III. 간접공사비", "예술장식품설치비", 311],
  ["III. 간접공사비", "철거공사비", 1240], ["III. 간접공사비", "인입공사비", 386], ["III. 간접공사비", "기타공사비", 402],
  ["IV. 제세공과", "보존등기비", 2640], ["IV. 제세공과", "보유세", 1180], ["IV. 제세공과", "상수도원인자부담금", 214],
  ["IV. 제세공과", "하수도원인자부담금", 586], ["IV. 제세공과", "광역교통시설부담금", 1490],
  ["V. 판매비와 관리비", "M/H 건립비", 1820], ["V. 판매비와 관리비", "M/H 임차비", 1150], ["V. 판매비와 관리비", "M/H 운영비", 760],
  ["V. 판매비와 관리비", "분양용역비", 140], ["V. 판매비와 관리비", "분양보증수수료", 1240], ["V. 판매비와 관리비", "중도금보증료", 690],
  ["V. 판매비와 관리비", "분양광고비", 1580], ["V. 판매비와 관리비", "분양대행수수료(근린상가)", 420], ["V. 판매비와 관리비", "입주관리비", 520],
  ["V. 판매비와 관리비", "용역수수료", 380], ["V. 판매비와 관리비", "세무법률수수료", 310], ["V. 판매비와 관리비", "자금신탁수수료", 1140],
  ["V. 판매비와 관리비", "시행사 운영비", 1080],
  ["VII. 시행사 대여금 상환", "시행사 대여금 상환", 6000],
  ["VIII. 이자상환적립계정", "이자상환적립계정 적립", 1872],
  ["IX. 금융비용", "이자비용 - 브릿지론", 3895], ["IX. 금융비용", "금융수수료 - 브릿지론", 1230], ["IX. 금융비용", "이자비용 - Tr-A 차입금", 18018],
  ["IX. 금융비용", "이자비용 - Tr-B 차입금", 4441], ["IX. 금융비용", "금융수수료 - Tr-A 차입금", 1575], ["IX. 금융비용", "금융수수료 - Tr-B 차입금", 500],
  ["IX. 금융비용", "금융수수료 - 미분양담보대출", 600],
];
const OFFSET_ITEM = "이자상환적립계정 적립"; // 유입에도 같은 금액 (01 Ⅲ-1)

/* 01·07 조건 */
const TERMS = {
  schoolRate: 0.008,          // 학교용지부담금: 총분양가 × 0.8%
  agencyPerUnit: 3,           // 분양대행수수료(아파트): 300만원/세대 = 3백만원
  reserveRate: 0.03,          // 사업예비비: 직접공사비의 3%
  directCost: 189000,
  midRatio: 0.6, midRate: 0.052, midMonths: 18, // 중도금이자후불제
  equity: 22000, interestIncome: 1450,          // 기타유입 (01 Ⅲ-2)
  retention: 42000, sponsorLoan: 6000,          // 후순위: 07 제9조 유보금 + 시행사 대여금
  pf: 130000,                                   // 본PF: Tr-A 105,000 + Tr-B 25,000
  pfCostItems: ["이자비용 - Tr-A 차입금", "이자비용 - Tr-B 차입금", "금융수수료 - Tr-A 차입금", "금융수수료 - Tr-B 차입금"],
};

const sum = a => a.reduce((s, x) => s + x, 0);
const val = name => (ITEMS.find(i => i[1] === name) || [0, 0, 0])[2];

/** 희망 분양가 기준 총분양가 (백만원) */
function revenue(types = TYPES, retail = RETAIL) {
  const apt = sum(types.map(t => t.pyeong * t.hope / 100 * t.units));
  const shop = retail.pyeong * retail.hope / 100;
  return { apt, shop, total: apt + shop, area: sum(types.map(t => t.pyeong * t.units)) };
}

/** 입력값 산출 — 공란 4개, 고정비·변동비·상쇄, 기타유입, 후순위, 본PF */
function derive() {
  const r = revenue();
  const units = sum(TYPES.map(t => t.units));
  const school = r.total * TERMS.schoolRate;                       // 변동비 (총분양가 = 아파트+근린)
  const agency = units * TERMS.agencyPerUnit;                      // 변동비 (612세대 전부 분양 시)
  const reserve = TERMS.directCost * TERMS.reserveRate;            // 고정비
  const mid = r.apt * TERMS.midRatio * TERMS.midRate * TERMS.midMonths / 12; // 상쇄 (아파트만 중도금 대상)
  const escrow = val(OFFSET_ITEM);                                 // 상쇄
  const listed = sum(ITEMS.map(i => i[2]));
  const fixed = listed - escrow + reserve;                         // 고정비 = 나머지 소요자금 + 금융비용 (후순위 포함)
  const financing = sum(ITEMS.filter(i => i[0] === "IX. 금융비용").map(i => i[2]));
  const other = TERMS.equity + TERMS.interestIncome;
  const sub = TERMS.retention + TERMS.sponsorLoan;
  const pfCost = sum(TERMS.pfCostItems.map(val));
  const variable = school + agency;
  const offset = mid + escrow;
  return { ...r, units, school, agency, reserve, mid, escrow, listed, fixed, financing, other, sub, pf: TERMS.pf, pfCost,
    variable, offset, totalInvest: fixed + variable + offset,
    avgHope: r.apt / r.area * 100 }; // 아파트 공급면적 가중평균 희망 평당가(만원)
}

/** 구분별 고정비 소계 (입력값 산출표용) */
function fixedByGroup() {
  const d = derive(), g = new Map();
  for (const [grp, name, v] of ITEMS) { if (name === OFFSET_ITEM) continue; g.set(grp, (g.get(grp) || 0) + v); }
  g.set("V. 판매비와 관리비", g.get("V. 판매비와 관리비") + d.reserve); // 사업예비비 합산
  return [...g.entries()].map(([grp, v]) => ({ grp, v }));
}

/** 적용 가정 (PM 판단) — 근거는 화면 '분양 가정의 근거' 장에 표시 */
const APPLIED = { price84: 1735, hope84: 1745, rate: 0.85 };

/** 앱 입력값(억원) — 희망 평당가는 아파트 가중평균. appliedPrice가 있으면 적용 평당가 */
function preset() {
  const d = derive();
  const k = APPLIED.price84 / APPLIED.hope84;
  const eok = x => Math.round(x / 100 * 1000) / 1000;
  return {
    name: "청라 레이크포레", site: "인천광역시 서해구",
    types: TYPES.map(t => [t.name, t.sqm, t.pyeong, t.units]),
    price: Math.round(d.avgHope * k), hope: Math.round(d.avgHope * 100) / 100, rate: APPLIED.rate * 100,
    retail: eok(d.shop), other: eok(d.other), fixed: eok(d.fixed), pf: eok(d.pf), pfCost: eok(d.pfCost), sub: eok(d.sub),
  };
}

/** 06 시공사 재무 · 07 도급계약 (책임준공 실효성 판단 근거) */
const BUILDER = {
  y2025: { sales: 876000, op: -18000, net: -29400, equity: 381000, debt: 531000, cash: 48000, netDebt: 483000, debtRatio: 268.0 },
  pfGuarantee: 420000, pfRatioPct: 110.2, completionSites: 23, rating: "BBB0 (2026.06 하향 검토)", rank: 27,
  contract: { price: 189000, retention: 42000, delayRate: 0.0005, delayCapRate: 0.10, graceMonths: 6 },
};

const api = { TYPES, RETAIL, ITEMS, TERMS, APPLIED, BUILDER, revenue, derive, fixedByGroup, preset };
return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = Cheongna;
if (typeof window !== "undefined") window.Cheongna = Cheongna;

// 시장 분석 계산 검산 (공공데이터 없이 합성 데이터로)
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./market.js");

test("12개월: 현재 월 포함, 연도 경계 처리", () => {
  const m = M.months12(new Date(2026, 1, 15)); // 2026-02
  assert.equal(m.length, 12);
  assert.equal(m[0], "202503");
  assert.equal(m[11], "202602");
});

test("84㎡형: 84.00 이상 85.00 미만", () => {
  assert.equal(M.is84(83.99), false);
  assert.equal(M.is84(84), true);
  assert.equal(M.is84(84.9724), true);
  assert.equal(M.is84(85), false);
});

test("단지명 정규화·동일 단지 판정", () => {
  assert.equal(M.sameComplex("해운대 경동리인뷰 2차", "해운대경동리인뷰2차"), true);
  assert.equal(M.sameComplex("더폴 디오션", "더폴디오션(주상복합)"), true);
  assert.equal(M.sameComplex("래미안", "래미안퍼스티지"), false); // 3글자 이하 포함 매칭은 안 함
  assert.equal(M.sameComplex("", "x"), false);
});

const types = [{ name: "59형", sqm: 59.9, pyeong: 25.6, units: 200 }, { name: "84형", sqm: 84.9, pyeong: 34.6, units: 320 }];

test("우리 84㎡ 세대당 분양가: 샘플 A 34.6평 × 2,420만원 = 8.373억", () => {
  const o = M.ourHousehold84(types, 2420);
  assert.equal(o.priceEok.toFixed(3), "8.373");
  assert.equal(M.ourHousehold84([types[0]], 2420), null);                    // 84형 없음
  // 84형이 둘(A·B)이면 세대수 가중평균 공급평: (34.9×196 + 35.3×96) ÷ 292 = 35.0315평
  const ab = M.ourHousehold84([{ name: "A", sqm: 84.91, pyeong: 34.9, units: 196 }, { name: "B", sqm: 84.96, pyeong: 35.3, units: 96 }], 1750);
  assert.equal(ab.pyeong.toFixed(4), "35.0315");
  assert.equal(ab.priceEok.toFixed(4), (35.03150685 * 1750 / 10000).toFixed(4));
});

test("신규 분양가: 기준일 이전 공고 · 공공분양 제외 옵션", () => {
  const t = [{ ty: "084A", sqm: 84.9, ar: 114.4, supply: 10, amount: 70000 }];
  const cs = [
    { info: { name: "민간 단지", date: "2026-05-01" }, detail: { types: t, rates: [] } },
    { info: { name: "OO 공공분양주택", date: "2026-06-01" }, detail: { types: t, rates: [] } },
    { info: { name: "옛 단지", date: "2023-01-01" }, detail: { types: t, rates: [] } },
  ];
  assert.equal(M.nearbyPrice84(cs).rows.length, 3);
  assert.equal(M.nearbyPrice84(cs, { since: "2024-01-01" }).rows.length, 2);
  assert.equal(M.nearbyPrice84(cs, { since: "2024-01-01", privateOnly: true }).rows.length, 1);
  assert.equal(M.isPublicHousing("인천가정2 신혼희망타운"), true);
});

test("잔금 여력: 전세 평균 ÷ 세대당 분양가", () => {
  const r = M.jeonseCapacity([{ jeonse84: [40000, 50000] }, { jeonse84: [60000] }], 8.373);
  assert.equal(r.n, 3);
  assert.equal(r.avgDeposit, 50000);
  assert.equal((r.ratio * 100).toFixed(1), "59.7");
  assert.equal(M.jeonseCapacity([{ jeonse84: [] }], 8.373), null);
});

const cx = (id, name, date, ts, rates = []) => ({ info: { id, pblanc: id, name, date }, detail: { types: ts, rates } });
const t84 = { ty: "084.9000A", sqm: 84.9, ar: 108.0, supply: 100, amount: 80000 };

test("인근 신규 84㎡ 공급평당가 = 분양최고금액 ÷ 공급평", () => {
  const r = M.nearbyPrice84([cx("1", "가나다", "2026-01-01", [t84, { ty: "059", sqm: 59.9, ar: 80, supply: 5, amount: 50000 }])]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].ppp.toFixed(0), String(Math.round(80000 / (108 / 3.305785))));
  assert.equal(r.avg, r.rows[0].ppp);
  assert.equal(M.nearbyPrice84([]).avg, null);
});

test("분양권 웃돈 = 거래가 − 같은 단지 분양가, 단지 불일치는 제외", () => {
  const cs = [cx("1", "가나다 퍼스트", "2026-01-01", [t84])];
  const r = M.premiums([{ trades: [
    { apt: "가나다퍼스트", ar: 84.9, amount: 90000 },
    { apt: "가나다퍼스트", ar: 84.9, amount: 100000 },
    { apt: "다른단지", ar: 84.9, amount: 70000 },
    { apt: "가나다퍼스트", ar: 59.9, amount: 60000 }, // 주택형 불일치
  ] }], cs);
  assert.equal(r.total, 4); assert.equal(r.matched, 2); assert.equal(r.unmatched, 2);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].avgDeal, 95000);
  assert.equal(r.rows[0].premium, 15000);
  assert.equal((r.rows[0].ratio * 100).toFixed(2), "18.75");
});

test("1·2순위 미달: 접수 합이 일반공급에 못 미치면 잔여세대", () => {
  const rates = [
    { ty: "084.9000A", rank: 1, reside: "해당지역", req: 30, supply: 100 },
    { ty: "084.9000A", rank: 1, reside: "기타지역", req: 20, supply: 100 },
    { ty: "084.9000A", rank: 2, reside: "해당지역", req: 10, supply: 100 },
    { ty: "059", rank: 1, reside: "해당지역", req: 90, supply: 50 },
  ];
  const cs = [cx("1", "가나다", "2026-01-01", [t84, { ty: "059", sqm: 59.9, ar: 80, supply: 50, amount: 50000 }, { ty: "074", sqm: 74.9, ar: 90, supply: 10, amount: 60000 }], rates)];
  const r = M.shortages(cs);
  assert.equal(r.checked, 2); assert.equal(r.noRates, 1); // 074는 접수 자료 없음 → 판정 안 함
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].req1, 50); assert.equal(r.rows[0].req2, 10);
  assert.equal(r.rows[0].remain, 40);
  assert.equal(r.rows[0].rate1, 0.5);
});

test("시장 대비 여유 = 인근 평균 − 상환 한계 평당가", () => {
  assert.equal(M.marketRoom(1934, 2500), 566);
  assert.equal(M.marketRoom(null, 2500), null);
  assert.equal(M.marketRoom(1934, null), null);
});

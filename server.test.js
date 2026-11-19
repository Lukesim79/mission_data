// 서버 모듈 검산 — 실제 공공데이터 호출 없이 가짜 fetch로 (인증키가 없어도 통과)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pfcache-"));
const region = require("./region.js");
const rtms = require("./rtms.js");
const applyhome = require("./applyhome.js");
const { cached } = require("./cache.js");

const KEY = "TEST-KEY-123";
const mock = body => ({ fetchImpl: async () => ({ text: async () => body }), key: KEY });
const row = o => ({ sgg_cd: "350", umd_cd: "000", ri_cd: "00", region_cd: "2635000000", locatadd_nm: "부산광역시 해운대구", ...o });
const regionJson = rows => JSON.stringify({ StanReginCd: [{ head: [{ totalCount: rows.length }, { RESULT: { resultCode: "INFO-0", resultMsg: "NOMAL SERVICE" } }] }, { row: rows }] });

test("지역: 정확히 하나로 맞으면 시군구 5자리 코드", async () => {
  const r = await region.lookupRegion("부산광역시 해운대구", mock(regionJson([row({}), row({ umd_cd: "101", region_cd: "2635010100", locatadd_nm: "부산광역시 해운대구 우동" })])));
  assert.deepEqual(r, { status: "ok", name: "부산광역시 해운대구", code: "26350" });
});

test("지역: 이름이 모호하면 후보 목록 (통과 아님)", async () => {
  const rows = [row({}), row({ sgg_cd: "110", region_cd: "2611000000", locatadd_nm: "부산광역시 중구" }),
    row({ sgg_cd: "170", region_cd: "2617000000", locatadd_nm: "부산광역시 동구" })];
  const r = await region.lookupRegion("구", mock(regionJson(rows)));
  assert.equal(r.status, "candidates");
  assert.equal(r.candidates.length, 3);
  assert.equal(r.code, undefined);
});

test("지역: 시도 단위 · 없는 이름 · 키 없음", async () => {
  const sido = { sgg_cd: "000", region_cd: "2600000000", locatadd_nm: "부산광역시" };
  assert.equal((await region.lookupRegion("부산광역시", mock(regionJson([row(sido)])))).status, "level");
  const none = JSON.stringify({ StanReginCd: [{ head: [{ RESULT: { resultCode: "INFO-200", resultMsg: "NO DATA" } }] }] });
  assert.equal((await region.lookupRegion("없는구", mock(none))).status, "none");
  assert.equal((await region.lookupRegion("부산광역시 해운대구", { key: "" })).status, "nokey");
});

test("오류 응답·반환값에 인증키가 새지 않는다", async () => {
  const failing = { key: KEY, fetchImpl: async url => { throw new Error("connect ECONNREFUSED " + url); } };
  const r = await region.lookupRegion("부산광역시 해운대구", failing);
  assert.ok(!JSON.stringify(r).includes(KEY));
  await assert.rejects(rtms.fetchMonth("rent", "26350", "202510", failing), e => !e.message.includes(KEY));
});

const xml = (items, total = items.length, code = "000") =>
  `<response><header><resultCode>${code}</resultCode></header><body><items>${items.map(o => "<item>" + Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join("") + "</item>").join("")}</items><totalCount>${total}</totalCount></body></response>`;

test("분양권: 해제·입주권 제외, 구분이 빈 거래는 분양권", () => {
  const s = rtms.summarizeSilv([
    { aptNm: "가", excluUseAr: "84.9", dealAmount: "95,815", dealDay: "3", ownershipGbn: "", cdealType: "", cdealDay: "" },
    { aptNm: "나", dealAmount: "80,000", ownershipGbn: "입", cdealType: "", cdealDay: "" },
    { aptNm: "다", dealAmount: "70,000", ownershipGbn: "", cdealType: "O", cdealDay: "20251101" },
    { aptNm: "라", dealAmount: "60,000", ownershipGbn: "분", cdealType: "", cdealDay: "" },
  ]);
  assert.equal(s.count, 2); assert.equal(s.rights, 1); assert.equal(s.cancelled, 1);
  assert.equal(s.trades[0].amount, 95815);
});

test("전월세: 월세·갱신 제외, 신규 전세만, 84㎡ 보증금 목록", () => {
  const s = rtms.summarizeRent([
    { deposit: "40,000", monthlyRent: "0", contractType: "신규", excluUseAr: "84.97" },  // 사용
    { deposit: "30,000", monthlyRent: "0", contractType: "갱신", excluUseAr: "84.97" },  // 갱신
    { deposit: "10,000", monthlyRent: "80", contractType: "신규", excluUseAr: "84.97" }, // 월세
    { deposit: "50,000", monthlyRent: "0", contractType: "신규", excluUseAr: "59.9" },   // 84 아님
    { deposit: "20,000", monthlyRent: "0", contractType: "", excluUseAr: "84.5" },       // 구분 없음
  ]);
  assert.equal(s.total, 5); assert.equal(s.monthly, 1); assert.equal(s.renewal, 1); assert.equal(s.unknownType, 1);
  assert.equal(s.newJeonse, 2);
  assert.deepEqual(s.jeonse84, [40000]);
});

test("실거래: 페이지를 모아 한 달치로, 게이트웨이 오류는 안내 문구", async () => {
  let call = 0;
  const pages = [xml([{ deposit: "1", monthlyRent: "0", contractType: "신규", excluUseAr: "84.1" }], 2), xml([{ deposit: "2", monthlyRent: "0", contractType: "신규", excluUseAr: "84.2" }], 2)];
  const r = await rtms.fetchMonth("rent", "26350", "202510", { key: KEY, fetchImpl: async () => ({ text: async () => pages[call++] }) });
  assert.equal(r.total, 2);
  const gw = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
  await assert.rejects(rtms.fetchMonth("silv", "26350", "202510", mock(gw)), /등록되지 않은 인증키/);
  await assert.rejects(rtms.fetchMonth("rent", "26350", "2025", mock("")), /형식/);
});

test("청약홈: 단지 목록(중복 제거·최신순)과 주택형별 정보·경쟁률", async () => {
  const list = JSON.stringify({ matchCount: 3, data: [
    { HOUSE_MANAGE_NO: 1, PBLANC_NO: 1, HOUSE_NM: "구", HSSPLY_ADRES: "부산광역시 해운대구 A", RCRIT_PBLANC_DE: "2024-01-01", TOT_SUPLY_HSHLDCO: 10 },
    { HOUSE_MANAGE_NO: 2, PBLANC_NO: 2, HOUSE_NM: "신", HSSPLY_ADRES: "부산광역시 해운대구 B", RCRIT_PBLANC_DE: "2026-01-01", TOT_SUPLY_HSHLDCO: 20 },
    { HOUSE_MANAGE_NO: 2, PBLANC_NO: 2, HOUSE_NM: "신", HSSPLY_ADRES: "부산광역시 해운대구 B", RCRIT_PBLANC_DE: "2026-01-01", TOT_SUPLY_HSHLDCO: 20 },
  ] });
  const l = await applyhome.listComplexes("부산광역시 해운대구", mock(list));
  assert.deepEqual(l.map(c => c.name), ["신", "구"]);
  const mdl = JSON.stringify({ data: [{ HOUSE_TY: "084.8860A", SUPLY_AR: "107.7959", SUPLY_HSHLDCO: 171, LTTOT_TOP_AMOUNT: "77,200" }] });
  const cmp = JSON.stringify({ data: [{ HOUSE_TY: "084.8860A", SUBSCRPT_RANK_CODE: 1, RESIDE_SENM: "해당지역", REQ_CNT: "31", SUPLY_HSHLDCO: 59 }] });
  const d = await applyhome.complexDetail("2", "2", { key: KEY, fetchImpl: async url => ({ text: async () => (url.includes("Mdl") ? mdl : cmp) }) });
  assert.equal(d.types[0].amount, 77200); assert.equal(d.types[0].sqm, 84.886); assert.equal(d.types[0].supply, 171);
  assert.equal(d.rates[0].req, 31);
  await assert.rejects(applyhome.listComplexes("x", mock(JSON.stringify({ code: -4, msg: "등록되지 않은 인증키 입니다." }))), /등록되지 않은 인증키/);
});

test("청약홈: 서해구 조회 시 옛 '서구' 공고도 받고 검단구 쪽 단지는 제외 (2026-07-01 개편)", async () => {
  const urls = [];
  const row = (id, nm, adr, de) => ({ HOUSE_MANAGE_NO: id, PBLANC_NO: id, HOUSE_NM: nm, HSSPLY_ADRES: adr, RCRIT_PBLANC_DE: de, TOT_SUPLY_HSHLDCO: 10 });
  const fetchImpl = async url => {
    urls.push(decodeURIComponent(url));
    const sh = urls[urls.length - 1].includes("인천광역시 서해구");
    const data = sh ? [row(1, "청라 새단지", "인천광역시 서해구 청라동 1", "2026-10-22")]
      : [row(2, "검암 옛단지", "인천광역시 서구 경서동 4", "2026-05-15"), row(3, "검단 단지", "인천광역시 서구 검단신도시 AB1BL", "2026-06-12")];
    return { text: async () => JSON.stringify({ matchCount: data.length, data }) };
  };
  const l = await applyhome.listComplexes("인천광역시 서해구", { key: KEY, fetchImpl });
  assert.deepEqual(l.map(c => c.name), ["청라 새단지", "검암 옛단지"]);          // 검단 단지는 빠진다
  assert.ok(urls.some(u => u.includes("::LIKE]=인천광역시 서구")));              // 옛 이름으로도 조회했다
});

test("하루 캐시: 같은 조회는 다시 부르지 않고, 실패는 저장하지 않는다", async () => {
  let calls = 0;
  const p = () => { calls++; return Promise.resolve({ v: calls }); };
  const a = await cached("k1", p), b = await cached("k1", p);
  assert.equal(calls, 1); assert.equal(a.cached, false); assert.equal(b.cached, true); assert.deepEqual(b.value, { v: 1 });
  await cached("k2", p, () => false); await cached("k2", p, () => false);
  assert.equal(calls, 3);
  let c2 = 0; // 동시에 들어와도 한 번만
  const slow = () => new Promise(r => setTimeout(() => { c2++; r(1); }, 20));
  await Promise.all([cached("k3", slow), cached("k3", slow)]);
  assert.equal(c2, 1);
});

test("서버: 지역이 확인되지 않으면 실거래를 부르지 않는다", async () => {
  const { handleApi } = require("./api-handler.js");
  const r = await handleApi(new URL("http://x/api/trades?name=&kind=rent&ym=202510"));
  assert.equal(r.status, "region");
});

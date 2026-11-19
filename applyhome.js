/* 청약홈 — 분양정보 · 경쟁률 (서버 전용)
 * 근거: 「청약홈 분양정보 조회 서비스」 「청약홈 청약접수 경쟁률 및 특별공급 신청현황 조회 서비스」 기술문서
 *   분양정보: ApplyhomeInfoDetailSvc/v1  getAPTLttotPblancDetail(단지) · getAPTLttotPblancMdl(주택형별)
 *   경쟁률:   ApplyhomeInfoCmpetRtSvc/v1 getAPTLttotPblancCmpet(주택형·순위·거주지역별 접수건수)
 *   조건: cond[필드::LIKE|EQ|GTE]=값, page, perPage, serviceKey. 응답은 JSON, 필드명은 대문자 */
const { ApiError, httpGet, requireKey } = require("./datago.js");

const INFO = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/";
const CMPET = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/";
const PER_PAGE = 500;
const MAX_PAGES = 10;

const num = s => { const n = parseFloat(String(s ?? "").replace(/,/g, "")); return isNaN(n) ? 0 : n; };
const lower = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

/** odcloud 조회 (페이지를 모두 모아 행 배열로 반환). conds: [["HSSPLY_ADRES","LIKE","값"], ...] */
async function odcloud(base, fn, conds, opts = {}) {
  const key = requireKey(opts.key);
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = conds.map(([f, op, v]) => `cond%5B${f}%3A%3A${op}%5D=${encodeURIComponent(v)}`).join("&");
    const text = await httpGet(`${base}${fn}?page=${page}&perPage=${PER_PAGE}&${q}&serviceKey=${key}`, opts);
    let j;
    try { j = JSON.parse(text); } catch { throw new ApiError("청약홈 응답을 읽지 못했습니다 (인증키 또는 활용신청 확인 필요)"); }
    if (typeof j.code === "number" && j.code < 0) throw new ApiError(`청약홈 오류: ${String(j.msg || j.code).slice(0, 80)}`);
    const data = Array.isArray(j.data) ? j.data : [];
    rows.push(...data.map(lower));
    if (!data.length || rows.length >= (j.matchCount ?? j.totalCount ?? 0)) break;
  }
  return rows;
}

/** 오늘 기준 N년 전 날짜 (YYYY-MM-DD) */
function yearsAgo(n, now = new Date()) {
  const d = new Date(now); d.setFullYear(d.getFullYear() - n);
  return d.toLocaleDateString("sv");
}

/* 2026-07-01 인천 서구 → 서해구·검단구 개편 대응.
 * 청약홈 옛 공고(개편 전)의 공급위치는 "인천광역시 서구"로 남아 있어 "서해구"만 찾으면 개편 전 공고가 빠진다.
 * 서해구를 조회하면 옛 "인천광역시 서구" 공고도 함께 받고, 검단구 쪽 동(검단신도시 등)은 제외한다. */
const RENAMED = {
  "인천광역시 서해구": { alias: ["인천광역시 서구"], excludeAddr: /검단|마전|불로|원당|당하|왕길|오류동|금곡|대곡|백석|아라동|동양동/ },
};

/** 공급위치에 지역명이 들어간 최근 5년 APT (화면에서 신규 분양가·미달은 3년만, 웃돈 매칭은 5년 전체 사용) 단지 목록 (모집공고일 최신순) */
async function listComplexes(regionName, opts = {}) {
  const ren = RENAMED[regionName];
  const names = ren ? [regionName, ...ren.alias] : [regionName];
  const rows = [];
  for (const nm of names) {
    const part = await odcloud(INFO, "getAPTLttotPblancDetail",
      [["HSSPLY_ADRES", "LIKE", nm], ["RCRIT_PBLANC_DE", "GTE", yearsAgo(5, opts.now)]], opts);
    rows.push(...(nm === regionName ? part : part.filter(r => !ren.excludeAddr.test(String(r.hssply_adres || "") + String(r.house_nm || "")))));
  }
  const seen = new Set(), out = [];
  for (const r of rows) {
    const id = String(r.house_manage_no), pb = String(r.pblanc_no), k = id + "|" + pb;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id, pblanc: pb, name: r.house_nm || "", address: r.hssply_adres || "",
      date: r.rcrit_pblanc_de || "", total: num(r.tot_suply_hshldco), moveIn: r.mvn_prearnge_ym || "" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** 단지 하나의 주택형별 분양정보 + 경쟁률.
 *  types: [{ty, sqm(전용), ar(공급면적㎡), supply(일반공급), amount(분양최고금액 만원)}]
 *  rates: [{ty, rank(1|2), reside, req(접수건수), supply}] — 순위·거주지역별 행 */
async function complexDetail(id, pblanc, opts = {}) {
  const eq = [["HOUSE_MANAGE_NO", "EQ", id], ["PBLANC_NO", "EQ", pblanc]];
  const [mdl, cmp] = await Promise.all([
    odcloud(INFO, "getAPTLttotPblancMdl", eq, opts),
    odcloud(CMPET, "getAPTLttotPblancCmpet", eq, opts),
  ]);
  const types = mdl.map(r => ({ ty: String(r.house_ty || "").trim(), sqm: num(r.house_ty), ar: num(r.suply_ar),
    supply: num(r.suply_hshldco), amount: num(r.lttot_top_amount) }));
  const rates = cmp.map(r => ({ ty: String(r.house_ty || "").trim(), rank: num(r.subscrpt_rank_code),
    reside: r.reside_senm || r.reside_secd || "", req: num(r.req_cnt), supply: num(r.suply_hshldco) }));
  return { types, rates };
}

module.exports = { odcloud, yearsAgo, listComplexes, complexDetail };

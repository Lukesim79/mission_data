/* 국토교통부 실거래가 — 분양권전매 · 전월세 (서버 전용)
 * 근거: 「아파트 분양권전매 실거래가 자료」 「아파트 전월세 실거래가 자료」 기술문서
 *   요청: serviceKey, LAWD_CD(법정동코드 앞 5자리), DEAL_YMD(계약년월 6자리), pageNo, numOfRows
 *   응답: XML <item> 목록, resultCode 000 = 정상. 거래금액·보증금은 만원 단위 문자열("95,815")
 * 한 번에 한 달씩 부른다. */
const { ApiError, gatewayError, httpGet, requireKey } = require("./datago.js");

const URLS = {
  silv: "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade",
  rent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
};
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const won = s => { const n = parseFloat(String(s ?? "").replace(/,/g, "")); return isNaN(n) ? 0 : n; };

/** XML 본문 → { resultCode, totalCount, items[] } (각 item은 {태그: 값(공백 제거)}) */
function parseXml(text) {
  const one = tag => { const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1]).trim() : ""; };
  const items = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const o = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = decode(f[2]).trim();
    items.push(o);
  }
  return { resultCode: one("resultCode"), totalCount: parseInt(one("totalCount"), 10) || 0, items };
}

/** 분양권전매 한 달치 정리.
 *  - 해제(cdealType 또는 cdealDay가 있는 거래)는 제외
 *  - 구분(ownershipGbn)이 '입'(입주권)이면 제외, 비어 있거나 '분'이면 분양권으로 집계
 *  반환: { count, cancelled, rights, unknown, trades[{apt,umd,ar,amount,day,floor}] } */
function summarizeSilv(items) {
  const out = { count: 0, cancelled: 0, rights: 0, unknown: 0, trades: [] };
  for (const r of items) {
    if (r.cdealType || r.cdealDay) { out.cancelled++; continue; }
    // 실제 응답(2025-10 등 확인): 분양권 거래는 구분이 비어 있고, 입주권만 '입'으로 표시된다
    if (r.ownershipGbn === "입") { out.rights++; continue; }
    if (r.ownershipGbn && r.ownershipGbn !== "분") { out.unknown++; continue; }
    out.count++;
    out.trades.push({ apt: r.aptNm || "", umd: r.umdNm || "", ar: parseFloat(r.excluUseAr) || 0,
      amount: won(r.dealAmount), day: parseInt(r.dealDay, 10) || 0, floor: r.floor || "" });
  }
  return out;
}

/** 전월세 한 달치 정리.
 *  - total: 전월세 전체 건수 (표①)
 *  - 월세(월세금액 > 0)는 제외
 *  - 갱신(계약구분 '갱신' 또는 갱신요구권 사용)은 제외, 계약구분이 '신규'인 전세만 사용
 *  - jeonse84: 전용 84㎡형(84.00 이상 85.00 미만) 신규 전세 보증금(만원) 목록 */
function summarizeRent(items) {
  const out = { total: items.length, monthly: 0, renewal: 0, unknownType: 0, newJeonse: 0, jeonse84: [] };
  for (const r of items) {
    if (won(r.monthlyRent) > 0) { out.monthly++; continue; }
    if (r.contractType === "갱신" || r.useRRRight) { out.renewal++; continue; }
    if (r.contractType !== "신규") { out.unknownType++; continue; }
    out.newJeonse++;
    const ar = parseFloat(r.excluUseAr) || 0;
    if (ar >= 84 && ar < 85) out.jeonse84.push(won(r.deposit));
  }
  return out;
}

/** 한 달치 조회. kind: "silv"(분양권) | "rent"(전월세). 실패하면 ApiError */
async function fetchMonth(kind, code, ym, opts = {}) {
  if (!URLS[kind]) throw new ApiError("지원하지 않는 종류입니다");
  if (!/^\d{5}$/.test(code) || !/^\d{6}$/.test(ym)) throw new ApiError("지역코드 또는 계약월 형식이 올바르지 않습니다");
  const key = requireKey(opts.key);
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const text = await httpGet(`${URLS[kind]}?serviceKey=${key}&LAWD_CD=${code}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${PAGE_SIZE}`, opts);
    const gw = gatewayError(text);
    if (gw) throw new ApiError(gw);
    const p = parseXml(text);
    if (p.resultCode === "03") break; // No Data
    if (p.resultCode !== "000") throw new ApiError(p.resultCode ? `공공데이터 오류 (${p.resultCode})` : "공공데이터 응답을 읽지 못했습니다");
    all.push(...p.items);
    if (!p.items.length || all.length >= p.totalCount) break;
  }
  return kind === "silv" ? summarizeSilv(all) : summarizeRent(all);
}

module.exports = { parseXml, summarizeSilv, summarizeRent, fetchMonth };

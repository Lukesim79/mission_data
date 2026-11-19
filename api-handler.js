/* API 처리 로직 — 로컬 서버(local-server.js)와 Vercel 서버리스 함수(api/*.js)가 함께 쓴다. 서버 전용.
 * 인증키는 서버 안에서만 쓰이며 응답에 포함되지 않는다. 브라우저는 지역 '이름'만 보내고,
 * 지역코드는 서버가 매번 다시 확인한다.
 *   GET /api/region?name=              시군구 법정동코드 확인
 *   GET /api/trades?name=&kind=&ym=    실거래 한 달치 (kind: silv 분양권전매 | rent 전월세)
 *   GET /api/apply/list?name=          공급위치에 지역명이 들어간 최근 3년 청약홈 단지
 *   GET /api/apply/complex?name=&id=&pblanc=   단지의 주택형별 분양가 · 경쟁률
 * 같은 조회는 하루 동안 캐시한다. */
const { lookupRegion, loadKey, normalizeName } = require("./region.js");
const { cached } = require("./cache.js");
const { ApiError } = require("./datago.js");
const rtms = require("./rtms.js");
const applyhome = require("./applyhome.js");

/** 지역 확인 (하루 캐시, 정상 확인된 것만 저장) */
async function resolveRegion(name) {
  const n = normalizeName(name);
  if (!n) return { value: { status: "empty" } };
  return cached(`region|${n}`, () => lookupRegion(n), v => v.status === "ok");
}

/** 지역이 정확히 확인된 경우에만 { name, code } 반환, 아니면 그 결과를 오류로 던진다 */
async function requireRegion(name) {
  const { value } = await resolveRegion(name);
  if (value.status !== "ok") throw Object.assign(new ApiError("지역이 확인되지 않았습니다"), { region: value });
  return value;
}

/** 라우트 처리 → JSON 객체. url은 URL 객체 */
async function handleApi(url) {
  const q = k => url.searchParams.get(k) || "";
  const key = loadKey();
  try {
    if (url.pathname === "/api/region") return (await resolveRegion(q("name"))).value;

    const region = await requireRegion(q("name")); // 아래 조회는 모두 서버가 확인한 지역으로만 호출
    if (url.pathname === "/api/trades") {
      const kind = q("kind"), ym = q("ym");
      const r = await cached(`trades|${kind}|${region.code}|${ym}`, () => rtms.fetchMonth(kind, region.code, ym, { key }));
      return { status: "ok", region, kind, ym, data: r.value, fetchedAt: r.fetchedAt, cached: r.cached };
    }
    if (url.pathname === "/api/apply/list") {
      const r = await cached(`apply-list|v2|${region.name}`, () => applyhome.listComplexes(region.name, { key }));
      return { status: "ok", region, complexes: r.value, fetchedAt: r.fetchedAt, cached: r.cached };
    }
    if (url.pathname === "/api/apply/complex") {
      const id = q("id"), pblanc = q("pblanc");
      // 브라우저가 보낸 단지가 이 지역의 단지 목록에 있는지 서버가 다시 확인
      const list = (await cached(`apply-list|v2|${region.name}`, () => applyhome.listComplexes(region.name, { key }))).value;
      const info = list.find(c => c.id === id && c.pblanc === pblanc);
      if (!info) return { status: "error", message: "이 지역의 단지 목록에 없는 단지입니다" };
      const r = await cached(`apply-complex|${id}|${pblanc}`, () => applyhome.complexDetail(id, pblanc, { key }));
      return { status: "ok", region, complex: info, detail: r.value, fetchedAt: r.fetchedAt, cached: r.cached };
    }
    return { status: "error", message: "알 수 없는 요청입니다" };
  } catch (e) {
    if (e.region) return { status: "region", region: e.region };
    // ApiError는 안전한 문구만 담고 있다. 그 밖의 오류는 내용을 숨긴다.
    return { status: "error", message: e instanceof ApiError ? e.message : "서버 처리 중 오류가 발생했습니다" };
  }
}

/** Vercel 서버리스 함수용 어댑터: (req, res) → JSON 응답 */
async function vercelHandler(req, res) {
  const body = await handleApi(new URL(req.url, "http://localhost"));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = { handleApi, vercelHandler };

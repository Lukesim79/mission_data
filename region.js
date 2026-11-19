/* 사업대상지 → 시군구 법정동코드(5자리) 조회 — 서버 전용 모듈.
 * 근거: 행정안전부 행정표준코드 법정동코드 Open API 활용가이드 (StanReginCd / getStanReginCdList)
 *   요청: ServiceKey, type, pageNo, numOfRows(최대 1,000), flag=Y, locatadd_nm(지역주소명)
 *   응답: region_cd(10자리) = 시도 2 + 시군구 3 + 읍면동 3 + 리 2
 *   시군구 단위 행 = 시군구코드(sgg_cd) ≠ 000 이고 읍면동코드(umd_cd) = 000, 리코드(ri_cd) = 00
 * 인증키(DATA_GO_KR_KEY)는 이 모듈과 server.js 안에서만 쓰며, 브라우저로 보내거나 출력하지 않는다. */
const fs = require("fs");
const path = require("path");

const BASE = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList";
const MAX_CANDIDATES = 20;

/** .env.local에서 인증키를 읽는다 (환경변수 우선). 없으면 "" 반환. 값은 어디에도 출력하지 않는다. */
function loadKey(dir = __dirname) {
  if (process.env.DATA_GO_KR_KEY) return process.env.DATA_GO_KR_KEY.trim();
  try {
    const text = fs.readFileSync(path.join(dir, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATA_GO_KR_KEY\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch { /* 파일 없음 → 키 없음 */ }
  return "";
}

/** 입력한 지역명 정리: 앞뒤 공백 제거, 연속 공백을 하나로 */
function normalizeName(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

/** 인증키 URL 인코딩: 이미 인코딩된 키(% 포함)는 그대로, 아니면 인코딩 */
function encodeKey(key) {
  return key.includes("%") ? key : encodeURIComponent(key);
}

/** JSON 어디에 있든 특정 이름의 값을 찾는다 (응답 중첩 구조 차이 대비) */
function findKey(obj, key) {
  if (obj == null || typeof obj !== "object") return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** API 응답(JSON)을 { resultCode, rows }로 정리. 형식이 다르면 null */
function parseResponse(json) {
  const result = findKey(json, "RESULT");
  const resultCode = result && (result.resultCode ?? findKey(result, "resultCode"));
  if (!resultCode) return null;
  const rows = findKey(json, "row");
  return { resultCode: String(resultCode), rows: Array.isArray(rows) ? rows : [] };
}

/** 행 → 시군구 단위 여부 */
function isSigungu(r) {
  return String(r.sgg_cd) !== "000" && String(r.umd_cd) === "000" && String(r.ri_cd) === "00";
}

/** 행 → 시군구 법정동코드 5자리 (시도 2 + 시군구 3). region_cd 앞 5자리와 같다. */
function sigunguCode(r) {
  const rc = String(r.region_cd || "");
  if (rc.length >= 5) return rc.slice(0, 5);
  return String(r.sido_cd).padStart(2, "0") + String(r.sgg_cd).padStart(3, "0");
}

/** 행 목록에서 결과 판정.
 *  - ok: 시군구 단위이고 이름이 정확히 같은 행이 딱 하나일 때만
 *  - level: 이름은 정확히 맞지만 시군구보다 큰/작은 단위 (예: 시도)
 *  - candidates: 그 외, 시군구 단위 후보 목록 (이름에 입력이 들어간 것)
 *  - none: 후보도 없음 */
function classify(name, rows) {
  const exact = rows.filter(r => r.locatadd_nm === name);
  const exactSgg = exact.filter(isSigungu);
  if (exactSgg.length === 1) {
    const r = exactSgg[0];
    return { status: "ok", name: r.locatadd_nm, code: sigunguCode(r) };
  }
  if (exact.length && !exactSgg.length) {
    return { status: "level", message: "시군구 단위까지 입력해 주세요 (예: 부산광역시 해운대구)" };
  }
  const seen = new Set();
  const candidates = [];
  for (const r of rows) {
    if (!isSigungu(r) || !String(r.locatadd_nm).includes(name)) continue;
    const key = r.locatadd_nm + "|" + sigunguCode(r);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name: r.locatadd_nm, code: sigunguCode(r) });
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (!candidates.length) return { status: "none", message: "일치하는 지역을 찾지 못했습니다" };
  return { status: "candidates", candidates: candidates.slice(0, MAX_CANDIDATES), total: candidates.length };
}

/** 지역명 조회. 반환값에는 인증키가 들어가지 않는다.
 *  opts.key: 인증키(테스트용 주입), opts.fetchImpl: fetch 대체(테스트용) */
async function lookupRegion(rawName, opts = {}) {
  const name = normalizeName(rawName);
  if (!name) return { status: "empty" };
  const key = opts.key !== undefined ? opts.key : loadKey();
  if (!key) return { status: "nokey", message: "서버에 인증키(DATA_GO_KR_KEY)가 설정되지 않았습니다" };
  const doFetch = opts.fetchImpl || fetch;

  const url = `${BASE}?ServiceKey=${encodeKey(key)}&type=json&pageNo=1&numOfRows=1000&flag=Y&locatadd_nm=${encodeURIComponent(name)}`;
  let text;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10000) });
    text = await res.text();
  } catch {
    // 오류 메시지에 URL(=키)이 섞일 수 있어 내용을 버리고 고정 문구만 돌려준다
    return { status: "error", message: "공공데이터 서버에 연결하지 못했습니다" };
  }
  let json;
  try { json = JSON.parse(text); }
  catch { return { status: "error", message: "공공데이터 응답을 읽지 못했습니다 (인증키가 유효하지 않거나 아직 활성화 전일 수 있음)" }; }

  const parsed = parseResponse(json);
  if (!parsed) return { status: "error", message: "공공데이터 응답 형식이 예상과 다릅니다" };
  if (parsed.resultCode === "INFO-200") return { status: "none", message: "일치하는 지역을 찾지 못했습니다" };
  if (parsed.resultCode !== "INFO-0") return { status: "error", message: `공공데이터 오류 (${parsed.resultCode})` };
  return classify(name, parsed.rows);
}

module.exports = { loadKey, normalizeName, encodeKey, parseResponse, isSigungu, sigunguCode, classify, lookupRegion };

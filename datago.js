/* 공공데이터포털 호출 공통 도우미 — 서버 전용.
 * 인증키는 요청 URL에만 쓰이고, 오류·반환값에는 절대 넣지 않는다. */
const { encodeKey } = require("./region.js");

/** 사용자에게 보여도 안전한 오류 (인증키·URL을 담지 않음) */
class ApiError extends Error {}

/** 게이트웨이(data.go.kr) 오류 코드 → 안내 문구 (각 기술문서의 에러 코드 표 기준) */
const GATEWAY = {
  "01": "제공기관 서비스 오류 (Application Error)", "02": "제공기관 서비스 오류 (DB Error)",
  "04": "제공기관 서비스 오류 (HTTP Error)", "05": "제공기관 서비스 시간 초과",
  "10": "요청 파라미터 오류 (ServiceKey 누락)", "11": "필수 요청 파라미터 누락", "12": "서비스가 없거나 폐기됨",
  "20": "서비스 접근 거부 — 이 API의 활용신청 승인이 필요합니다",
  "22": "일일 요청 한도 초과", "30": "등록되지 않은 인증키",
  "31": "인증키 사용기간 만료", "32": "등록되지 않은 도메인/IP",
};

/** XML 응답에서 게이트웨이 오류가 있으면 안내 문구, 없으면 null */
function gatewayError(text) {
  const m = text.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/);
  if (!m) return null;
  const code = m[1].padStart(2, "0");
  return `${GATEWAY[code] || "공공데이터 오류"} (${code})`;
}

/** GET 요청 → 본문 텍스트. 네트워크 오류는 고정 문구로 바꿔 던진다 (URL에 키가 있어 원문 노출 금지) */
async function httpGet(url, opts = {}) {
  const doFetch = opts.fetchImpl || fetch;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeout || 15000) });
    return await res.text();
  } catch {
    throw new ApiError("공공데이터 서버에 연결하지 못했습니다");
  }
}

/** key가 없으면 오류 */
function requireKey(key) {
  if (!key) throw new ApiError("서버에 인증키(DATA_GO_KR_KEY)가 설정되지 않았습니다");
  return encodeKey(key);
}

module.exports = { ApiError, gatewayError, httpGet, requireKey };

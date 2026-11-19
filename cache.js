/* 하루 캐시 — 서버 전용.
 * 같은 조회(키)는 같은 날 안에는 다시 부르지 않는다. 성공한 결과만 저장한다.
 * 파일 이름은 조회 키의 해시이며, 인증키는 조회 키에 포함하지 않는다. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dir = () => process.env.CACHE_DIR || (process.env.VERCEL ? "/tmp/pf-cache" : path.join(__dirname, ".cache"));
const inflight = new Map(); // 같은 조회가 동시에 들어오면 한 번만 부른다

/** 오늘 날짜 (YYYY-MM-DD, 서버 로컬 시간) */
const today = () => new Date().toLocaleDateString("sv");

const fileOf = key => path.join(dir(), crypto.createHash("sha1").update(key).digest("hex") + ".json");

/** 오늘 저장된 항목 읽기 (없거나 날짜가 지났으면 null) */
function read(key) {
  try {
    const o = JSON.parse(fs.readFileSync(fileOf(key), "utf8"));
    if (o.day === today()) return o;
  } catch { /* 없음 */ }
  return null;
}

function write(key, value, fetchedAt) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileOf(key), JSON.stringify({ day: today(), fetchedAt, value }));
  } catch { /* 캐시 저장 실패는 조회 결과에 영향 없음 */ }
}

/** 캐시를 거쳐 조회. producer()가 만든 값이 shouldCache를 통과할 때만 저장한다.
 *  반환: { value, fetchedAt(ISO), cached(boolean) } */
async function cached(key, producer, shouldCache = () => true) {
  const hit = read(key);
  if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const value = await producer();
    const fetchedAt = new Date().toISOString();
    if (shouldCache(value)) write(key, value, fetchedAt);
    return { value, fetchedAt, cached: false };
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

module.exports = { cached, today };

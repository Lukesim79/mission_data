// 인증키 문자열 검색 — 소스·산출물 전체에서 .env.local의 키 값이 나오는 파일 수를 센다 (값은 출력하지 않음)
const fs = require("fs"), path = require("path");
const { loadKey } = require("./region.js");
const key = loadKey();
if (!key) { console.log("인증키 없음 — 검색할 값이 없습니다"); process.exit(0); }
const SKIP = new Set(["node_modules", ".git", ".cache"]);
let files = 0, hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (e.name === ".env.local") continue; // 키가 있어야 하는 유일한 파일
    files++;
    let t; try { t = fs.readFileSync(p); } catch { continue; }
    if (t.includes(key) || t.includes(encodeURIComponent(key))) hits.push(path.relative(__dirname, p));
  }
})(__dirname);
console.log(`인증키 문자열 검색: ${files}개 파일 중 ${hits.length}건`);
if (hits.length) { console.log(hits.join("\n")); process.exit(1); }

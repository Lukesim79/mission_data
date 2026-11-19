// 빌드: index.html + calc.js + market.js를 하나의 dist/index.html로 합치고, 배포 전 점검을 수행한다.
// 외부 도구 없이 Node 내장 모듈만 사용. 인증키(.env.local)가 없어도 통과한다.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SCRIPTS = ["calc.js", "market.js", "cheongna.js"]; // 브라우저에서 쓰는 계산 파일 (서버 전용 파일은 포함하지 않음)
const CHAPTERS = ["사업 개요", "시장 분석", "사업수지", "자금조달과 상환",
  "민감도", "리스크와 완화 방안", "확인하지 못한 것"];

const errors = [];
for (const f of SCRIPTS) if (!html.includes(`<script src="${f}"></script>`)) errors.push(`index.html에 ${f} 스크립트 태그가 없습니다`);
for (const c of CHAPTERS) if (!html.includes(c)) errors.push(`장 제목 누락: ${c}`);
if (errors.length) { console.error("빌드 실패\n- " + errors.join("\n- ")); process.exit(1); }

// 계산 파일 인라인
let out = html;
for (const f of SCRIPTS) {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  out = out.replace(`<script src="${f}"></script>`, () => `<script>\n${code}\n</script>`);
}

// 모든 인라인 스크립트 문법 검사
const re = /<script>([\s\S]*?)<\/script>/g;
let m, n = 0;
while ((m = re.exec(out))) {
  n++;
  try { new vm.Script(m[1]); } catch (e) { console.error(`스크립트 #${n} 문법 오류: ${e.message}`); process.exit(1); }
}

// 안전 점검: 인증키 값이 산출물에 들어가면 실패 (값은 출력하지 않는다)
try {
  const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const k = (env.match(/^\s*DATA_GO_KR_KEY\s*=\s*(.*?)\s*$/m) || [])[1];
  if (k && out.includes(k)) { console.error("빌드 실패: 산출물에 인증키 값이 들어 있습니다"); process.exit(1); }
} catch { /* .env.local 없음 → 점검할 키 없음 */ }
if (/api\.odcloud\.kr|apis\.data\.go\.kr|serviceKey/.test(out)) { console.error("빌드 실패: 브라우저 코드에 공공데이터 주소/키 파라미터가 있습니다 (서버에서만 호출해야 함)"); process.exit(1); }

fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "dist", "index.html"), out);
console.log(`빌드 완료: dist/index.html (${(out.length / 1024).toFixed(1)} KB, 스크립트 ${n}개 검사 통과, 7개 장 확인, 인증키·공공데이터 주소 없음 확인)`);

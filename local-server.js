/* 로컬 서버 (Node 내장 모듈만 사용): npm start
 * - 정적 파일: index.html, calc.js, market.js, cheongna.js 만 제공 (.env.local · .cache 등은 절대 제공하지 않음)
 * - /api/* 는 api-handler.js 가 처리한다. (Vercel 배포에서는 api/*.js 함수가 같은 로직을 쓴다) */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadKey } = require("./region.js");
const { handleApi } = require("./api-handler.js");

const PORT = Number(process.env.PORT) || 5173;
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/calc.js": ["calc.js", "text/javascript; charset=utf-8"],
  "/market.js": ["market.js", "text/javascript; charset=utf-8"],
  "/cheongna.js": ["cheongna.js", "text/javascript; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const body = await handleApi(url);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(body));
  }
  const hit = STATIC[url.pathname];
  if (!hit) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "Content-Type": hit[1], "Cache-Control": "no-store" });
  res.end(fs.readFileSync(path.join(__dirname, hit[0])));
});

server.listen(PORT, () => {
  // 키 값은 출력하지 않고 설정 여부만 알린다
  console.log(`http://localhost:${PORT}  (인증키 ${loadKey() ? "설정됨" : "없음"})`);
});

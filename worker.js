// 실습일지 도우미 – 무료 AI 중계 서버 (Cloudflare Worker + Workers AI)
//
// 쓰는 법
// 1) Cloudflare 대시보드 > Workers AI > "Build and deploy a Llama 3 Worker"로 Worker를 만들어요.
//    (이렇게 만들면 Workers AI 연결(바인딩 이름: AI)이 자동으로 들어가요)
// 2) "Edit code"에서 원래 코드를 전부 지우고 이 파일 내용을 붙여넣은 뒤 Deploy.
// 3) Worker 주소(https://○○○.workers.dev)를 index.html의 FREE_AI.endpoint에 넣어요.
//
// 무료 플랜은 하루 10,000 뉴런까지 무료예요(일지 약 30~40건). 넘으면 요금이 나가지 않고 그날만 실패해요.
//
// 방문자 수를 쓰려면 KV를 하나 연결해요 (없어도 일지 쓰기는 그대로 돼요)
// 4) Cloudflare 대시보드 > 저장소 및 데이터베이스(Storage & Databases) > KV > 만들기, 이름: sw-journal-counter
// 5) 이 Worker > 설정(Settings) > 바인딩(Bindings) > 추가 > KV 네임스페이스
//    변수 이름: COUNTER, 네임스페이스: sw-journal-counter 선택 > 배포
//
// 나만 보는 방문 통계(방문자 수 + 시·도/도시별)를 보려면 비밀번호를 하나 정해요
// 6) 이 Worker > 설정(Settings) > 변수 및 비밀(Variables and Secrets) > 추가
//    유형: 비밀(Secret), 변수 이름: ADMIN_KEY, 값: 내가 정한 비밀번호 > 배포
// 7) https://○○○.workers.dev/stats 를 열고 그 비밀번호를 넣으면 통계가 보여요.
//    이 비밀번호는 이 파일에 적지 마세요. worker.js를 GitHub에 올려도 비밀번호는 드러나지 않아요.

const MODELS = [
  '@cf/openai/gpt-oss-120b',                  // 기본: 한국어 품질 좋고 저렴
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'  // 기본 모델이 실패하면 예비
];
const PROMPT_HEAD = '당신은 사회복지현장실습 실습생의 실습일지 작성을 돕는 조력자입니다.';
const MAX_PROMPT_CHARS = 12000;
const PER_IP_GAP_SEC = 10;   // 같은 IP에서 연속 요청 최소 간격
const PER_IP_DAILY = 30;     // 같은 IP 하루 최대 요청 (서버 인스턴스별 대략치)

// 블로그 글: 네이버 블로그 RSS에서 카테고리나 제목에 아래 단어가 들어간 글만 골라 보여줘요
const BLOG_ID = 'monteroylife';
const BLOG_KEYWORDS = ['사회복지'];
const BLOG_CACHE_SEC = 1800; // 30분마다 새 글 확인

// 허용할 사이트: GitHub Pages(*.github.io), 로컬 파일 테스트(null), localhost
// 나만 쓰게 막고 싶으면 isAllowedOrigin 안을 내 주소만 허용하도록 바꾸면 돼요.
// 개인 도메인을 연결하면 여기에 추가하고 다시 Deploy 해 주세요. 예: ['silseup.kr']
const EXTRA_HOSTS = [];
function isAllowedOrigin(origin) {
  if (origin === 'null') return true; // 내 컴퓨터에서 index.html을 더블클릭해서 열었을 때
  try {
    const host = new URL(origin).hostname;
    if (EXTRA_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true;
    return host.endsWith('.github.io') || host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

const hits = new Map(); // ip -> { day, last, count }
function checkLimit(ip) {
  const now = Date.now();
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜 기준
  let h = hits.get(ip);
  if (!h || h.day !== day) { h = { day, last: 0, count: 0 }; hits.set(ip, h); }
  if (now - h.last < PER_IP_GAP_SEC * 1000) return 'gap';
  if (h.count >= PER_IP_DAILY) return 'daily';
  h.last = now; h.count += 1;
  if (hits.size > 5000) hits.clear();
  return null;
}

function extractText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  const c = r.choices && r.choices[0];
  if (c && c.message && typeof c.message.content === 'string') return c.message.content;
  if (c && typeof c.text === 'string') return c.text;
  if (typeof r.output_text === 'string') return r.output_text;
  if (Array.isArray(r.output)) {
    return r.output
      .filter(o => o && o.type === 'message')
      .flatMap(o => o.content || [])
      .map(p => (p && (p.text || p.output_text)) || '')
      .join('');
  }
  if (r.result) return extractText(r.result);
  return '';
}

const isQuotaError = e => /4006|daily free allocation|neuron/i.test(String((e && e.message) || e));

async function runModel(env, model, prompt) {
  const base = { messages: [{ role: 'user', content: prompt }], max_tokens: 4096, temperature: 0.8 };
  if (model.includes('gpt-oss')) {
    try {
      return extractText(await env.AI.run(model, { ...base, reasoning: { effort: 'low' } }));
    } catch (e) {
      if (isQuotaError(e)) throw e;
      return extractText(await env.AI.run(model, base)); // reasoning 옵션을 못 받는 경우 다시 시도
    }
  }
  return extractText(await env.AI.run(model, base));
}

const VERSION = '2026-10-04b';
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// ── 방문자 수·지역 (KV: COUNTER) ──
// 하루에 KV 키 하나(v:날짜)에 숫자만 모아요: 방문자 수, 시·도별, 도시별, 나라별.
// IP 주소나 방문자 한 명 한 명의 기록은 저장하지 않아요.
// 위치는 Cloudflare가 IP로 추정한 값이라 대략치예요(휴대폰 데이터는 통신사 위치로 잡히기도 해요).
const KR_CODE = { '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '50': '세종', '41': '경기', '42': '강원', '51': '강원', '43': '충북', '44': '충남', '45': '전북', '52': '전북', '46': '전남', '47': '경북', '48': '경남', '49': '제주' };
const KR_NAME = [['seoul', '서울'], ['busan', '부산'], ['daegu', '대구'], ['incheon', '인천'], ['daejeon', '대전'], ['ulsan', '울산'], ['sejong', '세종'], ['gyeonggi', '경기'], ['gangwon', '강원'],
  ['chungcheongbuk', '충북'], ['chungbuk', '충북'], ['north chungcheong', '충북'], ['chungcheongnam', '충남'], ['chungnam', '충남'], ['south chungcheong', '충남'],
  ['jeollabuk', '전북'], ['jeonbuk', '전북'], ['north jeolla', '전북'], ['jeollanam', '전남'], ['jeonnam', '전남'], ['south jeolla', '전남'],
  ['gyeongsangbuk', '경북'], ['gyeongbuk', '경북'], ['north gyeongsang', '경북'], ['gyeongsangnam', '경남'], ['gyeongnam', '경남'], ['south gyeongsang', '경남'], ['jeju', '제주'], ['gwangju', '광주']];
const KR_CITY = { suwon: '수원', yongin: '용인', seongnam: '성남', goyang: '고양', bucheon: '부천', ansan: '안산', anyang: '안양', namyangju: '남양주', hwaseong: '화성', pyeongtaek: '평택', uijeongbu: '의정부', siheung: '시흥', paju: '파주', gimpo: '김포', gwangmyeong: '광명', hanam: '하남', gunpo: '군포', osan: '오산', icheon: '이천', yangju: '양주', guri: '구리', anseong: '안성', pocheon: '포천', uiwang: '의왕', yeoju: '여주', dongducheon: '동두천', gwacheon: '과천', yangpyeong: '양평', gapyeong: '가평',
  cheongju: '청주', chungju: '충주', cheonan: '천안', asan: '아산', jeonju: '전주', gunsan: '군산', iksan: '익산', changwon: '창원', gimhae: '김해', jinju: '진주', yangsan: '양산', geoje: '거제', pohang: '포항', gumi: '구미', gyeongju: '경주', andong: '안동', wonju: '원주', chuncheon: '춘천', gangneung: '강릉', suncheon: '순천', yeosu: '여수', mokpo: '목포', seogwipo: '서귀포' };
function placeOf(cf) {
  cf = cf || {};
  const country = String(cf.country || '').toUpperCase() || '??';
  if (country !== 'KR') return { country, region: '해외', city: '' };
  const rawRegion = String(cf.region || '').toLowerCase();
  let region = KR_CODE[String(cf.regionCode || '').replace(/^KR-/i, '')] || '';
  if (!region) { const hit = KR_NAME.find(([k]) => rawRegion.includes(k)); region = hit ? hit[1] : '지역 모름'; }
  const rawCity = String(cf.city || '').trim();
  const cityKey = rawCity.toLowerCase().replace(/[-\s](si|gun|gu|city)$/, '').trim();
  let city = KR_CITY[cityKey] || rawCity;
  if (!city || KR_NAME.some(([k, v]) => v === region && cityKey === k)) city = ''; // 서울·부산처럼 시·도 이름과 같으면 생략
  return { country, region, city };
}
const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };

const visitSeen = new Map(); // ip -> day (같은 IP는 하루 한 번만 셈, 메모리에만 잠깐 두고 저장하지 않아요)
async function visit(url, env, ip, cf) {
  if (!env.COUNTER) return { error: 'no_kv' };
  const day = kstDay();
  if (url.searchParams.get('hit') !== '1' || visitSeen.get(ip) === day) return { ok: true };
  visitSeen.set(ip, day);
  if (visitSeen.size > 20000) visitSeen.clear();
  const p = placeOf(cf);
  try {
    const key = 'v:' + day;
    const d = (await env.COUNTER.get(key, { type: 'json' })) || { n: 0, r: {}, c: {}, k: {} };
    d.n += 1;
    bump(d.r, p.region);
    if (p.city && (d.c[p.region + ' ' + p.city] || Object.keys(d.c).length < 300)) bump(d.c, p.region + ' ' + p.city);
    bump(d.k, p.country);
    await env.COUNTER.put(key, JSON.stringify(d), { metadata: { n: d.n } });
  } catch (e) { /* 무료 KV 쓰기 한도(하루 1,000번)를 넘으면 그날은 더 세지 않아요 */ }
  return { ok: true };
}

// ── 나만 보는 방문 통계 (/stats) ──
// Worker > 설정 > 변수 및 비밀(Variables and Secrets)에 ADMIN_KEY(비밀번호)를 넣어야 열려요.
const keyFails = new Map(); // ip -> { at, n } 비밀번호를 여러 번 틀리면 잠깐 막아요
async function stats(env, range) {
  const keys = []; let cursor;
  do {
    const r = await env.COUNTER.list({ prefix: 'v:', cursor });
    keys.push(...r.keys); cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  const legacy = +(await env.COUNTER.get('total')) || 0; // 예전 방식으로 센 숫자
  const now = Date.now(), today = kstDay(now), yesterday = kstDay(now - 86400e3);
  const from = kstDay(now - (range - 1) * 86400e3);
  const days = keys.map(k => ({ day: k.name.slice(2), n: (k.metadata && +k.metadata.n) || 0 })).sort((a, b) => (a.day < b.day ? -1 : 1));
  const recent = days.filter(d => d.day >= from);
  const regions = {}, cities = {}, countries = {}, daily = {};
  await Promise.all(recent.map(async d => {
    const v = await env.COUNTER.get('v:' + d.day, { type: 'json' });
    if (!v) return;
    daily[d.day] = v.n;
    for (const [k, n] of Object.entries(v.r || {})) regions[k] = (regions[k] || 0) + n;
    for (const [k, n] of Object.entries(v.c || {})) cities[k] = (cities[k] || 0) + n;
    for (const [k, n] of Object.entries(v.k || {})) countries[k] = (countries[k] || 0) + n;
  }));
  const sum = days.reduce((s, d) => s + d.n, 0);
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const dayN = d => daily[d] ?? (days.find(x => x.day === d) || {}).n ?? 0;
  const series = [];
  for (let i = range - 1; i >= 0; i--) { const d = kstDay(now - i * 86400e3); series.push([d, dayN(d)]); }
  return {
    total: legacy + sum, today: dayN(today), yesterday: dayN(yesterday),
    rangeTotal: series.reduce((s, x) => s + x[1], 0), range, series,
    regions: top(regions, 20), cities: top(cities, 20), countries: top(countries, 10), since: days.length ? days[0].day : today
  };
}

const STATS_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>방문 통계 · 실습일지 도우미</title>
<style>
:root{--bg:#f6f4ee;--card:#fff;--ink:#1b2a24;--muted:#6b6a62;--line:#e4e0d6;--accent:#23634f;--weak:#e3efe9}
@media (prefers-color-scheme:dark){:root{--bg:#121614;--card:#1b211e;--ink:#e8ece9;--muted:#9aa39e;--line:#2c3430;--accent:#6cc0a6;--weak:#1c2f29}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;word-break:keep-all}
.wrap{max-width:720px;margin:0 auto;padding:20px 16px 40px}h1{font-size:22px;margin:4px 0 16px}h2{font-size:17px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:14px}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center}.nums b{display:block;font-size:28px;line-height:1.2}.nums span{color:var(--muted);font-size:14px}
input,button,select{font:inherit;border-radius:10px;border:1px solid var(--line);padding:10px 12px;background:var(--card);color:var(--ink)}
button{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700;cursor:pointer}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid var(--line)}.bars i{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:1px}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:4px}
.rank div{display:grid;grid-template-columns:7.5em 1fr 3em;gap:8px;align-items:center;margin:6px 0;font-size:15px}.rank s{display:block;height:12px;background:var(--weak);border-radius:6px;overflow:hidden;text-decoration:none}.rank s i{display:block;height:100%;background:var(--accent)}
.rank em{font-style:normal;text-align:right;color:var(--muted)}.note{color:var(--muted);font-size:14px}.err{color:#b3261e}.link{background:none;border:none;color:var(--accent);padding:0;font-weight:600;text-decoration:underline}
</style></head><body><div class="wrap">
<h1>방문 통계 <span class="note">· 나만 보는 화면</span></h1>
<div id="login" class="card"><h2>비밀번호</h2><div class="row"><input id="key" type="password" placeholder="ADMIN_KEY" autocomplete="current-password" style="flex:1;min-width:180px"><button id="go">보기</button></div><p id="msg" class="note"></p></div>
<div id="out" hidden></div>
</div><script>
var $=function(s){return document.querySelector(s)};var range=30;
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function getKey(){try{return localStorage.getItem("swj-admin")||""}catch(e){return ""}}
function setKey(k){try{k?localStorage.setItem("swj-admin",k):localStorage.removeItem("swj-admin")}catch(e){}}
function rank(list,total){if(!list.length)return '<p class="note">아직 기록이 없어요.</p>';var max=list[0][1]||1;return '<div class="rank">'+list.map(function(x){return '<div><span>'+esc(x[0])+'</span><s><i style="width:'+Math.max(2,Math.round(x[1]/max*100))+'%"></i></s><em>'+x[1]+'</em></div>'}).join("")+'</div>'}
function draw(d){var max=Math.max.apply(null,d.series.map(function(x){return x[1]}).concat([1]));
$("#out").innerHTML='<div class="card nums"><div><b>'+d.total.toLocaleString()+'</b><span>전체</span></div><div><b>'+d.today+'</b><span>오늘</span></div><div><b>'+d.yesterday+'</b><span>어제</span></div></div>'+
'<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">최근 '+d.range+'일 · '+d.rangeTotal.toLocaleString()+'명</h2><select id="range"><option value="7">7일</option><option value="30">30일</option><option value="90">90일</option></select></div>'+
'<div class="bars">'+d.series.map(function(x){return '<i title="'+x[0]+' · '+x[1]+'명" style="height:'+Math.round(x[1]/max*100)+'%"></i>'}).join("")+'</div><div class="axis"><span>'+d.series[0][0].slice(5)+'</span><span>'+d.series[d.series.length-1][0].slice(5)+'</span></div></div>'+
'<div class="card"><h2>시·도별 (최근 '+d.range+'일)</h2>'+rank(d.regions)+'</div>'+
'<div class="card"><h2>도시별 (최근 '+d.range+'일, 상위 20)</h2>'+rank(d.cities)+'</div>'+
'<p class="note">같은 기기는 하루 한 번만 세요. 위치는 IP로 추정한 대략치예요. 휴대폰 데이터로 들어오면 통신사 위치(서울·경기 등)로 잡히기도 해요. '+d.since+'부터 모은 기록이에요.</p>'+
'<p><button class="link" id="out-btn">이 기기에서 비밀번호 지우기</button></p>';
$("#out").hidden=false;$("#login").hidden=true;$("#range").value=String(d.range);
$("#range").onchange=function(){range=+this.value;load(getKey())};$("#out-btn").onclick=function(){setKey("");location.reload()}}
function load(k){if(!k)return;$("#msg").textContent="불러오는 중…";
fetch("/stats/data?range="+range,{headers:{"X-Admin-Key":k},cache:"no-store"}).then(function(r){return r.json().then(function(j){return [r.status,j]})}).then(function(a){
if(a[0]===200){setKey(k);draw(a[1])}else{$("#login").hidden=false;$("#out").hidden=true;$("#msg").innerHTML='<span class="err">'+esc(a[1].message||"열 수 없어요")+'</span>'}}).catch(function(){$("#msg").innerHTML='<span class="err">불러오지 못했어요. 잠시 후 다시 해 주세요.</span>'})}
$("#go").onclick=function(){load($("#key").value.trim())};$("#key").onkeydown=function(e){if(e.key==="Enter")$("#go").click()};
load(getKey());
</script></body></html>`;

// ── 블로그 글 (네이버 블로그 RSS) ──
const decode = s => String(s || '')
  .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .trim();
function parseRss(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const get = tag => { const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(m[1]); return r ? decode(r[1]) : ''; };
    const link = get('link').replace(/\?.*$/, '');
    const text = get('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const d = new Date(get('pubDate'));
    return {
      title: get('title'), link, category: get('category'),
      date: isNaN(d) ? '' : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
      desc: text.length > 90 ? text.slice(0, 90) + '…' : text
    };
  }).filter(p => p.title && /^https:\/\//.test(p.link));
}
let blogMem = null; // { at, body }
async function blogPosts(env) {
  if (blogMem && Date.now() - blogMem.at < BLOG_CACHE_SEC * 1000) return blogMem.body;
  if (env.COUNTER) {
    try { const c = await env.COUNTER.get('blog-cache', { type: 'json' }); if (c && Date.now() - c.at < BLOG_CACHE_SEC * 1000) { blogMem = c; return c.body; } } catch (e) {}
  }
  const res = await fetch(`https://rss.blog.naver.com/${BLOG_ID}.xml`, { headers: { 'User-Agent': 'Mozilla/5.0 (sw-journal)' } });
  if (!res.ok) throw new Error('rss ' + res.status);
  const all = parseRss(await res.text());
  const posts = all.filter(p => BLOG_KEYWORDS.some(k => p.category.includes(k) || p.title.includes(k))).slice(0, 30);
  const body = { posts, blog: `https://blog.naver.com/${BLOG_ID}`, total: all.length };
  blogMem = { at: Date.now(), body };
  if (env.COUNTER) { try { await env.COUNTER.put('blog-cache', JSON.stringify(blogMem), { expirationTtl: 86400 }); } catch (e) {} }
  return body;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      // 예상 못 한 오류도 내용을 보여줘서 원인을 찾을 수 있게
      return new Response(JSON.stringify({ error: 'exception', message: String((e && e.stack) || e).slice(0, 500), version: VERSION }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};

async function handle(request, env) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (origin && isAllowedOrigin(origin)) cors['Access-Control-Allow-Origin'] = origin;
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/stats') {
        return new Response(STATS_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
      }
      if (path === '/stats/data') {
        const priv = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
        const say = (obj, status) => new Response(JSON.stringify(obj), { status, headers: priv });
        if (!env.ADMIN_KEY) return say({ error: 'no_key', message: 'Worker 설정에 ADMIN_KEY(비밀번호)가 아직 없어요.' }, 503);
        if (!env.COUNTER) return say({ error: 'no_kv', message: 'KV(COUNTER)가 연결되어 있지 않아요.' }, 503);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const f = keyFails.get(ip);
        if (f && f.n >= 10 && Date.now() - f.at < 3600e3) return say({ error: 'locked', message: '비밀번호를 여러 번 틀려서 1시간 동안 막혔어요.' }, 429);
        if ((request.headers.get('X-Admin-Key') || '') !== String(env.ADMIN_KEY)) {
          keyFails.set(ip, { at: Date.now(), n: (f && Date.now() - f.at < 3600e3 ? f.n : 0) + 1 });
          return say({ error: 'wrong_key', message: '비밀번호가 맞지 않아요.' }, 401);
        }
        keyFails.delete(ip);
        const range = [7, 30, 90].includes(+url.searchParams.get('range')) ? +url.searchParams.get('range') : 30;
        return say(await stats(env, range), 200);
      }
      if (path === '/visit' || path === '/blog') {
        if (!origin || !isAllowedOrigin(origin)) return json({ error: 'forbidden' }, 403);
        if (path === '/visit') return json(await visit(url, env, request.headers.get('CF-Connecting-IP') || 'unknown', request.cf));
        try { return json(await blogPosts(env)); }
        catch (e) { return json({ error: 'blog_failed', posts: [], blog: `https://blog.naver.com/${BLOG_ID}`, detail: String((e && e.message) || e).slice(0, 120) }, 502); }
      }
      return json({ ok: true, service: 'sw-journal-ai', version: VERSION, ai: !!env.AI, counter: !!env.COUNTER, stats: !!env.ADMIN_KEY });
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!origin || !isAllowedOrigin(origin)) return json({ error: 'forbidden', message: '허용되지 않은 사이트에서 온 요청이에요.' }, 403);
    if (!env.AI) return json({ error: 'no_binding', message: 'Worker에 Workers AI 연결(바인딩 이름: AI)이 없어요.' }, 500);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request', message: '요청 형식이 잘못됐어요.' }, 400); }
    const prompt = String((body && body.prompt) || '');
    if (!prompt.startsWith(PROMPT_HEAD) || prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: 'bad_prompt', message: '실습일지 작성 요청만 받을 수 있어요.' }, 400);
    }

    const limit = checkLimit(request.headers.get('CF-Connecting-IP') || 'unknown');
    if (limit === 'gap') return json({ error: 'rate_limited', message: `잠깐만요! ${PER_IP_GAP_SEC}초 뒤에 다시 눌러 주세요.` }, 429);
    if (limit === 'daily') return json({ error: 'daily_limit', message: '오늘 이 기기에서 쓸 수 있는 횟수를 다 썼어요. 내일 다시 써 주세요.' }, 429);

    let lastErr = '';
    for (const model of MODELS) {
      try {
        const text = (await runModel(env, model, prompt)).trim();
        if (text.length > 30) return json({ text, model });
        lastErr = 'empty response';
      } catch (e) {
        if (isQuotaError(e)) {
          return json({ error: 'quota', message: '오늘 무료 AI 사용량이 다 찼어요. 내일 다시 하거나 “프롬프트 복사”로 써 주세요.' }, 429);
        }
        lastErr = String((e && e.message) || e);
      }
    }
    return json({ error: 'ai_failed', message: 'AI가 답을 못 했어요. 잠시 후 다시 시도해 주세요.', detail: lastErr.slice(0, 200) }, 502);
}

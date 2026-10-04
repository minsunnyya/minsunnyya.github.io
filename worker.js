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

const VERSION = '2026-10-04';
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 방문자 수 (KV: COUNTER) ──
const visitSeen = new Map(); // ip -> day (같은 IP는 하루 한 번만 셈, 인스턴스별 대략치)
async function visit(url, env, ip) {
  if (!env.COUNTER) return { error: 'no_kv' };
  const day = kstDay();
  let total = +(await env.COUNTER.get('total')) || 0;
  let today = +(await env.COUNTER.get('day:' + day)) || 0;
  if (url.searchParams.get('hit') === '1' && visitSeen.get(ip) !== day) {
    visitSeen.set(ip, day);
    if (visitSeen.size > 20000) visitSeen.clear();
    total += 1; today += 1;
    try {
      await env.COUNTER.put('total', String(total));
      await env.COUNTER.put('day:' + day, String(today), { expirationTtl: 3 * 86400 });
    } catch (e) { /* 무료 KV 쓰기 한도(하루 1,000번)를 넘으면 숫자만 보여줘요 */ }
  }
  return { total, today };
}

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
      if (path === '/visit' || path === '/blog') {
        if (!origin || !isAllowedOrigin(origin)) return json({ error: 'forbidden' }, 403);
        if (path === '/visit') return json(await visit(url, env, request.headers.get('CF-Connecting-IP') || 'unknown'));
        try { return json(await blogPosts(env)); }
        catch (e) { return json({ error: 'blog_failed', posts: [], blog: `https://blog.naver.com/${BLOG_ID}`, detail: String((e && e.message) || e).slice(0, 120) }, 502); }
      }
      return json({ ok: true, service: 'sw-journal-ai', version: VERSION, ai: !!env.AI, counter: !!env.COUNTER });
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

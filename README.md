# 실습일지 도우미

사회복지현장실습 일지를 AI로 쉽게 쓰는 웹 페이지예요.
**로그인이 없어요.** 모든 기록은 쓰는 사람의 브라우저에만 저장돼요. 서버는 AI 중계용 Cloudflare Worker 하나뿐이고, 무료 플랜으로 돌아가요.

## 기능

사용자층(40~60대 실습생)에 맞춰 **큰 글씨·큰 버튼, 적을 것은 최소한**으로 만들었어요.

- **처음 설정 (1분)**: 설정 탭에서 기관 종류(지역아동센터, 종합사회복지관, 노인복지관, 장애인복지관, 재가복지센터, 그 밖의 기관)를 고르고 이름만 적으면 돼요. 기관 종류에 맞는 하루 시간표가 미리 채워져요.
- **매일 3단계**
  1. 오늘 한 일: 시간표가 자동으로 채워져요. 다른 일을 했을 때만 고치고, 필요하면 시간마다 메모를 달 수 있어요.
  2. 오늘의 이야기: 한 칸에 두세 줄만 적으면 돼요. 휴대폰 키보드의 마이크로 말해도 돼요. 궁금했던 점이나 지도자 말씀은 선택이에요.
  3. 일지 만들기: 버튼 하나로 오늘의 목표, 시간별 활동 내용, 실습생 의견이 써져요.
- **완성된 일지**: 다 쓴 날은 일지가 맨 위에 실습일지 양식처럼 보여요. 인쇄·PDF, 진행내용 복사, 의견 복사는 큰 버튼으로, 직접 고치기·목표 복사·전체 복사는 작은 링크로 있어요.
- **인쇄**: A4 실습일지 양식 그대로 나와요(머리 문구, 결재란, 1~5번 항목, 진행내용 표).
- **지난 일지**: 누적 실습시간(목표 160시간), 날짜별 완성 여부, 모두 인쇄.
- **준비물**: 실습 준비물 체크리스트(서류·옷차림·기록·있으면 좋은 것·실습 끝나고 드릴 선물). 쿠팡 링크가 있는 항목은 오른쪽에 상품 썸네일이 보여요.
- **블로그**: 블로그 바로가기 버튼과, 네이버 블로그에서 '사회복지'가 들어간 글을 자동으로 모아 보여주는 목록.
- **방문 통계 (운영자만)**: 사이트에는 숫자가 안 보여요. Worker 주소 뒤에 `/stats`를 붙여 열고 비밀번호를 넣으면 전체·오늘·어제 방문자, 최근 7/30/90일 그래프, 시·도별·도시별 방문이 보여요. 같은 기기는 하루 한 번만 세요.
- **설정**: ① 기관 종류 ② 이름 ③ 시간표 순서로 되어 있어요. 셋 중 하나라도 비어 있으면 일지 쓰기 화면에서 "먼저 설정부터 해 주세요" 안내가 뜨고, 설정 탭에 빨간 점이 붙어요. 일지 길이·말투, 백업, 고급 설정(AI 연결 방식, 가릴 이름, 추가 요청, 인쇄 문구)도 여기 있어요.
- **개인정보 가리기**: 등록한 이름과 전화번호·주민번호 형식은 AI로 보내기 전에 가려요. AI에는 기관명과 이름을 보내지 않아요.

## GitHub Pages로 배포하기 (IDE 없이)

1. GitHub에서 **New repository**를 만들어요 (Public).
   - 저장소 이름을 **`<아이디>.github.io`**로 하는 걸 추천해요. 그러면 주소가 `https://<아이디>.github.io/`가 되고, 검색엔진이 찾는 `robots.txt`·`sitemap.xml`·`llms.txt`가 제대로 읽혀요.
   - 다른 이름(예: `sw-journal`)으로 만들면 주소가 `https://<아이디>.github.io/sw-journal/`이 되고, `robots.txt`는 무시돼요. 사이트 자체는 잘 돌아가요.
2. **Add file → Upload files**를 누르고 폴더 안 파일을 **전부** 끌어다 놓은 뒤 **Commit changes**를 눌러요.
   - `index.html`, `favicon.svg`, `apple-touch-icon.png`, `og-image.png`, `robots.txt`, `sitemap.xml`, `llms.txt`, `README.md` (`worker.js`는 선택)
3. **Settings → Pages**에서 Source는 `Deploy from a branch`, Branch는 `main`과 `/ (root)`로 두고 **Save**를 눌러요.
4. 1~2분 뒤 위 주소로 접속하면 돼요.

수정할 때는 GitHub 웹에서 `index.html`을 열고 연필 아이콘으로 고친 뒤 Commit하면 자동으로 다시 배포돼요.

## 검색에 잘 뜨게 하기 (구글·네이버·AI 검색)

**이미 해 둔 것**

- `<head>`: 검색 결과에 나오는 제목·설명, 카카오톡·SNS 공유 미리보기(`og-image.png`), 아이콘
- 구조화 데이터(JSON-LD): 무료 웹 앱이라는 정보와 자주 묻는 질문 8개. 구글과 AI가 내용을 정확히 이해하게 해 줘요.
- 화면 맨 아래 '사회복지 실습일지, 이렇게 쉽게 써요' 소개와 자주 묻는 질문: 앱 화면은 자바스크립트로 그려져서 검색엔진이 잘 못 읽는데, 이 부분은 HTML에 그대로 있어서 잘 읽혀요.
- `robots.txt`: 모든 검색엔진과 AI 검색 크롤러(ChatGPT, Claude, Perplexity, Gemini, 네이버 Yeti)를 허용해요.
- `sitemap.xml`: 검색엔진에 알려 줄 주소 목록
- `llms.txt`: AI가 읽기 쉽게 서비스를 정리한 글

**배포 주소가 정해지면 할 일**

1. 파일 안의 `YOUR-ID`를 내 GitHub 아이디로 바꿔요. 저장소 이름을 `<아이디>.github.io`로 하지 않았다면 `YOUR-ID.github.io/` 부분을 실제 주소 전체로 바꿔요.
   - `index.html`: canonical, og:url, og:image, JSON-LD의 `url` (4곳)
   - `robots.txt`, `sitemap.xml`, `llms.txt`: 각 1곳
2. **구글 서치콘솔** (search.google.com/search-console): 속성 추가 → URL 접두어에 사이트 주소 → 'HTML 태그' 인증을 골라 받은 `<meta>` 태그를 `index.html` `<head>` 안 안내 주석 자리에 붙여넣고 Commit → 확인 → 왼쪽 'Sitemaps'에 `sitemap.xml` 제출
3. **네이버 서치어드바이저** (searchadvisor.naver.com): 웹마스터 도구 → 사이트 등록 → 'HTML 태그' 인증 → 요청 → 사이트맵 제출에 `sitemap.xml`. 40~60대 사용자는 네이버로 많이 찾으니 꼭 해 주세요.
4. **Bing 웹마스터 도구** (bing.com/webmasters): 구글 서치콘솔 계정으로 가져오기를 하면 바로 돼요. Copilot을 비롯한 여러 AI 검색이 Bing 색인을 써요.
5. 내 블로그에 이 사이트를 소개하는 글을 쓰고 링크를 걸어 주세요. 검색 노출에 도움이 많이 돼요.

- 노출되기까지 보통 며칠~몇 주 걸려요.
- 내용을 크게 바꾸면 `sitemap.xml`의 `lastmod` 날짜도 바꿔 주세요.

## 무료 AI 서버(Worker) 만들기

1. Cloudflare 대시보드 → **Workers AI** → **Build and deploy a Llama 3 Worker**를 눌러요. 이름은 예를 들어 `sw-journal-ai`로 하고 Deploy해요.
2. 배포되면 **Edit code**를 누르고, 원래 코드를 전부 지운 뒤 `worker.js` 내용을 붙여넣고 **Deploy**해요.
3. Worker 주소(`https://sw-journal-ai.○○○.workers.dev`)를 복사해서 `index.html` 맨 위 `FREE_AI.endpoint`에 넣어요.
4. 브라우저로 Worker 주소를 열었을 때 `{"ok":true,...}`가 보이면 연결된 거예요.
5. 방문자 수를 쓰려면 KV를 연결해요.
   - Cloudflare 대시보드 → 저장소 및 데이터베이스(Storage & Databases) → KV → 만들기, 이름은 `sw-journal-counter`
   - Worker → 설정(Settings) → 바인딩(Bindings) → 추가 → KV 네임스페이스 → 변수 이름 `COUNTER`, 네임스페이스 `sw-journal-counter` → 배포
   - Worker 주소를 열었을 때 `"counter":true`가 보이면 연결된 거예요.
   - 무료 KV는 하루 쓰기 1,000번까지라, 방문자는 하루 1,000명 정도까지 세요. 넘으면 그날은 더 세지 않아요.
6. 방문 통계를 나만 보려면 비밀번호를 정해요.
   - Worker → 설정(Settings) → 변수 및 비밀(Variables and Secrets) → 추가 → 유형 **비밀(Secret)**, 변수 이름 `ADMIN_KEY`, 값은 내가 정한 비밀번호 → 배포
   - Worker 주소를 열었을 때 `"stats":true`가 보이면 된 거예요.
   - `https://sw-journal-ai.○○○.workers.dev/stats`를 열고 비밀번호를 넣어요. 그 기기에서는 다음부터 비밀번호 없이 열려요.
   - 비밀번호는 `worker.js`에 적지 않아요. 그래서 `worker.js`를 GitHub에 올려도 괜찮아요.
   - 위치는 Cloudflare가 IP로 추정한 대략치예요. 휴대폰 데이터로 들어오면 통신사 위치(서울·경기 등)로 잡히기도 해요.
   - 저장하는 건 날짜별 숫자(방문자 수, 시·도별, 도시별, 나라별)뿐이에요. IP 주소나 방문자 한 명 한 명의 기록은 남기지 않아요.

- 모델은 `@cf/openai/gpt-oss-120b`를 쓰고, 실패하면 `llama-3.3-70b`로 넘어가요.
- 무료 플랜은 하루 10,000 뉴런까지예요. 일지로 치면 약 30~40건이고, 넘으면 요금 없이 그날만 실패해요.
- 허용하는 사이트는 `*.github.io`, 로컬 파일, localhost예요. 실습일지 프롬프트만 받고, IP당 10초 간격·하루 30회로 제한해요.
- 주소별 기능
  - `POST /`: 일지 쓰기
  - `GET /visit?hit=1`: 방문 한 번 세기 (숫자는 돌려주지 않아요)
  - `GET /stats`: 나만 보는 방문 통계 화면 (비밀번호 `ADMIN_KEY` 필요)
  - `GET /blog`: 네이버 블로그 RSS에서 '사회복지' 글 목록. `worker.js` 맨 위 `BLOG_ID`, `BLOG_KEYWORDS`로 바꿀 수 있어요.

## 수익: 쿠팡 파트너스 · 배너 광고

`index.html`의 `<script>` 맨 위에 있는 `COUPANG`과 `ADS`만 고치면 돼요.

**쿠팡 파트너스 (`COUPANG`)**

- `COUPANG.widget`: 쿠팡 파트너스 다이내믹 배너(carousel) 값이에요. 받은 코드의 `id`, `trackingCode`, `width`, `height`를 옮겨 두었어요. 폭은 화면에 맞게 자동으로 줄어들어요.
- 배너는 아래 자리에 나와요. 자리마다 `widget:false`로 바꾸면 그 자리는 꺼져요.

| 자리 이름 | 보이는 곳 |
|---|---|
| `write-mid` | 일지 쓰기 ①과 ② 사이 |
| `write-wait` | 일지를 만드는 30초 동안 뜨는 기다림 화면 |
| `write-done` | 완성된 일지 바로 아래 |
| `list` | 지난 일지의 누적 시간 아래 |
| `prep` | 준비물 탭 위쪽 |
| `settings` | 설정의 백업 아래 |

- 자리마다 `items`에 상품 링크(`https://link.coupang.com/a/...`)를 넣으면 배너 아래에 상품 카드로도 보여요.
- 배너 스크립트는 화면을 다시 그려도 돌아가게 작은 iframe 안에서 실행돼요.
- 쿠팡 파트너스 대가성 문구가 자동으로 붙어요. 지우지 마세요.

**준비물 탭 (`PREP`)**

- 실습 준비물 체크리스트예요. 체크한 건 그 기기에 저장돼요.
- 항목마다 `url`에 쿠팡 파트너스 링크를 넣으면 그 줄 오른쪽에 상품 썸네일이 생겨요. 서류처럼 살 게 아닌 항목은 비워 두면 돼요.
- 쿠팡 상품 배너(120×240 iframe)는 `iframe`에 `https://coupa.ng/...` 주소를 넣어요. 있으면 썸네일 대신 상품 사진·가격이 나오는 배너가 보여요.
- 썸네일 사진만 쓰려면 `img`에 넣어요. 쿠팡 파트너스 → 링크 생성 → '이미지' 또는 '이미지+텍스트' 코드 안에 있는 `<img src="...">` 주소예요. 비어 있으면 장바구니 그림으로 보여요.
- 쿠팡 링크에는 쿠팡이 주는 코드처럼 `referrerpolicy="unsafe-url"`을 붙여 뒀어요.

**배너 광고 (`ADS`)**

- 모든 화면 맨 아래 한 곳에 나와요. 화면이 바뀔 때마다 광고를 새로 부르지 않게 고정해 뒀어요.
- `provider: 'adfit'`: 카카오 애드핏 광고 단위 ID(`DAN-...`)와 크기를 넣어요.
- `provider: 'adsense'`: 구글 애드센스 `ca-pub-...`와 광고 단위 slot 번호를 넣어요.
  - 사이트 승인을 받을 때는 애드센스가 주는 코드를 `<head>` 안 안내 주석 자리에 붙여넣고, `ads.txt`도 올려야 해요.
  - `github.io` 주소로는 애드센스 승인이 어렵다는 사례가 많아요. 개인 도메인을 연결하는 게 안전해요. 도메인을 연결하면 `worker.js`의 `EXTRA_HOSTS`에도 추가하고 다시 Deploy 해 주세요.

## 구조

- `index.html` 파일 하나에 HTML, CSS, JS가 다 들어 있어요. 빌드 과정이 없어요.
- 저장 위치는 `localStorage`예요.
  - `swj:v1`: 설정, 주간 일정, 일지
  - `swj:gemini-key`: Gemini 키 (백업 제외)
- `favicon.svg`·`apple-touch-icon.png`(아이콘), `og-image.png`(공유 미리보기), `robots.txt`·`sitemap.xml`·`llms.txt`(검색용)는 `index.html`과 같은 곳에 올려요.
- `worker.js`는 AI 중계 서버 코드예요. GitHub Pages에는 필요 없지만, 기록용으로 같이 올려둬도 괜찮아요. 비밀 값은 없어요.
- 외부 요청은 이것뿐이에요.
  - Pretendard 폰트 CDN
  - 무료 AI 모드: 내 Worker 주소
  - 쿠팡 파트너스 배너: `ads-partners.coupang.com`
  - 광고를 켰을 때: 카카오 애드핏 또는 구글 애드센스 스크립트
  - Gemini 모드: `generativelanguage.googleapis.com`

## 자주 고칠 만한 곳 (`<script>` 맨 위 상수)

- `TEMPLATES`: 기관 종류별 기본 시간표
- `PRINT_NOTE`, `REST_TITLE`, `REST_TEXT`: 인쇄 머리 문구와 식사·휴게시간 기본 문구
- `FREE_AI`: Worker 주소와 쿨다운(기본 10초)을 정해요.
- `COUPANG`, `ADS`: 쿠팡 파트너스 배너·상품과 배너 광고
- `PREP`: 준비물 탭 목록
- `BLOG`: 블로그 주소·제목. 자동 목록이 안 될 때 `posts`에 직접 넣을 수도 있어요.
- `MODEL_PRESETS`: Gemini 기본 모델

## 참고

- 무료 AI가 실패하면(한도 초과, 서버 오류 등) 프롬프트 복사가 자동으로 펼쳐져요.
- 사용자가 많아지면 Workers 유료 플랜(월 $5)으로 올리면 돼요. 그러면 한도를 넘는 사용분만 내는데, 일지 1건에 약 5원이에요.
- 입력 내용이 외부 AI 서비스로 전송되니, 이용자 실명을 쓰지 말라고 사용자에게 안내해 주세요. 이름 가리기 기능도 있어요.
- 브라우저 기록을 지우면 일지도 지워져요. 사용자에게 백업을 안내해 주세요.
- 학교나 기관마다 AI 사용 규정이 다를 수 있어요.

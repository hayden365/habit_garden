# 설치형 웹앱(PWA) 설계

작성일: 2026-07-20

## 목표

습관 정원을 "위젯처럼" 쓰고 싶다는 요구를, **독립 앱 창으로 뜨는 설치형 웹앱(PWA)** 으로 구현한다.
데스크톱(맥/윈도우)과 모바일(안드로이드/iOS) 양쪽에서 홈화면·독 아이콘으로 실행되고,
앱 창을 열면 지금의 웹 화면이 그대로 보인다.

## 왜 크롬 확장이 아닌가

| | 크롬 확장 | 설치형 웹앱(PWA) |
|---|---|---|
| 코드 재사용 | 별도 프로젝트 (manifest v3, 팝업, 인증 별도 구현) | 지금 `static/` 그대로 |
| 모바일 | 불가 — 크롬 모바일은 확장 미지원 | 홈화면 설치 가능 |
| 배포 | 웹스토어 심사 + 등록비 | Railway 배포로 끝 |
| 구글 로그인 | `chrome.identity` 별도 구현 필요 | 기존 OAuth 세션 그대로 |

"데스크톱과 모바일 둘 다" + "지금 화면 그대로"라는 요구에서 확장은 이점이 없다. PWA를 채택한다.

## 범위

포함:
- 설치 가능한 PWA (manifest + 서비스워커 + 아이콘)
- 앱 셸 오프라인 캐시 — 인터넷이 없어도 창은 즉시 뜬다
- 오프라인/네트워크 실패 시 사용자에게 보이는 안내

제외 (YAGNI):
- 오프라인 체크인 큐잉 및 동기화 — 데이터는 항상 서버에서 가져온다
- 위젯 전용 컴팩트 화면 — 기존 반응형 레이아웃을 그대로 쓴다
- 푸시 알림
- iOS 홈화면 앱에서의 구글 로그인 검증 (아래 "알려진 제약" 참고)

## 아키텍처

기존 구조(Spring Boot가 `src/main/resources/static/`을 서빙)를 그대로 두고 파일만 추가한다.

```
src/main/resources/static/
  manifest.json          (신규)
  sw.js                  (신규)
  icons/
    icon.svg             (신규 — PNG 생성 원본)
    icon-maskable.svg    (신규 — PNG 생성 원본)
    icon-192.png         (신규)
    icon-512.png         (신규)
    icon-maskable-512.png(신규)
  index.html             (수정 — manifest link, theme-color, 워커 등록)
  app.js                 (수정 — 네트워크 실패 안내)
  style.css              (수정 — 오프라인 배너 스타일)
src/main/java/com/habitgarden/config/SecurityConfig.java (수정 — 신규 정적 경로 permitAll)
```

### 1. manifest.json

파일명은 `.webmanifest`가 아니라 `.json`을 쓴다. Spring Boot의 정적 리소스 서빙에는 `.webmanifest`
MIME 매핑이 없어 `application/octet-stream`으로 나가지만, `.json`은 별도 설정 없이 올바른
`application/json`으로 나간다. 브라우저는 두 형식 모두 매니페스트로 받아들인다.


| 필드 | 값 | 이유 |
|---|---|---|
| `name` | `습관 정원` | 설치 대화상자에 표시 |
| `short_name` | `습관정원` | 홈화면 아이콘 라벨 (12자 이내) |
| `start_url` | `/` | 앱 실행 시 진입점 |
| `scope` | `/` | 앱 창이 담당하는 URL 범위 |
| `display` | `standalone` | 주소창 없는 독립 앱 창 |
| `background_color` | 기존 배경색 | 실행 중 스플래시 배경 |
| `theme_color` | 기존 그린 계열 | 창 테두리/상태바 색 |
| `icons` | 192, 512, maskable 512 | 아래 참고 |
| `lang` / `dir` | `ko` / `ltr` | |

`background_color`와 `theme_color`의 실제 값은 `style.css`의 CSS 변수에서 읽어 맞춘다.

### 2. 서비스워커 (`sw.js`)

전략: **앱 셸만 캐시하고, 데이터는 절대 캐시하지 않는다.**

- `install`: `/`, `/style.css`, `/app.js`, 아이콘 3종을 precache 후 `skipWaiting()`
- `activate`: `CACHE_VERSION`이 다른 옛 캐시 전부 삭제 후 `clients.claim()`
- `fetch`:
  - `GET`이 아닌 요청 → 워커가 처리하지 않음 (그대로 통과)
  - 요청 경로가 `/api/`, `/oauth2/`, `/login/`, `/logout`으로 시작 → 처리하지 않음 (network-only)
  - 그 외 same-origin GET → **cache-first**, 미스 시 network, 성공하면 캐시에 저장
  - 내비게이션 요청이 네트워크·캐시 모두 실패 → precache된 `/` 반환
- cross-origin 요청(구글 폰트, Pretendard CDN) → 처리하지 않음. 오프라인이면 시스템 폰트로 폴백된다.

`CACHE_VERSION`은 파일 최상단 상수. **프론트엔드(`index.html`/`app.js`/`style.css`)를 수정할 때마다 이 값을 올려야 한다.** 올리지 않으면 배포해도 사용자에게 옛 화면이 계속 보인다. 이 규칙을 README에 명시한다.

### 3. index.html 수정

`<head>`에 추가:
- `<link rel="manifest" href="/manifest.json">`
- `<meta name="theme-color" content="...">`
- `<link rel="apple-touch-icon" href="/icons/icon-192.png">` (iOS는 manifest 아이콘을 무시)

`</body>` 직전에 서비스워커 등록:
```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
  }
</script>
```
`register()` 실패는 조용히 무시한다 — 워커가 없어도 앱은 정상 동작해야 한다.

### 4. 아이콘

헤더의 브랜드 마크 `❖`를 본뜬 마름모를 SVG **path**로 그리고(폰트 의존 제거) `rsvg-convert`로 PNG를 렌더링한다. SVG 원본도 함께 커밋해 재생성 가능하게 한다.

- `icon-192.png`, `icon-512.png` — 여백 포함한 일반 아이콘
- `icon-maskable-512.png` — `"purpose": "maskable"`. 안드로이드의 원형/스퀘어클 크롭에 대비해
  마크를 중앙 80% 안전 영역 안에 넣고 배경을 가장자리까지 채운다

### 5. 오프라인 안내 (`app.js`)

현재 `app.js`는 `fetch` 실패 시 로딩 상태에서 멈추거나 콘솔 에러로 끝난다. 오프라인에서 앱 셸이
즉시 뜨게 되면 이 상태가 사용자에게 그대로 노출되므로 처리가 필요하다.

- API 호출 실패(네트워크 오류)를 잡아 화면 상단에 "인터넷 연결을 확인해 주세요" 배너 표시
- `window`의 `online` 이벤트에서 배너를 내리고 데이터를 다시 불러온다
- 배너는 기존 디자인 톤(그린 계열, 라운드)에 맞춘 `style.css` 클래스 하나로 구현

### 6. SecurityConfig 수정

`permitAll` 목록에 `/manifest.json`, `/sw.js`, `/icons/**`를 추가한다.
빠뜨리면 설치 자체가 실패한다 — manifest 요청이 401을 받기 때문.

## 인증

게스트 모드가 이미 있어 설치 직후 로그인 없이 바로 쓸 수 있다. 구글 로그인은 standalone 창에서
in-app 브라우저로 열렸다가 같은 세션 쿠키로 `/`에 복귀하며, 기존 `defaultSuccessUrl("/", true)`가
그대로 동작한다. 인증 관련 코드 변경은 없다.

### 알려진 제약 — iOS

iOS Safari 홈화면 앱은 OAuth 리다이렉트 후 세션 쿠키가 유지되지 않는 사례가 보고되어 있다.
이번 범위에서는 **검증하지 않는다.** iOS에서는 게스트 모드 사용을 권장하며, 이 제약을 README에
한 줄로 기록한다. 실제로 문제가 확인되면 별도 작업으로 다룬다.

## 검증

1. `mvn test` 통과 — 기존 테스트가 깨지지 않는지
2. 로컬 실행 후 크롬 DevTools → Application → Manifest에 오류 없음, "Installability" 통과
3. 데스크톱 크롬에서 실제 설치 → 주소창 없는 독립 창으로 뜨는지, 아이콘이 맞는지
4. DevTools Network를 Offline으로 두고 앱 창 재시작 → 앱 셸이 뜨고 오프라인 배너가 보이는지
5. `style.css`를 수정하고 `CACHE_VERSION`을 올린 뒤 재배포 → 새 화면이 반영되는지
6. 안드로이드 크롬에서 홈화면 설치 → 아이콘 크롭이 깨지지 않는지, 구글 로그인이 되는지

3~6번은 수동 검증이다. 5번은 캐시 무효화가 이 설계에서 가장 틀리기 쉬운 부분이라 반드시 확인한다.

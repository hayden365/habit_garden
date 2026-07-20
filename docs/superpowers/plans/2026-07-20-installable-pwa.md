# 설치형 웹앱(PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 습관 정원을 데스크톱·모바일에서 독립 앱 창으로 설치해 쓸 수 있는 PWA로 만든다.

**Architecture:** Spring Boot가 이미 `src/main/resources/static/`을 서빙하므로 백엔드 구조는 그대로 두고 정적 파일만 추가한다. 웹 매니페스트와 서비스워커, 아이콘 3종을 추가하고 `SecurityConfig`에서 이 경로들을 공개한다. 서비스워커는 앱 셸(HTML/CSS/JS/아이콘)만 캐시하고 `/api/**`는 손대지 않아, 오프라인에서도 창은 즉시 뜨되 습관 데이터가 낡은 채로 보이는 일은 없다.

**Tech Stack:** Spring Boot 3.3.5 (Java 17), 정적 HTML/CSS/JS(빌드 도구 없음), MockMvc + JUnit 5, `rsvg-convert`(아이콘 PNG 렌더링)

## Global Constraints

- 매니페스트 파일명은 **`manifest.json`** — `.webmanifest`는 Spring Boot에 MIME 매핑이 없어 `application/octet-stream`으로 나간다.
- 색상은 기존 `style.css`의 CSS 변수 값을 그대로 쓴다: `--forest: #2F6F4E`, `--forest-ink: #24583E`, `--paper: #F3F5EF`.
- 서비스워커는 `/api/`, `/oauth2/`, `/login/`, `/logout` 으로 시작하는 요청과 cross-origin 요청을 **절대 캐시하거나 가로채지 않는다.**
- `sw.js` 최상단의 `CACHE_VERSION` 상수는 `index.html`·`style.css`·`app.js`를 수정할 때마다 올려야 한다.
- 프론트엔드 빌드 파이프라인이 없다. JS는 `"use strict";` 로 시작하는 평문 ES2017 스크립트로 작성하고, 모듈 문법(`import`/`export`)을 쓰지 않는다.
- 자동화 테스트는 기존 `HabitImportTest`와 같은 방식(`@SpringBootTest` + `@AutoConfigureMockMvc`, `properties = {"GOOGLE_CLIENT_ID=test", "GOOGLE_CLIENT_SECRET=test"}`)으로 작성한다.
- 사용자에게 보이는 문구는 모두 한국어.
- 아이콘 SVG에 텍스트/폰트를 쓰지 않는다 — 도형은 `<path>`로만 그린다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/main/resources/static/manifest.json` | 앱 이름·아이콘·표시 모드 선언 (신규) |
| `src/main/resources/static/sw.js` | 앱 셸 캐시, 오프라인 폴백 (신규) |
| `src/main/resources/static/icons/icon.svg` | 일반 아이콘 원본 (신규) |
| `src/main/resources/static/icons/icon-maskable.svg` | maskable 아이콘 원본 (신규) |
| `src/main/resources/static/icons/icon-192.png` `icon-512.png` `icon-maskable-512.png` | SVG에서 렌더링한 배포용 아이콘 (신규) |
| `src/main/resources/static/index.html` | manifest 링크, theme-color, 워커 등록, 배너 요소 (수정) |
| `src/main/resources/static/app.js` | 네트워크 실패 시 배너/오프라인 뷰 (수정) |
| `src/main/resources/static/style.css` | 배너 스타일 (수정) |
| `src/main/java/com/habitgarden/config/SecurityConfig.java` | 신규 정적 경로 permitAll (수정) |
| `src/test/java/com/habitgarden/pwa/PwaAssetsTest.java` | PWA 정적 자산이 비로그인 상태로 200을 주는지 검증 (신규) |

---

### Task 1: 매니페스트와 아이콘을 공개 경로로 서빙

**Files:**
- Create: `src/main/resources/static/manifest.json`
- Create: `src/main/resources/static/icons/icon.svg`
- Create: `src/main/resources/static/icons/icon-maskable.svg`
- Create: `src/main/resources/static/icons/icon-192.png` (렌더링 산출물)
- Create: `src/main/resources/static/icons/icon-512.png` (렌더링 산출물)
- Create: `src/main/resources/static/icons/icon-maskable-512.png` (렌더링 산출물)
- Modify: `src/main/java/com/habitgarden/config/SecurityConfig.java:29-33`
- Test: `src/test/java/com/habitgarden/pwa/PwaAssetsTest.java`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: 공개 URL `/manifest.json`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`. Task 2의 `sw.js` precache 목록과 Task 3의 `<link rel="manifest">`가 이 경로들을 그대로 참조한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/test/java/com/habitgarden/pwa/PwaAssetsTest.java` 를 새로 만든다:

```java
package com.habitgarden.pwa;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The install prompt only appears if the browser can fetch the manifest and its
 * icons while logged out. These assets must never sit behind authentication.
 */
@SpringBootTest(properties = {"GOOGLE_CLIENT_ID=test", "GOOGLE_CLIENT_SECRET=test"})
@AutoConfigureMockMvc
class PwaAssetsTest {

    @Autowired MockMvc mvc;

    @Test
    void manifestIsPublicAndInstallable() throws Exception {
        mvc.perform(get("/manifest.json"))
                .andExpect(status().isOk())
                // Only ASCII values are asserted: static files are served without a
                // charset, so MockHttpServletResponse decodes the body as ISO-8859-1
                // and any Korean string would come back mangled.
                .andExpect(jsonPath("$.name").exists())
                .andExpect(jsonPath("$.start_url").value("/"))
                .andExpect(jsonPath("$.scope").value("/"))
                .andExpect(jsonPath("$.display").value("standalone"))
                .andExpect(jsonPath("$.icons.length()").value(3));
    }

    @Test
    void iconsArePublic() throws Exception {
        mvc.perform(get("/icons/icon-192.png")).andExpect(status().isOk());
        mvc.perform(get("/icons/icon-512.png")).andExpect(status().isOk());
        mvc.perform(get("/icons/icon-maskable-512.png")).andExpect(status().isOk());
    }
}
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest`
Expected: FAIL — 두 테스트 모두 `Status expected:<200> but was:<401>` (파일이 없고 SecurityConfig가 막고 있다)

- [ ] **Step 3: 아이콘 SVG 원본 2개를 만든다**

`src/main/resources/static/icons/icon.svg` — 둥근 사각 배경 + 가운데가 뚫린 마름모 (헤더의 `❖` 마크):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" ry="112" fill="#2F6F4E"/>
  <path fill="#F3F5EF" fill-rule="evenodd"
        d="M256 88 L424 256 L256 424 L88 256 Z
           M256 176 L336 256 L256 336 L176 256 Z"/>
</svg>
```

`src/main/resources/static/icons/icon-maskable.svg` — 배경을 모서리까지 꽉 채우고(둥근 모서리 없음) 마크를 중앙 안전 영역 안으로 줄인다. 안드로이드가 바깥 20%를 잘라내기 때문:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2F6F4E"/>
  <path fill="#F3F5EF" fill-rule="evenodd"
        d="M256 106 L406 256 L256 406 L106 256 Z
           M256 184 L328 256 L256 328 L184 256 Z"/>
</svg>
```

- [ ] **Step 4: SVG를 PNG로 렌더링한다**

Run:
```bash
cd /Users/kirt/Document/GitHub/habit-garden/src/main/resources/static/icons
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
file icon-192.png icon-512.png icon-maskable-512.png
```
Expected: 마지막 `file` 출력이 각각 `PNG image data, 192 x 192`, `PNG image data, 512 x 512`, `PNG image data, 512 x 512`

- [ ] **Step 5: manifest.json을 만든다**

`src/main/resources/static/manifest.json`:

```json
{
  "name": "습관 정원",
  "short_name": "습관정원",
  "description": "매일 한 칸씩 채우는 습관 기록장",
  "lang": "ko",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#F3F5EF",
  "theme_color": "#2F6F4E",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 6: SecurityConfig에서 새 경로를 공개한다**

`src/main/java/com/habitgarden/config/SecurityConfig.java`의 `requestMatchers(...)` 블록을 아래로 교체한다:

```java
                // Public: the app shell, static assets, login endpoints, and /api/me
                .requestMatchers(
                        "/", "/index.html", "/style.css", "/app.js", "/favicon.ico",
                        // PWA assets — the browser fetches these while logged out,
                        // so a 401 here silently kills the install prompt.
                        "/manifest.json", "/icons/**",
                        "/error", "/login/**", "/oauth2/**", "/api/me"
                ).permitAll()
```

- [ ] **Step 7: 테스트를 돌려 통과를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest`
Expected: PASS — 2개 테스트 통과

- [ ] **Step 8: 커밋**

```bash
git add src/main/resources/static/manifest.json src/main/resources/static/icons \
        src/main/java/com/habitgarden/config/SecurityConfig.java \
        src/test/java/com/habitgarden/pwa/PwaAssetsTest.java
git commit -m "feat: add web app manifest and icons, served publicly"
```

---

### Task 2: 앱 셸을 캐시하는 서비스워커

**Files:**
- Create: `src/main/resources/static/sw.js`
- Modify: `src/main/java/com/habitgarden/config/SecurityConfig.java` (Task 1에서 추가한 `"/manifest.json", "/icons/**"` 줄에 `"/sw.js"` 를 덧붙인다)
- Test: `src/test/java/com/habitgarden/pwa/PwaAssetsTest.java` (테스트 메서드 추가)

**Interfaces:**
- Consumes: Task 1이 만든 `/manifest.json`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` — 이 경로들이 precache 목록에 들어간다.
- Produces: 공개 URL `/sw.js`. Task 3의 `navigator.serviceWorker.register('/sw.js')`가 이 경로를 참조한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`PwaAssetsTest.java`에 아래 메서드를 `iconsArePublic` 뒤에 추가한다:

```java
    @Test
    void serviceWorkerIsPublic() throws Exception {
        mvc.perform(get("/sw.js")).andExpect(status().isOk());
    }
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest#serviceWorkerIsPublic`
Expected: FAIL — `Status expected:<200> but was:<401>`

- [ ] **Step 3: sw.js를 작성한다**

`src/main/resources/static/sw.js`:

```js
"use strict";

// Bump this whenever index.html, style.css, or app.js changes. Installed apps
// serve the shell cache-first, so without a bump they keep showing the old UI.
const CACHE_VERSION = "hg-v1";

// The app shell: everything needed to paint a window with no network.
const PRECACHE = [
    "/",
    "/style.css",
    "/app.js",
    "/manifest.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
];

// Never cached: these carry per-user data or drive the OAuth redirect flow.
// A stale habit list would be worse than no habit list.
const NETWORK_ONLY = ["/api/", "/oauth2/", "/login/", "/logout"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    // Let the browser handle fonts/CDN itself; offline just falls back to
    // system fonts instead of failing the whole page.
    if (url.origin !== self.location.origin) return;
    if (NETWORK_ONLY.some((prefix) => url.pathname.startsWith(prefix))) return;

    event.respondWith(
        caches.match(req).then((hit) => {
            if (hit) return hit;
            return fetch(req)
                .then((res) => {
                    if (res.ok && res.type === "basic") {
                        const copy = res.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => {
                    // Offline and not in cache: still give navigations the shell.
                    if (req.mode === "navigate") return caches.match("/");
                    throw new Error("offline");
                });
        })
    );
});
```

- [ ] **Step 4: SecurityConfig에 `/sw.js`를 추가한다**

`requestMatchers(...)` 안의 PWA 줄을 아래로 교체한다:

```java
                        "/manifest.json", "/sw.js", "/icons/**",
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest`
Expected: PASS — 3개 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add src/main/resources/static/sw.js \
        src/main/java/com/habitgarden/config/SecurityConfig.java \
        src/test/java/com/habitgarden/pwa/PwaAssetsTest.java
git commit -m "feat: cache the app shell with a service worker"
```

---

### Task 3: index.html에서 PWA를 연결한다

**Files:**
- Modify: `src/main/resources/static/index.html:3-12` (head), `:13-14` (body 시작), `:33-34` (script)
- Test: `src/test/java/com/habitgarden/pwa/PwaAssetsTest.java` (테스트 메서드 추가)

**Interfaces:**
- Consumes: Task 1의 `/manifest.json`·`/icons/icon-192.png`, Task 2의 `/sw.js`
- Produces: DOM 요소 `<div id="offline-banner" class="offline-banner" hidden>` — Task 4의 `app.js`가 이 id로 배너를 켜고 끈다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`PwaAssetsTest.java` 상단 import에 아래를 추가한다:

```java
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.hamcrest.Matchers.containsString;
```

그리고 테스트 메서드를 추가한다:

```java
    @Test
    void indexLinksManifestAndRegistersWorker() throws Exception {
        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("rel=\"manifest\"")))
                .andExpect(content().string(containsString("/manifest.json")))
                .andExpect(content().string(containsString("navigator.serviceWorker.register")))
                .andExpect(content().string(containsString("id=\"offline-banner\"")));
    }
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest#indexLinksManifestAndRegistersWorker`
Expected: FAIL — `Response content` 에 `rel="manifest"` 가 없다는 AssertionError

- [ ] **Step 3: index.html의 `<head>`에 PWA 태그를 추가한다**

`<link rel="stylesheet" href="/style.css"/>` 바로 아래에 추가한다:

```html
    <link rel="manifest" href="/manifest.json"/>
    <meta name="theme-color" content="#2F6F4E"/>
    <!-- iOS ignores the manifest icons and looks for this instead. -->
    <link rel="apple-touch-icon" href="/icons/icon-192.png"/>
```

- [ ] **Step 4: 오프라인 배너 요소를 추가한다**

`<div class="leaf-bg" aria-hidden="true"></div>` 바로 아래에 추가한다:

```html
    <div id="offline-banner" class="offline-banner" role="status" hidden></div>
```

- [ ] **Step 5: 서비스워커 등록 스크립트를 추가한다**

`<script src="/app.js"></script>` 바로 아래, `</body>` 앞에 추가한다:

```html
    <script>
        // Registration failures are non-fatal: the app works fine without the
        // worker, it just loses offline start-up.
        if ("serviceWorker" in navigator) {
            window.addEventListener("load", function () {
                navigator.serviceWorker.register("/sw.js").catch(function () {});
            });
        }
    </script>
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

Run: `mvn -q test -Dtest=PwaAssetsTest`
Expected: PASS — 4개 테스트 통과

- [ ] **Step 7: 커밋**

```bash
git add src/main/resources/static/index.html src/test/java/com/habitgarden/pwa/PwaAssetsTest.java
git commit -m "feat: link the manifest and register the service worker"
```

---

### Task 4: 네트워크 실패를 사용자에게 알린다

**Files:**
- Modify: `src/main/resources/static/app.js:157-191` (init), 파일 끝에 헬퍼 추가, `:265-287` (mutating handlers)
- Modify: `src/main/resources/static/style.css` (파일 끝에 배너 스타일 추가)
- Modify: `src/main/resources/static/sw.js:5` (`CACHE_VERSION` 을 `hg-v2` 로)

**Interfaces:**
- Consumes: Task 3이 만든 `#offline-banner` 요소
- Produces: `showBanner(message)`, `hideBanner()`, `withNetworkGuard(fn)` — 이 태스크 안에서만 쓰인다.

**왜 필요한가:** 현재 `init()`은 `await api("/api/me")`로 시작한다. 오프라인이면 이 호출이 reject하고 `init`이 그대로 죽어서, 화면에는 "불러오는 중…"만 영원히 남는다. 서비스워커가 앱 셸을 오프라인에서 띄우기 시작하면 사용자가 이 상태를 실제로 만나게 된다.

- [ ] **Step 1: 배너 스타일을 추가한다**

`src/main/resources/static/style.css` 맨 끝에 추가한다:

```css
/* network trouble notice — floats above the app, never blocks it */
.offline-banner {
    position: fixed;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    z-index: 50;
    max-width: calc(100vw - 32px);
    padding: 10px 18px;
    border-radius: 999px;
    background: var(--forest-ink);
    color: var(--paper);
    font-size: 14px;
    box-shadow: var(--shadow);
}

.offline-banner[hidden] { display: none; }
```

- [ ] **Step 2: app.js에 배너 헬퍼를 추가한다**

`app.js`의 `// ---- misc ----` 주석 바로 위에 추가한다:

```js
// ---- network trouble ----
const OFFLINE_MSG = "인터넷 연결을 확인해 주세요.";
const SERVER_MSG  = "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";

function troubleMessage() {
    return navigator.onLine ? SERVER_MSG : OFFLINE_MSG;
}

function showBanner(message) {
    const el = document.getElementById("offline-banner");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}

function hideBanner() {
    const el = document.getElementById("offline-banner");
    if (el) el.hidden = true;
}

// Wraps a user action so a dead network shows a notice instead of failing
// silently in the console.
async function withNetworkGuard(fn) {
    try {
        await fn();
        hideBanner();
    } catch (e) {
        // api() reloads the page on 401; nothing to report in that case.
        if (e && e.message === "unauthorized") return;
        showBanner(troubleMessage());
    }
}

// Coming back online: the simplest correct refresh is a reload.
window.addEventListener("online", () => location.reload());
```

- [ ] **Step 3: init()이 네트워크 실패를 처리하게 한다**

`app.js`의 `async function init() {` 첫 두 줄을 아래로 교체한다.

`init()`의 첫 4줄을 통째로 교체한다.

기존 (4줄):
```js
async function init() {
    const me = await api("/api/me");
    const account = document.getElementById("account");
    const app = document.getElementById("app");
```

교체 후:
```js
async function init() {
    const account = document.getElementById("account");
    const app = document.getElementById("app");

    let me;
    try {
        me = await api("/api/me");
    } catch (e) {
        // The service worker served the shell from cache but there is no
        // network. Say so instead of leaving "불러오는 중…" on screen forever.
        showBanner(troubleMessage());
        app.innerHTML = `<div class="empty">연결되면 습관을 다시 불러올게요.</div>`;
        return;
    }
    hideBanner();
```

`if (me.loggedIn) {` 이하 나머지 본문은 그대로 둔다.

- [ ] **Step 4: 습관 조작 핸들러를 가드로 감싼다**

`addHabit`, `toggleHabit`, `deleteHabit` 세 함수의 본문을 아래로 교체한다:

```js
async function addHabit() {
    const input = document.getElementById("new-title");
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    input.value = "";
    await withNetworkGuard(async () => {
        await store.create(title, selectedColor);
        await loadHabits();
    });
}

async function toggleHabit(id) {
    await withNetworkGuard(async () => {
        const updated = await store.toggleToday(id);
        const card = document.querySelector(`[data-habit="${id}"]`);
        if (card) card.replaceWith(renderHabit(updated));
    });
}

async function deleteHabit(id, title) {
    if (!confirm(`"${title}" 습관과 기록을 삭제할까요?`)) return;
    await withNetworkGuard(async () => {
        await store.remove(id);
        const card = document.querySelector(`[data-habit="${id}"]`);
        if (card) card.remove();
        const container = document.getElementById("habits");
        if (container && !container.children.length) loadHabits();
    });
}
```

- [ ] **Step 5: CACHE_VERSION을 올린다**

`src/main/resources/static/sw.js`의 5번째 줄 상수를 교체한다:

```js
const CACHE_VERSION = "hg-v2";
```

`app.js`와 `style.css`가 바뀌었기 때문이다. 이 단계를 빼먹으면 이미 설치한 사용자에게 변경이 반영되지 않는다.

- [ ] **Step 6: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `mvn -q test`
Expected: PASS — `HabitImportTest` 4개 + `PwaAssetsTest` 4개, 실패 0

`app.js`의 동작 자체는 자동화 테스트로 덮이지 않는다(프론트엔드 테스트 러너가 없다). 실제 확인은 Task 5의 수동 검증에서 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/main/resources/static/app.js src/main/resources/static/style.css src/main/resources/static/sw.js
git commit -m "feat: show a notice when the network is unavailable"
```

---

### Task 5: 문서화와 실기기 검증

**Files:**
- Modify: `README.md` (새 섹션 추가)

**Interfaces:**
- Consumes: Task 1~4의 전체 결과물
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: README에 PWA 섹션을 추가한다**

`README.md` 맨 끝에 아래 내용을 추가한다 (바깥쪽 4-백틱 울타리는 이 계획서 표기용이며, README에는 넣지 않는다):

````markdown
---

## 앱으로 설치해서 쓰기 (PWA)

배포된 주소(https)에 접속하면 브라우저 주소창 오른쪽에 설치 아이콘이 나타납니다.

- **데스크톱 크롬/엣지**: 주소창의 설치 아이콘 → "설치". 주소창 없는 독립 창으로 실행됩니다.
- **안드로이드 크롬**: 메뉴 → "앱 설치" 또는 "홈 화면에 추가".
- **iOS 사파리**: 공유 → "홈 화면에 추가".
  - ⚠️ iOS 홈 화면 앱에서의 구글 로그인은 **검증되지 않았습니다.** 세션이 유지되지 않을 수 있으니
    iOS에서는 로그인 없이 쓰는 게스트 모드를 권장합니다.

인터넷이 없어도 앱 창은 즉시 뜹니다. 오프라인일 때 동작은 로그인 여부에 따라 다릅니다.

- **게스트 모드**: 습관이 브라우저에 저장되므로 오프라인에서도 그대로 보이고, 체크인·추가·삭제까지
  평소처럼 됩니다. 연결이 없는 동안 안내 배너만 계속 표시됩니다.
- **로그인 상태**: 습관이 서버에 있어 오프라인에서는 불러올 수 없습니다. 안내 문구와 다시 시도
  버튼이 표시되고, 연결이 돌아오면 자동으로 새로고침됩니다.

### ⚠️ 프론트엔드를 수정했다면 CACHE_VERSION을 올리세요

`index.html` · `style.css` · `app.js` 중 하나라도 고쳤다면
`src/main/resources/static/sw.js` 맨 위의 상수를 반드시 올려야 합니다:

```js
const CACHE_VERSION = "hg-v5";   // → "hg-v6"
```

서비스워커가 앱 셸을 캐시 우선으로 서빙하기 때문에, 이 값을 올리지 않으면 **배포해도 이미 설치한
사용자에게는 예전 화면이 계속 보입니다.** 이 프로젝트에서 가장 흔한 실수입니다.
````

- [ ] **Step 2: 전체 테스트를 돌린다**

Run: `mvn test`
Expected: PASS — `Tests run: 8, Failures: 0, Errors: 0`

- [ ] **Step 3: 앱을 띄운다**

Run:
```bash
GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy mvn spring-boot:run
```
Expected: `Started HabitGardenApplication` 로그. http://localhost:8080 접속 시 습관 정원 화면.

(구글 로그인은 더미 자격증명으로는 동작하지 않습니다. 게스트 모드로 검증하면 충분합니다.)

- [ ] **Step 4: 설치 가능 여부를 확인한다 (수동)**

크롬에서 http://localhost:8080 접속 → DevTools → Application 탭:
- **Manifest**: 이름 "습관 정원", 아이콘 3개가 미리보기로 보이고 빨간 에러가 없어야 한다
- **Service Workers**: `sw.js`가 "activated and is running" 상태여야 한다
- **Cache Storage**: `hg-v5` 캐시 안에 7개 항목(`/`, `/style.css`, `/app.js`, `/manifest.json`, 아이콘 3개)이 있어야 한다

localhost는 https 예외로 취급되므로 로컬에서도 설치 아이콘이 나타납니다.

- [ ] **Step 5: 게스트 오프라인 동작을 확인한다 (수동)**

게스트 습관은 브라우저에만 저장되므로 오프라인에서도 **완전히 사용 가능해야 한다.** 이게 이 앱이
"로그인 없이도 쓸 수 있다"고 말하는 근거다.

1. 게스트 모드로 습관 하나를 추가한다
2. DevTools → Network → Throttling을 **Offline**으로 바꾼다
3. 페이지를 새로고침한다
   - 기대: 방금 만든 습관이 **그대로 보이고**, 하단에 "인터넷 연결을 확인해 주세요." 배너가 떠 있다
   - "불러오는 중…"에서 멈추거나 습관이 사라지면 잘못된 것이다
4. 오프라인 상태 그대로 습관을 하나 더 추가하고, 오늘 완료를 눌러 본다
   - 기대: 정상 동작하고 **배너는 계속 떠 있다** (로컬 저장이 성공했다고 배너가 사라지면 안 된다)
5. Throttling을 **No throttling**으로 되돌린다
   - 기대: 배너가 사라진다. **페이지가 새로고침되지 않는다** — 게스트 데이터는 로컬에 있어 다시
     불러올 게 없고, 새로고침하면 입력 중이던 내용만 날아간다

- [ ] **Step 5b: 로그인 상태의 오프라인 동작을 확인한다 (수동)**

로컬에서는 더미 자격증명이라 실제 구글 로그인을 할 수 없으므로, "이 브라우저는 계정이 있다"는
표시를 콘솔에서 직접 심어 흉내낸다.

1. DevTools 콘솔에서 `localStorage.setItem("habitgarden.hadsession", "1")` 실행
   (키 이름이 다르면 `app.js`의 `SESSION_HINT` 상수에서 실제 값을 확인한다)
2. Throttling을 **Offline**으로 두고 새로고침한다
   - 기대: "연결되면 습관을 다시 불러올게요." 문구와 **다시 시도 버튼**이 보인다. 게스트 습관이
     로컬에 있더라도 표시되지 않는다 — 계정 사용자에게 빈 게스트 정원을 보여주면 데이터가 날아갔다고
     오해하기 때문이다
3. Throttling을 되돌린다
   - 기대: 이번에는 자동으로 새로고침된다 (서버에서 가져올 게 실제로 있으므로)
4. 이번엔 서버 쪽 실패를 확인한다. 온라인 상태에서 Spring 앱을 중지하고 새로고침한다
   - 기대: 같은 문구와 다시 시도 버튼. Spring 앱을 다시 켜고 **다시 시도**를 누르면 정상 복구된다
   - 이 경로에는 `online` 이벤트가 발생하지 않으므로, 버튼이 없으면 영영 빠져나올 수 없다
5. 확인이 끝나면 `localStorage.removeItem("habitgarden.hadsession")`으로 정리한다

- [ ] **Step 6: 캐시 무효화를 확인한다 (수동, 가장 중요)**

1. `style.css`의 `--paper` 값을 `#FFE8E8`로 잠깐 바꾸고 저장한다
2. `sw.js`의 `CACHE_VERSION`은 **그대로 둔 채** 앱을 재시작하고 강제 새로고침(Cmd+Shift+R)한다
   - 기대: 배경색이 **바뀌지 않는다** (캐시 우선 동작이 의도대로라는 증거)
3. `CACHE_VERSION`을 `hg-v6`으로 올리고 재시작 후 새로고침한다
   - 기대: 배경이 분홍색으로 바뀌고, Cache Storage에서 `hg-v5`가 사라지고 `hg-v6`만 남는다
4. `--paper`를 `#F3F5EF`로, `CACHE_VERSION`을 `hg-v5`로 되돌린다

- [ ] **Step 7: 데스크톱 설치를 확인한다 (수동)**

주소창의 설치 아이콘으로 설치 → 독 아이콘이 초록 배경의 마름모인지, 실행하면 주소창 없는 독립 창으로 뜨는지 확인한다. 확인 후 앱을 제거해도 된다.

- [ ] **Step 8: 커밋**

```bash
git add README.md
git commit -m "docs: document PWA install and the CACHE_VERSION rule"
```

- [ ] **Step 9: 배포 후 모바일 검증 (수동, 선택)**

Railway에 배포한 뒤 안드로이드 크롬에서 "앱 설치" → 홈 화면 아이콘의 원형 크롭이 마름모를 자르지 않는지, 구글 로그인이 정상 동작하는지 확인한다. iOS는 위 README의 제약대로 게스트 모드만 확인한다.

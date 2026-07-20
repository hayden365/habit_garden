# 습관 정원 (Habit Garden) 🌱

오늘의 작은 습관을 등록하고, 매일 체크하면 GitHub 잔디처럼 기록이 쌓이는 웹앱입니다.
Spring Boot(자바) + 구글 로그인 + PostgreSQL, Railway 배포용으로 구성되어 있습니다.

- **백엔드**: Spring Boot 3 (Java 17), Spring Security(구글 OAuth2), Spring Data JPA
- **프론트**: 정적 HTML/CSS/JS (백엔드가 함께 서빙 → 배포 대상이 하나)
- **DB**: 로컬은 H2(메모리), 운영은 PostgreSQL
- **배포**: Railway (Dockerfile 자동 인식)

---

## 0. 전체 순서 한눈에

1. 구글 OAuth 클라이언트 만들기 (5분)
2. IntelliJ에서 로컬 실행해 보기
3. GitHub에 코드 올리기
4. Railway에서 배포 + PostgreSQL 연결
5. Railway 주소를 구글 OAuth에 등록
6. 접속해서 로그인 → 습관 심기 🎉

---

## 1. 구글 OAuth 클라이언트 만들기

1. https://console.cloud.google.com 접속 → 프로젝트 생성(아무 이름).
2. 왼쪽 메뉴 **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부(External)** 선택 → 앱 이름/이메일만 채우고 저장.
   - (테스트 상태면 "테스트 사용자"에 본인 구글 계정을 추가하세요.)
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 리디렉션 URI**에 아래 2개를 추가:
     ```
     http://localhost:8080/login/oauth2/code/google
     ```
     (Railway 주소는 4단계 이후에 다시 와서 추가합니다)
4. 만들면 나오는 **클라이언트 ID**와 **클라이언트 보안 비밀번호(secret)**를 복사해 둡니다.

---

## 2. 로컬에서 실행하기 (IntelliJ)

1. 이 폴더를 IntelliJ로 엽니다 (`pom.xml`을 여는 걸로 열면 됩니다).
2. 처음 열면 Maven이 의존성을 자동으로 내려받습니다(인터넷 필요).
3. 구글 client id/secret을 **환경변수**로 넣어줍니다.
   `HabitGardenApplication`을 우클릭 → **Run** 한 번 실행(에러 나도 OK) →
   상단의 실행 구성 드롭다운 → **Edit Configurations…** →
   **Environment variables** 칸에 아래를 입력:
   ```
   GOOGLE_CLIENT_ID=여기에_클라이언트_ID;GOOGLE_CLIENT_SECRET=여기에_시크릿
   ```
4. 다시 **Run** ▶ 실행 → 브라우저에서 http://localhost:8080 접속.
5. "Google로 시작하기" → 로그인 → 습관을 추가하고 "오늘 완료"를 눌러보세요.

> 로컬 DB는 메모리(H2)라 앱을 끄면 데이터가 사라집니다. 운영(Railway)에서는 PostgreSQL로 영구 저장됩니다.

---

## 3. GitHub에 올리기

터미널에서:
```bash
cd habit-garden
git init
git add .
git commit -m "습관 정원 초기 버전"
git branch -M main
git remote add origin https://github.com/<your-id>/habit-garden.git
git push -u origin main
```
(GitHub에서 빈 저장소를 먼저 하나 만들어 두세요.)

---

## 4. Railway 배포

1. https://railway.app 에 GitHub로 로그인.
2. **New Project → Deploy from GitHub repo → habit-garden** 선택.
   - Railway가 `Dockerfile`을 자동으로 인식해서 빌드합니다.
3. **데이터베이스 추가**: 프로젝트 화면에서 **New → Database → Add PostgreSQL**.
4. 앱 서비스 클릭 → **Variables** 탭에서 아래 5개를 추가합니다.
   (`${{Postgres.XXX}}`는 방금 만든 Postgres 서비스 값을 자동으로 참조합니다.
   Postgres 서비스 이름이 다르면 그 이름으로 바꾸세요.)
   ```
   GOOGLE_CLIENT_ID        = (1단계에서 복사한 클라이언트 ID)
   GOOGLE_CLIENT_SECRET    = (1단계에서 복사한 시크릿)
   SPRING_DATASOURCE_URL      = jdbc:postgresql://${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
   SPRING_DATASOURCE_USERNAME = ${{Postgres.PGUSER}}
   SPRING_DATASOURCE_PASSWORD = ${{Postgres.PGPASSWORD}}
   ```
5. 앱 서비스 → **Settings → Networking → Generate Domain** 을 눌러 공개 주소를 만듭니다.
   예: `https://habit-garden-production.up.railway.app`

---

## 5. 구글 OAuth에 Railway 주소 등록

1. 다시 구글 콘솔 → **사용자 인증 정보 → 만든 OAuth 클라이언트** 편집.
2. **승인된 리디렉션 URI**에 아래를 추가(주소는 4단계에서 생성된 본인 도메인으로):
   ```
   https://<본인-도메인>.up.railway.app/login/oauth2/code/google
   ```
3. 저장. (구글 변경은 즉시 반영됩니다. 재배포 불필요.)

---

## 6. 접속

`https://<본인-도메인>.up.railway.app` 로 접속 → Google 로그인 → 완성! 🎉

---

## 자주 겪는 문제

- **`redirect_uri_mismatch`**: 구글에 등록한 리디렉션 URI가 실제 접속 주소와 정확히 일치해야 합니다.
  끝의 `/login/oauth2/code/google` 경로까지 똑같아야 하고, `http`/`https`도 구분됩니다.
- **로그인 후 403 / access_denied**: OAuth 동의 화면이 "테스트" 상태면, 테스트 사용자 목록에
  본인 구글 계정을 추가해야 합니다.
- **앱은 뜨는데 로그인 버튼이 404**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 환경변수가
  설정되지 않은 경우입니다. (이 두 값이 없으면 앱이 시작되지 않으니, 로그를 확인하세요.)
- **DB 연결 실패**: `SPRING_DATASOURCE_*` 세 변수와 PostgreSQL 서비스 참조가 맞는지 확인하세요.

---

## 구조 살펴보기 (자바 학습용)

```
src/main/java/com/habitgarden/
├─ HabitGardenApplication.java      앱 진입점
├─ config/SecurityConfig.java       로그인/보안 규칙 (누가 어디에 접근 가능한지)
├─ user/
│  ├─ User.java                     유저 테이블
│  ├─ UserRepository.java           유저 DB 접근
│  └─ CustomOAuth2UserService.java  구글 로그인 시 유저 저장/갱신
└─ habit/
   ├─ Habit.java / CheckIn.java     습관, 날짜별 체크 테이블
   ├─ *Repository.java              DB 접근
   ├─ HabitDtos.java                요청/응답 데이터 형태
   └─ HabitController.java          /api/... 실제 기능 (추가·삭제·체크·조회)

src/main/resources/
├─ application.yml                  설정 (포트, DB, 구글 OAuth)
└─ static/                          화면 (index.html, style.css, app.js)
```

동작 흐름: 브라우저(`app.js`)가 `/api/...`를 호출 → `HabitController`가 처리 →
JPA가 DB에 저장/조회 → 결과 JSON을 받아 잔디 그리드를 그립니다.

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

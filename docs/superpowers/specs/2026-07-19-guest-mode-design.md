# 게스트 모드 + 로그인 시 계정 병합 — 설계 문서

날짜: 2026-07-19

## 목표

- 로그인 없이도 앱을 바로 사용할 수 있게 한다(습관 추가·오늘 체크·삭제·잔디 기록 전부).
- 사용자가 로그인하면, 게스트 상태에서 만든 습관을 그 계정에 저장(병합)한다.

## 배경 (현재 상태)

- 서버: 모든 `/api/habits*` 엔드포인트가 로그인 필수(비로그인 401). 습관/체크인은 `User`에 묶여 DB 저장.
- 프론트(`app.js`): 비로그인 시 전체 화면 로그인 히어로(`renderLogin`)만 표시. 로그인해야 습관 앱(`renderApp`) 사용 가능.
- 기본 DB: 인메모리 H2(재시작 시 초기화). Railway에선 실제 DB로 교체 가능.
- 시간대: 서버·클라이언트 모두 Asia/Seoul 기준으로 "오늘"을 계산.

## 결정 사항

1. **게스트 저장소**: 브라우저 `localStorage`. 서버 DB에 익명 데이터를 만들지 않는다.
2. **병합 규칙**: "모두 추가". 로그인한 계정에 이미 습관이 있어도, 게스트 습관을 제목 중복 검사 없이 그대로 계정에 추가한다.
3. **데모 히어로 제거**: 비로그인 전용 랜덤 잔디 히어로 화면은 제거. 앱 화면은 로그인 여부와 무관하게 항상 표시.

## 전체 동작 흐름

```
앱 시작
 └ GET /api/me 로 로그인 여부 확인
     ├ 비로그인 → 게스트 모드: 앱 즉시 표시, 습관은 localStorage에서 읽고/쓴다
     └ 로그인   → 계정 모드: 습관은 서버 /api/habits 사용

[게스트 상태에서 "Google로 시작하기" → 로그인 성공 후 앱으로 돌아옴]
 └ /api/me 가 loggedIn:true 이고 localStorage 에 게스트 습관이 있으면
     → POST /api/habits/import : 습관 + 체크인 날짜를 계정에 일괄 추가
     → 성공 시 localStorage 게스트 데이터 삭제
     → 이후 계정 데이터가 진실의 원천
```

## 프론트엔드 설계 (`app.js`, `index.html`)

### 데이터 저장소 추상화

공통 인터페이스:

```
store = {
  list()                  → 정규화된 습관 배열
  create(title, color)    → 새 습관 (정규화 형태)
  toggleToday(id)         → 갱신된 습관
  remove(id)              → void
}
```

정규화된 습관 형태(서버 `HabitResponse`와 동일한 필드):
`{ id, title, color, completedDates: string[], checkedToday, totalCount, currentStreak }`

- **GuestStore** (localStorage 기반)
  - 저장 키: `habitgarden.guest`
  - 저장 형태: `{ nextId: number, habits: [{ id, title, color, createdAt, completedDates: string[] }] }`
  - `id`는 localStorage 카운터(`nextId`)로 생성. 서버 id(양수 Long)와 시각적으로 구분하기 위해 `"g" + n` 형태의 문자열 사용.
  - `checkedToday / totalCount / currentStreak`는 현재 서버 `HabitController.toResponse`가 하던 계산을 클라이언트에서 동일하게 수행(Asia/Seoul 기준):
    - `totalCount` = completedDates 개수
    - `checkedToday` = completedDates 에 오늘 포함 여부
    - `currentStreak` = 오늘(체크됐으면) 또는 어제부터 과거로 연속된 날 수
- **ServerStore** (기존 `/api/habits` 그대로 래핑)
  - `list` → `GET /api/habits`, `create` → `POST /api/habits`, `toggleToday` → `POST /api/habits/{id}/toggle`, `remove` → `DELETE /api/habits/{id}`
  - 서버가 이미 정규화 필드를 계산해 내려주므로 그대로 사용.

`init()`에서 `me.loggedIn` 여부로 `store`를 GuestStore 또는 ServerStore 로 바인딩한다.

### 렌더링 변화

- `renderLogin`(전체 화면 히어로) **제거**.
- 상단 헤더 `#account`:
  - 비로그인: "Google로 시작하기" 버튼(`/oauth2/authorization/google`) 표시.
  - 로그인: 프로필 사진/이름 + "로그아웃" (기존 로직 유지).
- `renderApp`(습관 추가 UI + 목록)은 **항상** 렌더링.
- 습관 카드/그리드 렌더링(`renderHabit`, `buildGrid`)은 정규화 형태를 받으므로 변경 없음.
- 빈 상태 안내("아직 습관이 없어요… 🌱") 유지.
- `loadHabits / addHabit / toggleHabit / deleteHabit`은 직접 `api()`를 호출하는 대신 `store`를 호출하도록 변경.

### 로그인 시 마이그레이션

`init()` 안에서 로그인 확인 직후:

```
if (me.loggedIn && guestHasHabits()) {
    const payload = readGuestHabits().map(h => ({
        title: h.title, color: h.color, completedDates: h.completedDates
    }));
    await api("/api/habits/import", { method: "POST", body: JSON.stringify(payload) });
    clearGuestHabits();   // localStorage 정리
}
// 이후 store(ServerStore).list() 로 렌더링
```

- import 실패 시(네트워크 등): localStorage를 지우지 않고 사용자에게 알림 후 다음 로그인/새로고침에서 재시도 가능하도록 둔다.

## 백엔드 설계

### 새 엔드포인트: `POST /api/habits/import` (로그인 필요)

- 요청 본문(JSON 배열):
  ```json
  [
    { "title": "독서", "color": "#3FA34D",
      "completedDates": ["2026-07-01", "2026-07-02"] }
  ]
  ```
- 동작:
  - 현재 로그인 유저(`currentUser`)에게 각 항목을 새 `Habit`으로 생성("모두 추가", 제목 중복 검사 없음).
  - `color`가 비어 있으면 엔티티 기본값(`#3FA34D`) 사용.
  - `completedDates`의 각 날짜에 대해 `CheckIn` 생성. 다음은 건너뛴다(에러 없이 무시):
    - `YYYY-MM-DD` 파싱 실패
    - 미래 날짜(Asia/Seoul 기준 오늘 이후)
    - 같은 습관 내 중복 날짜
- 상한(악의적 대용량 요청 방어):
  - 요청 습관 수 최대 100개 초과 시 400.
  - 습관당 `completedDates` 최대 400개 초과분은 무시(또는 400). 구현 시 초과분 무시로 통일.
- 응답: 갱신된 전체 습관 목록 `List<HabitResponse>` (기존 `GET /api/habits`와 동일 형태) — 프론트가 바로 렌더링.

### DTO

`HabitDtos`에 레코드 추가:

```java
record ImportHabitRequest(@NotBlank String title, String color, List<String> completedDates) {}
```

### SecurityConfig

- 변경 **없음**. `/api/habits/import`는 `/api/**` 매처에 포함되어 자동으로 인증 필요.
- 공개 경로(`/api/me`, 정적 자원, `/oauth2/**` 등) 그대로.

### 변경 없는 부분

- `Habit`, `CheckIn`, `User` 엔티티 및 리포지토리 인터페이스.
- 기존 `list / create / delete / toggleToday` 엔드포인트.

## 테스트

현재 테스트 인프라가 없으므로 `spring-boot-starter-test` 기반 컨트롤러 통합 테스트를 새로 구성한다. 최소 케이스:

1. **정상 병합**: 습관 2개(+체크인 날짜) import → `GET /api/habits`가 병합 결과 반환, streak/totalCount 정확.
2. **잘못된 날짜 무시**: 파싱 불가/미래 날짜/중복 날짜가 섞인 요청 → 유효 날짜만 저장.
3. **상한 처리**: 습관 100개 초과 → 400. 습관당 날짜 400개 초과분 무시.
4. **인증 필요**: 비로그인 import 호출 → 401.
5. (프론트 계산) GuestStore의 streak/totalCount/checkedToday 계산이 서버 `toResponse`와 동일한지 확인 — 가능하면 순수 함수로 분리해 단위 테스트. (JS 테스트 러너가 없으면 수동 검증 항목으로 남김.)

## 범위 밖 (YAGNI)

- 다른 기기/브라우저 간 게스트 데이터 동기화.
- 제목 기준 병합/중복 제거.
- 로그아웃 시 계정 데이터를 다시 게스트로 내보내기.

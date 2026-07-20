"use strict";

// ---- config ----
const WEEKS = 26;                 // how many weeks of grass to show
const WINDOW_DAYS = 182;          // matches the server's heatmap window
const MONTHS_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const PRESET_COLORS = ["#3FA34D", "#2E86AB", "#E8A33D", "#C0504D", "#7C5CBF", "#E86A9A"];
const DEFAULT_COLOR = PRESET_COLORS[0];
const GUEST_KEY = "habitgarden.guest";
// Set while a logged-in session is seen, removed when /api/me says otherwise.
// Offline we can't ask the server, so this is how we tell "a signed-in user
// with server-side habits" apart from "a browser that only ever had guest data".
const SESSION_HINT = "habitgarden.hadsession";

let selectedColor = PRESET_COLORS[0];
let store = null; // GuestStore or ServerStore, chosen at boot
// True only when init() failed to reach /api/me for a browser that has a
// server-side account (hadSession() below) -- the one case where reconnecting
// can produce data the client doesn't already have, so it's the one case the
// "online" handler reloads for.
let bootFailed = false;

// ---- tiny date helpers ----
function seoulToday() {
    // 'YYYY-MM-DD' for the Asia/Seoul calendar day (matches the server).
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}
function parseYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
}
function addDays(date, n) {
    const c = new Date(date);
    c.setDate(c.getDate() + n);
    return c;
}
function fmtYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// ---- api wrapper ----
// Shared so a reword here can't silently stop matching in withNetworkGuard.
const UNAUTHORIZED = "unauthorized";

async function api(path, opts = {}) {
    let res;
    try {
        res = await fetch(path, {
            headers: { "Content-Type": "application/json" },
            ...opts,
        });
    } catch (e) {
        // Only a rejected fetch means the request never reached the server.
        // Tagging it lets callers avoid blaming the network for HTTP errors.
        const err = e instanceof Error ? e : new Error("network");
        err.networkFailure = true;
        throw err;
    }
    if (res.status === 401) {
        // Session gone while logged in: drop back to guest mode.
        location.reload();
        throw new Error(UNAUTHORIZED);
    }
    if (!res.ok) throw new Error(`${res.status}`);
    if (res.status === 204) return null;
    return res.json();
}

// ---- data stores ----
// Both stores expose the same interface and return "normalized" habits:
//   { id, title, color, completedDates, checkedToday, totalCount, currentStreak }

// Server-backed store for logged-in users. The server already computes streaks.
const ServerStore = {
    list()               { return api("/api/habits"); },
    create(title, color) { return api("/api/habits", { method: "POST", body: JSON.stringify({ title, color }) }); },
    toggleToday(id)      { return api(`/api/habits/${id}/toggle`, { method: "POST" }); },
    remove(id)           { return api(`/api/habits/${id}`, { method: "DELETE" }); },
};

// localStorage-backed store for guests. Grass math is done client-side so it
// matches the server's Asia/Seoul window and streak logic.
const GuestStore = {
    async list() {
        return readGuest().habits.map(normalizeGuest);
    },
    async create(title, color) {
        const g = readGuest();
        const habit = {
            id: "g" + g.nextId++,
            title: title.trim(),
            color: color && color.trim() ? color : DEFAULT_COLOR,
            createdAt: Date.now(),
            completedDates: [],
        };
        g.habits.push(habit);
        writeGuest(g);
        return normalizeGuest(habit);
    },
    async toggleToday(id) {
        const g = readGuest();
        const habit = g.habits.find(h => h.id === id);
        if (!habit) throw new Error("not found");
        const today = seoulToday();
        const i = habit.completedDates.indexOf(today);
        if (i >= 0) habit.completedDates.splice(i, 1);
        else habit.completedDates.push(today);
        writeGuest(g);
        return normalizeGuest(habit);
    },
    async remove(id) {
        const g = readGuest();
        g.habits = g.habits.filter(h => h.id !== id);
        writeGuest(g);
        return null;
    },
};

function emptyGuest() { return { nextId: 1, habits: [] }; }

function readGuest() {
    try {
        const raw = localStorage.getItem(GUEST_KEY);
        if (!raw) return emptyGuest();
        const g = JSON.parse(raw);
        if (!g || !Array.isArray(g.habits)) return emptyGuest();
        if (typeof g.nextId !== "number") g.nextId = g.habits.length + 1;
        return g;
    } catch (e) {
        return emptyGuest();
    }
}
function writeGuest(g) {
    localStorage.setItem(GUEST_KEY, JSON.stringify(g));
}
function clearGuest() {
    localStorage.removeItem(GUEST_KEY);
}
function guestHasHabits() {
    return readGuest().habits.length > 0;
}

// Written on both branches of a successful /api/me, so logging out clears the
// hint on the next load without hooking the logout handler.
function rememberSession(loggedIn) {
    try {
        if (loggedIn) localStorage.setItem(SESSION_HINT, "1");
        else localStorage.removeItem(SESSION_HINT);
    } catch (e) {
        // Storage can be full or blocked; the hint is only an optimization.
        console.error("세션 힌트 저장 실패:", e);
    }
}
function hadSession() {
    try {
        return !!localStorage.getItem(SESSION_HINT);
    } catch (e) {
        return false;
    }
}

// Turn a stored guest habit into the same shape the server returns, computing
// streak/totalCount/checkedToday over the visible window (mirrors the server).
function normalizeGuest(habit) {
    const todayStr = seoulToday();
    const today = parseYMD(todayStr);
    const windowStart = addDays(today, -(WINDOW_DAYS - 1));

    const done = new Set();
    for (const d of habit.completedDates) {
        const dt = parseYMD(d);
        if (dt >= windowStart && dt <= today) done.add(d);
    }

    const checkedToday = done.has(todayStr);
    let streak = 0;
    let cursor = checkedToday ? today : addDays(today, -1);
    while (done.has(fmtYMD(cursor))) {
        streak++;
        cursor = addDays(cursor, -1);
    }

    return {
        id: habit.id,
        title: habit.title,
        color: habit.color,
        completedDates: [...done],
        checkedToday,
        totalCount: done.size,
        currentStreak: streak,
    };
}

// ---- boot ----
document.addEventListener("DOMContentLoaded", init);

async function init() {
    const account = document.getElementById("account");
    const app = document.getElementById("app");

    let me;
    try {
        me = await api("/api/me");
    } catch (e) {
        // The service worker served the shell from cache but there is no
        // network. Say so instead of leaving "불러오는 중…" on screen forever.
        console.error("세션 확인 실패:", e);
        // troubleMessage(), not errorMessage(e): whatever the cause, the server
        // is unreachable at boot, so the connectivity wording is right even
        // for e.g. a 500.
        showBanner(troubleMessage());
        renderGuestAccount(account);
        if (hadSession()) {
            // This browser has an account whose habits live on the server.
            // Dropping it into an empty guest garden would read as data loss.
            // Only here is a reload on reconnect worth the cost: it is the one
            // case where coming back online can produce data we don't have.
            bootFailed = true;
            app.innerHTML = "";
            app.appendChild(emptyWithRetry("연결되면 습관을 다시 불러올게요."));
            return;
        }
        // No account was ever seen here, so localStorage holds everything this
        // user has — and reading it needs no network.
        store = GuestStore;
        renderApp(app);
        await loadHabitsGuarded();
        return;
    }
    rememberSession(me.loggedIn);
    hideBanner();

    if (me.loggedIn) {
        // If this browser has guest habits, fold them into the account once.
        if (guestHasHabits()) {
            try {
                const payload = readGuest().habits.map(h => ({
                    title: h.title,
                    color: h.color,
                    completedDates: h.completedDates,
                }));
                await api("/api/habits/import", { method: "POST", body: JSON.stringify(payload) });
                clearGuest();
            } catch (e) {
                // Keep the guest data so we can retry on the next load.
                console.error("게스트 습관 병합 실패:", e);
                alert("이전 습관을 계정으로 옮기지 못했어요. 새로고침하면 다시 시도합니다.");
            }
        }
        store = ServerStore;
        renderAccount(account, me);
    } else {
        store = GuestStore;
        renderGuestAccount(account);
    }

    renderApp(app);
    await loadHabitsGuarded();
}

// ---- header (account area) ----
function renderAccount(account, me) {
    account.innerHTML = `
        ${me.picture ? `<img src="${escapeAttr(me.picture)}" alt=""/>` : ""}
        <span class="who">${escapeHtml(me.name || me.email)}</span>
        <a class="btn btn-ghost" href="/logout">로그아웃</a>
    `;
    // /logout is a POST endpoint in Spring; turn the link into a POST.
    const logout = account.querySelector('a[href="/logout"]');
    logout.addEventListener("click", (e) => {
        e.preventDefault();
        const f = document.createElement("form");
        f.method = "post";
        f.action = "/logout";
        document.body.appendChild(f);
        f.submit();
    });
}

function renderGuestAccount(account) {
    account.innerHTML = `
        <a class="btn-google btn-google-sm" href="/oauth2/authorization/google">
            ${googleSvg()} Google로 시작하기
        </a>
    `;
}

// ---- app view (always shown) ----
function renderApp(root) {
    root.innerHTML = `
        <div class="add-card">
            <div class="add-row">
                <input id="new-title" type="text" maxlength="60"
                       placeholder="예) 코딩테스트 5문제 풀기" />
                <div class="swatches" id="swatches"></div>
                <button class="btn btn-primary" id="add-btn">습관 추가</button>
            </div>
        </div>
        <div id="habits"></div>
    `;

    const sw = document.getElementById("swatches");
    PRESET_COLORS.forEach((c, i) => {
        const el = document.createElement("div");
        el.className = "swatch" + (i === 0 ? " selected" : "");
        el.style.background = c;
        el.title = c;
        el.addEventListener("click", () => {
            selectedColor = c;
            sw.querySelectorAll(".swatch").forEach(s => s.classList.remove("selected"));
            el.classList.add("selected");
        });
        sw.appendChild(el);
    });

    document.getElementById("add-btn").addEventListener("click", addHabit);
    document.getElementById("new-title").addEventListener("keydown", (e) => {
        if (e.key === "Enter") addHabit();
    });
}

// A ".empty" message paired with a button that reloads the page. Used for the
// two dead-end states where nothing on screen will change on its own: a boot
// failure and a habit-list fetch failure.
function emptyWithRetry(message) {
    const el = document.createElement("div");
    el.className = "empty";

    const text = document.createElement("div");
    text.textContent = message;
    el.appendChild(text);

    const retry = document.createElement("button");
    retry.className = "btn btn-primary";
    retry.textContent = "다시 시도";
    retry.addEventListener("click", () => location.reload());
    el.appendChild(retry);

    return el;
}

async function loadHabits() {
    const habits = await store.list();
    const container = document.getElementById("habits");
    container.innerHTML = "";
    if (!habits.length) {
        container.innerHTML = `<div class="empty">아직 습관이 없어요. 위에서 첫 습관을 심어보세요 🌱</div>`;
        return;
    }
    habits.forEach(h => container.appendChild(renderHabit(h)));
}

// The habit list is the one fetch that runs after boot succeeded, so its
// failure must still leave an explanation on screen rather than blank space.
async function loadHabitsGuarded() {
    try {
        await loadHabits();
    } catch (e) {
        console.error("습관 목록 불러오기 실패:", e);
        showBanner(errorMessage(e));
        const target = document.getElementById("habits") || document.getElementById("app");
        if (target) {
            target.innerHTML = "";
            target.appendChild(emptyWithRetry("습관을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
        }
    }
}

async function addHabit() {
    const input = document.getElementById("new-title");
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    await withNetworkGuard(async () => {
        await store.create(title, selectedColor);
        // Only now is the typed title safe to discard; a failed create must
        // leave it in the box so the user can retry without retyping.
        input.value = "";
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
        if (container && !container.children.length) await loadHabits();
    });
}

// ---- one habit card ----
function renderHabit(h) {
    const card = document.createElement("div");
    card.className = "habit";
    card.dataset.habit = h.id;

    const done = h.checkedToday;
    card.innerHTML = `
        <div class="habit-head">
            <div>
                <div class="habit-title">${escapeHtml(h.title)}</div>
                <div class="habit-meta">
                    현재 <b>${h.currentStreak}</b>일 연속 · 채운 칸 <b>${h.totalCount}</b>개
                </div>
            </div>
            <div class="habit-actions">
                <button class="check-btn ${done ? "done" : ""}">
                    ${done ? "오늘 완료됨 ✓" : "오늘 완료"}
                </button>
                <button class="icon-btn" title="삭제">✕</button>
            </div>
        </div>
    `;

    const checkBtn = card.querySelector(".check-btn");
    if (done) checkBtn.style.background = h.color;
    checkBtn.addEventListener("click", () => toggleHabit(h.id));
    card.querySelector(".icon-btn").addEventListener("click", () => deleteHabit(h.id, h.title));

    const grid = buildGrid(new Set(h.completedDates), seoulToday(), h.color, { interactive: false });
    card.appendChild(grid);

    const legend = document.createElement("div");
    legend.className = "grid-legend";
    legend.innerHTML = `안 함 <span class="cell"></span>
        <span class="cell" style="background:${h.color}"></span> 함`;
    card.appendChild(legend);

    return card;
}

// ---- the grass grid ----
// completed: Set of 'YYYY-MM-DD', todayStr: 'YYYY-MM-DD', color: hex
function buildGrid(completed, todayStr, color) {
    const today = parseYMD(todayStr);
    const dow = today.getDay(); // 0=Sun .. 6=Sat
    // top-left cell = the Sunday, (WEEKS-1) weeks before this week's Sunday
    const gridStart = addDays(today, -dow - (WEEKS - 1) * 7);

    const wrap = document.createElement("div");
    wrap.className = "grid-scroll";
    const grid = document.createElement("div");
    grid.className = "grid";

    // month labels row
    const months = document.createElement("div");
    months.className = "grid-months";
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
        const top = addDays(gridStart, w * 7);
        const span = document.createElement("span");
        if (top.getMonth() !== lastMonth) {
            span.textContent = MONTHS_KO[top.getMonth()];
            lastMonth = top.getMonth();
        }
        months.appendChild(span);
    }
    grid.appendChild(months);

    // body
    const body = document.createElement("div");
    body.className = "grid-body";
    for (let w = 0; w < WEEKS; w++) {
        const col = document.createElement("div");
        col.className = "grid-col";
        for (let r = 0; r < 7; r++) {
            const date = addDays(gridStart, w * 7 + r);
            const cell = document.createElement("div");
            cell.className = "cell";
            if (date > today) {
                cell.classList.add("future");
            } else {
                const key = fmtYMD(date);
                const isDone = completed.has(key);
                if (isDone) cell.style.background = color;
                if (key === todayStr) cell.classList.add("today");
                cell.title = `${key} · ${isDone ? "완료" : "미완료"}`;
            }
            col.appendChild(cell);
        }
        body.appendChild(col);
    }
    grid.appendChild(body);

    wrap.appendChild(grid);
    return wrap;
}

// ---- network trouble ----
const OFFLINE_MSG = "인터넷 연결을 확인해 주세요.";
const SERVER_MSG  = "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.";
const GENERIC_MSG = "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";

function troubleMessage() {
    return navigator.onLine ? SERVER_MSG : OFFLINE_MSG;
}

// Only a request that never reached the server is a network problem. An HTTP
// error status or a local failure (storage quota, stale card) is not, and
// telling the user to check their connection would send them chasing nothing.
function errorMessage(e) {
    return e && e.networkFailure ? troubleMessage() : GENERIC_MSG;
}

function showBanner(message) {
    const el = document.getElementById("offline-banner");
    if (!el) return;
    // #offline-banner is role="status"; a live region mutated while hidden is
    // not reliably announced, so reveal it before writing the text.
    el.hidden = false;
    el.textContent = message;
}

function hideBanner() {
    const el = document.getElementById("offline-banner");
    if (el) el.hidden = true;
}

// Wraps a user action so any failure -- network or not -- shows a notice
// instead of failing silently in the console.
async function withNetworkGuard(fn) {
    try {
        await fn();
        // A GuestStore write succeeds with no network at all, so a success is
        // no evidence that connectivity returned. While the browser says we're
        // offline the banner is still true and must stay up; the "online" event
        // below is what clears it.
        if (navigator.onLine) hideBanner();
    } catch (e) {
        // api() reloads the page on 401; nothing to report in that case.
        if (e && e.message === UNAUTHORIZED) return;
        console.error("작업 실패:", e);
        showBanner(errorMessage(e));
    }
}

// Connectivity is back, so an offline notice is no longer true either way.
// The reload is only for the case where the server holds habits we couldn't
// fetch — "online" also fires on Wi-Fi/cellular handoffs and sleep/wake, and a
// guest reading localStorage gains nothing from throwing away their input.
window.addEventListener("online", () => {
    if (bootFailed) location.reload();
    else hideBanner();
});

// ---- misc ----
function googleSvg() {
    return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.9 0 6.6 1.7 8.1 3.1l6-5.8C34.6 3.3 29.8 1 24 1 14.6 1 6.5 6.4 2.6 14.3l7 5.4C11.5 13.6 17.2 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.6 5.2-4.7 7.3l7.2 5.6c4.3-4 6.9-9.9 6.9-16.5z"/>
      <path fill="#FBBC05" d="M9.6 19.7c-.5 1.4-.7 2.8-.7 4.3s.3 2.9.7 4.3l-7-5.4C1.6 20.9 1 22.9 1 24s.6 3.1 1.6 5.1l7-5.4z"/>
      <path fill="#34A853" d="M24 47c5.8 0 10.6-1.9 14.2-5.2l-7.2-5.6c-1.9 1.3-4.5 2.3-7 2.3-6.8 0-12.5-4.1-14.4-9.9l-7 5.4C6.5 41.6 14.6 47 24 47z"/>
    </svg>`;
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

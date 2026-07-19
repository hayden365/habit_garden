"use strict";

// ---- config ----
const WEEKS = 26;                 // how many weeks of grass to show
const MONTHS_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const PRESET_COLORS = ["#3FA34D", "#2E86AB", "#E8A33D", "#C0504D", "#7C5CBF", "#E86A9A"];

let selectedColor = PRESET_COLORS[0];

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
async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    if (res.status === 401) {
        // session gone: bounce back to the login screen
        location.reload();
        throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(`${res.status}`);
    if (res.status === 204) return null;
    return res.json();
}

// ---- boot ----
document.addEventListener("DOMContentLoaded", init);

async function init() {
    const me = await api("/api/me");
    const account = document.getElementById("account");
    const app = document.getElementById("app");

    if (!me.loggedIn) {
        account.innerHTML = "";
        renderLogin(app);
        return;
    }

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

    renderApp(app);
    await loadHabits();
}

// ---- login view ----
function renderLogin(root) {
    root.innerHTML = `
        <section class="hero">
            <div class="demo-grid" id="demo-grid"></div>
            <h1>오늘의 작은 습관,<br/>한 칸씩 잔디로.</h1>
            <p>코딩테스트 5문제 풀기처럼 아주 작은 습관을 정하고<br/>매일 체크하세요. 기록이 쌓여 나만의 잔디밭이 됩니다.</p>
            <a class="btn-google" href="/oauth2/authorization/google">
                ${googleSvg()} Google로 시작하기
            </a>
        </section>
    `;
    // decorative sample grass
    const demo = document.getElementById("demo-grid");
    const set = new Set();
    const today = parseYMD(seoulToday());
    for (let i = 0; i < WEEKS * 7; i++) {
        if (Math.random() < 0.45) set.add(fmtYMD(addDays(today, -i)));
    }
    demo.appendChild(buildGrid(set, seoulToday(), "#3FA34D", { interactive: false }));
}

// ---- app view (logged in) ----
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

async function loadHabits() {
    const habits = await api("/api/habits");
    const container = document.getElementById("habits");
    container.innerHTML = "";
    if (!habits.length) {
        container.innerHTML = `<div class="empty">아직 습관이 없어요. 위에서 첫 습관을 심어보세요 🌱</div>`;
        return;
    }
    habits.forEach(h => container.appendChild(renderHabit(h)));
}

async function addHabit() {
    const input = document.getElementById("new-title");
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    input.value = "";
    await api("/api/habits", {
        method: "POST",
        body: JSON.stringify({ title, color: selectedColor }),
    });
    await loadHabits();
}

async function toggleHabit(id) {
    const updated = await api(`/api/habits/${id}/toggle`, { method: "POST" });
    const card = document.querySelector(`[data-habit="${id}"]`);
    if (card) card.replaceWith(renderHabit(updated));
}

async function deleteHabit(id, title) {
    if (!confirm(`"${title}" 습관과 기록을 삭제할까요?`)) return;
    await api(`/api/habits/${id}`, { method: "DELETE" });
    const card = document.querySelector(`[data-habit="${id}"]`);
    if (card) card.remove();
    const container = document.getElementById("habits");
    if (container && !container.children.length) loadHabits();
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

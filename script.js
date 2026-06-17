(() => {
  "use strict";

  const STORAGE_KEY = "chengfaKoujueGame.v1";
  const MAX_HISTORY = 500;
  const MAX_RENDERED_HISTORY = 60;
  const DEFAULT_SETTINGS = Object.freeze({ aMin: 1, aMax: 9, bMin: 1, bMax: 9 });

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    current: null,
    previousKey: "",
    history: [],
    stats: {},
  };

  const els = {
    rangeAMin: document.querySelector("#rangeAMin"),
    rangeAMax: document.querySelector("#rangeAMax"),
    rangeBMin: document.querySelector("#rangeBMin"),
    rangeBMax: document.querySelector("#rangeBMax"),
    applySettings: document.querySelector("#applySettings"),
    resetData: document.querySelector("#resetData"),
    statusMessage: document.querySelector("#statusMessage"),
    rangeLabel: document.querySelector("#rangeLabel"),
    factorA: document.querySelector("#factorA"),
    factorB: document.querySelector("#factorB"),
    answerDisplay: document.querySelector("#answerDisplay"),
    keypad: document.querySelector("#keypad"),
    miniTable: document.querySelector("#miniTable"),
    historyList: document.querySelector("#historyList"),
    toggleTable: document.querySelector("#toggleTable"),
    tableDetails: document.querySelector("#tableDetails"),
    toggleHistory: document.querySelector("#toggleHistory"),
    historyDetails: document.querySelector("#historyDetails"),
    toggleSettings: document.querySelector("#toggleSettings"),
    settingsDetails: document.querySelector("#settingsDetails"),
    summary: document.querySelector("#summary"),
  };

  let audioContext = null;
  let statusTimer = 0;

  function clampFactor(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    const safeFallback = Number.isInteger(fallback) ? fallback : 1;
    if (!Number.isFinite(parsed)) return safeFallback;
    return Math.min(9, Math.max(1, parsed));
  }

  function normalizeRange(min, max) {
    let low = clampFactor(min, 1);
    let high = clampFactor(max, 9);
    if (low > high) {
      const temp = low;
      low = high;
      high = temp;
    }
    return [low, high];
  }

  function normalizeSettings(raw, fallback = DEFAULT_SETTINGS) {
    const [aMin, aMax] = normalizeRange(raw?.aMin ?? fallback.aMin, raw?.aMax ?? fallback.aMax);
    const [bMin, bMax] = normalizeRange(raw?.bMin ?? fallback.bMin, raw?.bMax ?? fallback.bMax);
    return { aMin, aMax, bMin, bMax };
  }

  function formulaKey(a, b) {
    const x = Math.min(a, b);
    const y = Math.max(a, b);
    return `${x}x${y}`;
  }

  function getValidPairs(settings) {
    const pairs = [];
    for (let a = settings.aMin; a <= settings.aMax; a += 1) {
      for (let b = settings.bMin; b <= settings.bMax; b += 1) {
        if (a <= b) pairs.push([a, b]);
      }
    }
    return pairs;
  }

  function isValidSettings(settings) {
    return getValidPairs(settings).length > 0;
  }

  function readSettingsInputs() {
    return normalizeSettings({
      aMin: els.rangeAMin.value,
      aMax: els.rangeAMax.value,
      bMin: els.rangeBMin.value,
      bMax: els.rangeBMax.value,
    }, state.settings);
  }

  function renderSettings() {
    els.rangeAMin.value = state.settings.aMin;
    els.rangeAMax.value = state.settings.aMax;
    els.rangeBMin.value = state.settings.bMin;
    els.rangeBMax.value = state.settings.bMax;
    els.rangeLabel.textContent = `A ${state.settings.aMin}-${state.settings.aMax}，B ${state.settings.bMin}-${state.settings.bMax}`;
  }

  function showStatus(message, isError = true) {
    window.clearTimeout(statusTimer);
    els.statusMessage.textContent = message;
    els.statusMessage.style.color = isError ? "var(--bad)" : "var(--good)";
    if (message) {
      statusTimer = window.setTimeout(() => {
        els.statusMessage.textContent = "";
      }, 3600);
    }
  }

  function validateRecord(record) {
    if (!record || typeof record !== "object") return null;
    const a = Number(record.a);
    const b = Number(record.b);
    const answer = Number(record.answer);
    const input = String(record.input ?? "");
    const correct = record.correct === true;
    const incorrect = record.correct === false;

    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > 9 || b < 1 || b > 9 || a > b) return null;
    if (answer !== a * b) return null;
    if (!correct && !incorrect) return null;
    if (!/^\d+$/.test(input)) return null;

    return {
      id: Number.isFinite(Number(record.id)) ? Number(record.id) : Date.now(),
      a,
      b,
      answer,
      input,
      correct,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
    };
  }

  function buildStatsFromHistory(history) {
    const stats = {};
    for (const record of history) {
      const key = formulaKey(record.a, record.b);
      if (!stats[key]) stats[key] = [];
      if (stats[key].length < 5) stats[key].push(record.correct);
    }
    return stats;
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1) return;

      const settings = normalizeSettings(saved.settings, DEFAULT_SETTINGS);
      state.settings = isValidSettings(settings) ? settings : { ...DEFAULT_SETTINGS };

      const history = Array.isArray(saved.history) ? saved.history : [];
      state.history = history.map(validateRecord).filter(Boolean).slice(0, MAX_HISTORY);
      state.stats = buildStatsFromHistory(state.history);
    } catch (error) {
      state.settings = { ...DEFAULT_SETTINGS };
      state.history = [];
      state.stats = {};
      showStatus("读取本地记录失败，已使用默认数据。", true);
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings: state.settings,
        history: state.history,
      }));
    } catch (error) {
      showStatus("记录保存失败，刷新后可能丢失。", true);
    }
  }

  function renderProblem() {
    if (!state.current) return;
    els.answerDisplay.classList.remove("is-correct", "is-wrong");
    els.factorA.textContent = state.current.a;
    els.factorB.textContent = state.current.b;
    els.answerDisplay.textContent = state.current.input;
  }

  function getProblemWeight(a, b) {
    const rate = getRecentAccuracy(a, b);
    if (rate === null) return 7;
    if (rate === 0) return 6;
    if (rate <= 25) return 5;
    if (rate <= 50) return 4;
    if (rate < 100) return 3;
    return 1;
  }

  function chooseWeightedPair(pairs) {
    const weightedPairs = pairs.map(([a, b]) => ({
      a,
      b,
      weight: getProblemWeight(a, b),
    }));
    const totalWeight = weightedPairs.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * totalWeight;

    for (const item of weightedPairs) {
      cursor -= item.weight;
      if (cursor <= 0) return [item.a, item.b];
    }

    const last = weightedPairs[weightedPairs.length - 1];
    return [last.a, last.b];
  }

  function generateProblem() {
    let pairs = getValidPairs(state.settings);
    if (!pairs.length) {
      state.settings = { ...DEFAULT_SETTINGS };
      renderSettings();
      pairs = getValidPairs(state.settings);
      showStatus("当前范围没有可出题目，已恢复为 1-9。", true);
    }

    if (pairs.length > 1 && state.previousKey) {
      const filtered = pairs.filter(([a, b]) => formulaKey(a, b) !== state.previousKey);
      if (filtered.length) pairs = filtered;
    }

    const [a, b] = chooseWeightedPair(pairs);
    state.current = {
      a,
      b,
      answer: String(a * b),
      input: "",
      resolved: false,
    };
    state.previousKey = formulaKey(a, b);
    renderProblem();
  }

  function makeRecord(correct) {
    const now = Date.now();
    return {
      id: now,
      a: state.current.a,
      b: state.current.b,
      answer: Number(state.current.answer),
      input: state.current.input,
      correct,
      timestamp: new Date(now).toISOString(),
    };
  }

  function updateStats(record) {
    const key = formulaKey(record.a, record.b);
    if (!state.stats[key]) state.stats[key] = [];
    state.stats[key].unshift(record.correct);
    if (state.stats[key].length > 5) state.stats[key].length = 5;
  }

  function scoreCurrent(correct) {
    if (!state.current || state.current.resolved) return;
    state.current.resolved = true;

    const record = makeRecord(correct);
    state.history.unshift(record);
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
    updateStats(record);
    saveState();
    renderHistory();
    renderMiniTable();
    renderSummary();
    if (!correct) els.answerDisplay.textContent = state.current.answer;
    els.answerDisplay.classList.toggle("is-correct", correct);
    els.answerDisplay.classList.toggle("is-wrong", !correct);
    playSound(correct);
    window.setTimeout(generateProblem, correct ? 1000 : 3000);
  }

  function handleDigit(digit) {
    if (!state.current || state.current.resolved) return;
    state.current.input += digit;
    renderProblem();

    const target = state.current.answer;
    const input = state.current.input;
    if (!target.startsWith(input)) {
      scoreCurrent(false);
      return;
    }

    if (input.length === target.length) {
      scoreCurrent(true);
    }
  }

  function applySettings() {
    const nextSettings = readSettingsInputs();
    if (!isValidSettings(nextSettings)) {
      renderSettings();
      showStatus("这个范围没有符合 A≤B 的题目，已保留原范围。", true);
      return;
    }

    state.settings = nextSettings;
    saveState();
    renderSettings();
    generateProblem();
    showStatus("范围已更新。", false);
  }

  function resetData() {
    const confirmed = window.confirm("确定要清空所有练习记录吗？范围设置会保留。");
    if (!confirmed) return;
    state.history = [];
    state.stats = {};
    saveState();
    renderHistory();
    renderMiniTable();
    renderSummary();
    showStatus("练习记录已清空。", false);
  }

  function renderSummary() {
    let correct = 0;
    let wrong = 0;
    for (const record of state.history) {
      if (record.correct) correct += 1;
      else wrong += 1;
    }
    const total = correct + wrong;
    const rate = total ? Math.round((correct / total) * 100) : 0;
    els.summary.textContent = total ? `共 ${total} 题｜对 ${correct}｜错 ${wrong}｜${rate}%` : "共 0 题";
  }

  function renderHistory() {
    els.historyList.textContent = "";
    if (!state.history.length) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "还没有记录，先做一题吧！";
      els.historyList.appendChild(empty);
      return;
    }

    for (const record of state.history.slice(0, MAX_RENDERED_HISTORY)) {
      const item = document.createElement("li");
      item.className = `history-item ${record.correct ? "is-correct" : "is-wrong"}`;

      const main = document.createElement("span");
      main.className = "history-main";

      const formula = document.createElement("span");
      formula.className = "history-formula";
      formula.textContent = `${record.a}×${record.b}=${record.answer}`;
      main.appendChild(formula);

      if (!record.correct) {
        const wrongAnswer = document.createElement("span");
        wrongAnswer.className = "wrong-answer";
        wrongAnswer.textContent = record.input;
        main.appendChild(wrongAnswer);
      }

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = record.correct ? "✓" : "✗";
      mark.setAttribute("aria-label", record.correct ? "正确" : "错误");

      item.appendChild(main);
      item.appendChild(mark);
      els.historyList.appendChild(item);
    }
  }

  function getRecentAttempts(a, b) {
    const attempts = state.stats[formulaKey(a, b)];
    return Array.isArray(attempts) ? attempts : [];
  }

  function getRecentAccuracy(a, b) {
    const attempts = getRecentAttempts(a, b);
    if (!attempts.length) return null;
    const correct = attempts.filter(Boolean).length;
    return Math.round((correct / attempts.length) * 100);
  }

  function accuracyClass(a, b) {
    const rate = getRecentAccuracy(a, b);
    if (rate === null) return "acc-empty";
    if (rate === 0) return "acc-0";
    if (rate <= 20) return "acc-20";
    if (rate <= 40) return "acc-40";
    if (rate <= 60) return "acc-60";
    if (rate < 100) return "acc-80";
    return "acc-100";
  }

  function renderMiniTable() {
    els.miniTable.textContent = "";
    for (let a = 1; a <= 9; a += 1) {
      const column = document.createElement("div");
      column.className = "table-column";
      for (let b = a; b <= 9; b += 1) {
        const attempts = getRecentAttempts(a, b);
        const correct = attempts.filter(Boolean).length;
        const wrong = attempts.length - correct;
        const rate = getRecentAccuracy(a, b);
        const cell = document.createElement("div");
        cell.className = `table-cell ${accuracyClass(a, b)}`;
        cell.textContent = `${a}×${b}`;
        cell.title = attempts.length
          ? `${a}×${b}：最近 5 次正确率 ${rate}%（最近已做 ${attempts.length} 次：正确 ${correct}，错误 ${wrong}）`
          : `${a}×${b}：还没做过`;
        cell.setAttribute("aria-label", cell.title);
        column.appendChild(cell);
      }
      els.miniTable.appendChild(column);
    }
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playTone(steps) {
    try {
      const context = getAudioContext();
      if (!context) return;
      const startedAt = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(steps[0].frequency, startedAt);
      for (const step of steps) {
        oscillator.frequency.linearRampToValueAtTime(step.frequency, startedAt + step.at);
      }

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startedAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + steps[steps.length - 1].at + 0.08);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + steps[steps.length - 1].at + 0.1);
    } catch (error) {
      // 声音只是提示，失败时不影响练习。
    }
  }

  function playSound(correct) {
    if (correct) {
      playTone([
        { frequency: 620, at: 0 },
        { frequency: 880, at: 0.1 },
        { frequency: 1040, at: 0.18 },
      ]);
    } else {
      playTone([
        { frequency: 260, at: 0 },
        { frequency: 170, at: 0.16 },
      ]);
    }
  }

  function toggleSection(button, content) {
    const willCollapse = !content.hidden;
    content.hidden = willCollapse;
    button.setAttribute("aria-expanded", String(!willCollapse));
    button.textContent = willCollapse ? "展开" : "收起";
  }

  function bindEvents() {
    els.keypad.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-digit]");
      if (!button) return;
      handleDigit(button.dataset.digit);
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (
        target.matches("input, textarea, select") || target.isContentEditable
      );
      if (isEditing) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleDigit(event.key);
      }
    });

    els.applySettings.addEventListener("click", applySettings);
    els.resetData.addEventListener("click", resetData);
    els.toggleTable.addEventListener("click", () => toggleSection(els.toggleTable, els.tableDetails));
    els.toggleHistory.addEventListener("click", () => toggleSection(els.toggleHistory, els.historyDetails));
    els.toggleSettings.addEventListener("click", () => toggleSection(els.toggleSettings, els.settingsDetails));

    for (const input of [els.rangeAMin, els.rangeAMax, els.rangeBMin, els.rangeBMax]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applySettings();
      });
    }
  }

  function init() {
    loadState();
    renderSettings();
    renderHistory();
    renderMiniTable();
    renderSummary();
    generateProblem();
    bindEvents();
  }

  init();
})();

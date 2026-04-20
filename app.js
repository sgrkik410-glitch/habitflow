'use strict';

// ===============================
// 定数定義
// ===============================

const STORAGE_KEY_HABITS = 'habitflow_habits';
const STORAGE_KEY_SETTINGS = 'habitflow_settings';
const STORAGE_KEY_METRICS = 'habitflow_metrics';

// 絵文字アイコン一覧
const ICONS = [
  '🏃', '🚴', '🏊', '💪', '🧘', '🤸', '🏋️', '⚽',
  '🎾', '🏸', '🚶', '🧗', '📚', '📖', '✏️', '🎓',
  '🧠', '💡', '🔬', '🎹', '🎨', '✍️', '💻', '🎯',
  '🥗', '🥤', '💊', '😴', '🛁', '🌅', '🌙', '☕',
  '🧹', '🌱', '🌿', '🍎', '💧', '🔋', '🙏', '❤️',
  '😊', '🤗', '✨', '🌟', '💬', '📝', '⏰', '💰',
  '📱', '🎮', '🚗', '✈️', '🏠', '🌍', '🎵', '🎬',
];

// カテゴリ一覧
const CATEGORIES = ['健康', '学習', '生活', 'メンタル', 'その他'];

// カラーパレット
const COLORS = [
  '#7c3aed', // パープル
  '#06b6d4', // シアン
  '#10b981', // グリーン
  '#f59e0b', // アンバー
  '#ec4899', // ピンク
  '#ef4444', // レッド
  '#3b82f6', // ブルー
  '#6366f1', // インディゴ
  '#14b8a6', // ティール
  '#f97316', // オレンジ
];

// 曜日・月名
const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

// ===============================
// アプリ状態
// ===============================
let habits = [];
let settings = {};
let dailyMetrics = {};
let currentTab = 'today';
let editingHabitId = null;
let selectedIcon = '😊';
let selectedColor = COLORS[0];
let selectedCategory = CATEGORIES[0];
let selectedFrequency = [0, 1, 2, 3, 4, 5, 6];
let selectedGoalType = 'check';
let selectedGoalValue = 1;
let heatmapYear = new Date().getFullYear();
let heatmapMonth = new Date().getMonth();
let deferredInstallPrompt = null;
let healthChart = null; // Chart.jsのインスタンスを保持

// XP・タイマープロパティ
let activeTimerInfo = null;

// 通知・リマインダー管理
let reminderCheckInterval = null;
let lastCheckedMinute = -1;
const notifiedToday = new Set(); // 今日すでに通知済みの習慣IDを管理

// ===============================
// 日付ユーティリティ
// ===============================

/**
 * DateオブジェクトをYYYY-MM-DD形式に変換する
 */
function getDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 指定した日付で、その習慣が実行予定（アクティブ）かどうかを判定する
 */
function isHabitDueOnDate(habit, dateObj) {
  const dateStr = getDateString(dateObj);
  if (habit.skips && habit.skips[dateStr]) return false;
  if (!habit.frequency) return true; // 旧データのフォールバック
  return habit.frequency.includes(dateObj.getDay());
}

/**
 * 過去7日間の日付文字列配列を返す（今日を含む、古い順）
 */
function getLast7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(getDateString(d));
  }
  return days;
}

/**
 * 指定年月の日数を返す
 */
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 指定年月の初日の曜日（0=日曜）を返す
 */
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

/**
 * 日付文字列を日本語表示用にフォーマットする
 */
function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = getDateString();
  const yesterday = getDateString(new Date(Date.now() - 86400000));
  if (dateStr === today) return '今日';
  if (dateStr === yesterday) return '昨日';
  return `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAY_SHORT[d.getDay()]})`;
}

// ===============================
// データ管理とXP計算
// ===============================

/**
 * XPを加算しUIとレベルを更新する
 */
function addXp(amount) {
  if (!settings.userProfile) settings.userProfile = { level: 1, xp: 0 };
  settings.userProfile.xp += amount;
  
  let requiredXp = settings.userProfile.level * 100;
  let leveledUp = false;
  
  while (settings.userProfile.xp >= requiredXp) {
    settings.userProfile.xp -= requiredXp;
    settings.userProfile.level++;
    requiredXp = settings.userProfile.level * 100;
    leveledUp = true;
  }
  
  saveSettings();
  renderUserProfile();
  
  if (leveledUp) {
    showLevelUpAnimation(settings.userProfile.level);
  }
}

/**
 * 習慣の今日の進捗状況を取得する
 */
function getHabitProgress(habit, dateStr) {
  const val = habit.completions && habit.completions[dateStr];
  if (!val) return { done: false, count: 0 };
  if (val === true) return { done: true, count: 1 };
  
  if (habit.goalType === 'count') {
    const c = Number(val);
    const target = Number(habit.goalValue) || 1;
    return { done: c >= target, count: c, target };
  }
  
  return { done: !!val, count: val ? 1 : 0 };
}

/**
 * 習慣データをlocalStorageに保存する
 */
function saveHabits() {
  localStorage.setItem(STORAGE_KEY_HABITS, JSON.stringify(habits));
}

/**
 * 習慣データをlocalStorageから読み込む
 */
function loadHabits() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_HABITS);
    habits = data ? JSON.parse(data) : [];
    // データの整合性チェックとデフォルト値の補完
    habits = habits.filter(h => h && h.id && h.name).map(h => ({
      ...h,
      frequency: h.frequency || [0, 1, 2, 3, 4, 5, 6],
      skips: h.skips || {}
    }));
  } catch (e) {
    habits = [];
  }
}

/**
 * 設定をlocalStorageに保存する
 */
function saveSettings() {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}

/**
 * 設定をlocalStorageから読み込む
 */
function loadSettings() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_SETTINGS);
    settings = data ? JSON.parse(data) : {};
    if (!settings.userProfile) settings.userProfile = { level: 1, xp: 0 };
  } catch (e) {
    settings = { userProfile: { level: 1, xp: 0 } };
  }
  renderUserProfile();
}

/**
 * 健康記録データをlocalStorageに保存する
 */
function saveMetrics() {
  localStorage.setItem(STORAGE_KEY_METRICS, JSON.stringify(dailyMetrics));
}

/**
 * 健康記録データをlocalStorageから読み込む
 */
function loadMetrics() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_METRICS);
    dailyMetrics = data ? JSON.parse(data) : {};
  } catch (e) {
    dailyMetrics = {};
  }
}

// ===============================
// ストリーク計算
// ===============================

/**
 * 習慣の現在のストリーク（連続達成日数）を計算する
 */
function getCurrentStreak(habit) {
  let streak = 0;
  const today = new Date();
  const todayStr = getDateString(today);
  
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getDateString(d);
    
    const isCompleted = getHabitProgress(habit, dateStr).done;
    
    if (isCompleted) {
      streak++;
    } else {
      const isDue = isHabitDueOnDate(habit, d);
      if (isDue && dateStr < todayStr) {
        break; // 過去の実行日で未完了ならストリーク終了
      }
      // isDueがfalseならペナルティなしで過去へ遡る
      // 今日が未完了の場合もストリークは維持
    }
  }
  return streak;
}

/**
 * 習慣の最長ストリークを計算する
 */
function getBestStreak(habit) {
  let best = 0;
  let current = 0;
  const today = new Date();
  for (let i = 365; i >= 0; i--) { // 古い日から今日へ
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getDateString(d);
    
    const isCompleted = getHabitProgress(habit, dateStr).done;
    const isDue = isHabitDueOnDate(habit, d);
    
    if (isCompleted) {
      current++;
      best = Math.max(best, current);
    } else if (isDue) {
      current = 0; // 実行予定なのに未完了なら0に戻る
    }
  }
  return best;
}

/**
 * 過去N日間の達成率を計算する
 */
function getCompletionRate(habit, days = 7) {
  if (!habit.completions) return 0;
  let completed = 0;
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (getHabitProgress(habit, getDateString(d)).done) completed++;
  }
  return Math.round((completed / days) * 100);
}

/**
 * 全習慣の中での最長ストリークを取得する
 */
function getOverallBestStreak() {
  if (habits.length === 0) return 0;
  return Math.max(0, ...habits.map(h => getBestStreak(h)));
}

/**
 * 全習慣の総完了数を取得する
 */
function getTotalCompletions() {
  return habits.reduce((sum, h) => {
    if (!h.completions) return sum;
    let count = 0;
    Object.keys(h.completions).forEach(d => {
      if (getHabitProgress(h, d).done) count++;
    });
    return sum + count;
  }, 0);
}

/**
 * 今週の全習慣の平均達成率を取得する
 */
function getWeeklyCompletionRate() {
  if (habits.length === 0) return 0;
  const rates = habits.map(h => getCompletionRate(h, 7));
  return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
}

// ===============================
// 習慣CRUD操作
// ===============================

/**
 * 新しい習慣を作成してリストに追加する
 */
function createHabit(data) {
  const habit = {
    id: 'habit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    name: data.name,
    icon: data.icon,
    color: data.color,
    category: data.category,
    reminderEnabled: data.reminderEnabled || false,
    reminderTime: data.reminderTime || '08:00',
    frequency: data.frequency || [0, 1, 2, 3, 4, 5, 6],
    goalType: data.goalType || 'check',
    goalValue: data.goalValue || 1,
    skips: {},
    memos: {},
    createdAt: new Date().toISOString(),
    completions: {},
  };
  habits.push(habit);
  saveHabits();
  return habit;
}

/**
 * 既存の習慣を更新する
 */
function updateHabit(id, data) {
  const index = habits.findIndex(h => h.id === id);
  if (index === -1) return null;
  habits[index] = { ...habits[index], ...data };
  saveHabits();
  return habits[index];
}

/**
 * 習慣を削除する
 */
function deleteHabit(id) {
  habits = habits.filter(h => h.id !== id);
  saveHabits();
}

/**
 * 指定日の習慣の完了状態をトグルする
 */
function toggleCompletion(habitId, dateStr = getDateString()) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;
  if (!habit.completions) habit.completions = {};

  if (habit.completions[dateStr]) {
    delete habit.completions[dateStr];
  } else {
    habit.completions[dateStr] = true;
  }
  saveHabits();
}

// ===============================
// HTMLエスケープ（XSS対策）
// ===============================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ===============================
// レンダリング - 今日タブ
// ===============================

/**
 * 今日の日付を表示する
 */
function renderDateDisplay() {
  const today = new Date();
  const weekdays = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const el = document.getElementById('date-display');
  if (el) {
    el.textContent = `${today.getMonth() + 1}月${today.getDate()}日 ${weekdays[today.getDay()]}`;
  }
}

/**
 * プログレス円グラフを更新する
 */
function renderProgress() {
  const todayStr = getDateString();
  const todayDate = new Date();
  
  const activeHabits = habits.filter(h => isHabitDueOnDate(h, todayDate));
  const total = activeHabits.length;
  const completed = activeHabits.filter(h => getHabitProgress(h, todayStr).done).length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  const fill = document.getElementById('progress-circle-fill');
  const text = document.getElementById('progress-text');
  if (fill) fill.style.strokeDasharray = `${pct}, 100`;
  if (text) text.textContent = `${pct}%`;

  // 全完了バナーの表示/非表示
  const banner = document.getElementById('completion-banner');
  if (banner) {
    if (total > 0 && completed === total) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
}

/**
 * 週間ミニカレンダーをレンダリングする
 */
function renderWeekCalendar() {
  const container = document.getElementById('week-calendar');
  if (!container) return;

  const today = getDateString();
  const days = getLast7Days();

  container.innerHTML = days.map(dateStr => {
    const date = new Date(dateStr + 'T00:00:00');
    const dayNum = date.getDate();
    const dayLabel = WEEKDAY_SHORT[date.getDay()];
    const isToday = dateStr === today;

    // その日の完了状況を計算
    const dayActiveHabits = habits.filter(h => isHabitDueOnDate(h, date));
    const total = dayActiveHabits.length;
    const completed = dayActiveHabits.filter(h => getHabitProgress(h, dateStr).done).length;
    const isDone = total > 0 && completed === total;
    const isPartial = total > 0 && completed > 0 && completed < total;

    let dotClass = 'week-day-dot';
    if (isDone) dotClass += ' completed';
    else if (isPartial) dotClass += ' partial';
    if (isToday) dotClass += ' today';

    return `
      <div class="week-day">
        <span class="week-day-label">${dayLabel}</span>
        <div class="${dotClass}">${dayNum}</div>
      </div>
    `;
  }).join('');
}

/**
 * 習慣カードのHTMLを生成する
 */
function renderHabitCard(habit, animIndex = 0, isSkipped = false) {
  const today = getDateString();
  const prog = getHabitProgress(habit, today);
  const isCompleted = prog.done;
  const streak = getCurrentStreak(habit);
  const last7 = getLast7Days();

  const weekDotsHtml = last7.map(d => {
    const done = getHabitProgress(habit, d).done;
    const due = isHabitDueOnDate(habit, new Date(d + 'T00:00:00'));
    let dotStyle = done ? `background:${habit.color}` : '';
    let dotClass = 'habit-week-dot';
    if (done) dotClass += ' done';
    if (!due && !done) dotClass += ' skip';
    
    return `<div class="${dotClass}" style="${dotStyle}"></div>`;
  }).join('');

  const streakLabel = streak > 0
    ? `🔥 ${streak}日連続`
    : `🌱 はじめましょう`;
    
  let checkHtml = '';
  if (habit.goalType === 'count') {
    checkHtml = `<span class="habit-check-inner">${prog.count}/${habit.goalValue || 1}</span>`;
    if (isCompleted) checkHtml = '✓';
  } else if (habit.goalType === 'timer') {
    checkHtml = isCompleted ? '✓' : `<span class="habit-check-inner">⏱️</span>`;
  } else {
    checkHtml = isCompleted ? '✓' : '';
  }

  return `
    <div class="habit-card ${isCompleted ? 'completed' : ''} ${isSkipped ? 'skipped' : ''}"
      data-id="${habit.id}"
      style="--habit-color: ${habit.color}; animation-delay: ${animIndex * 0.06}s; ${isSkipped ? 'opacity: 0.7; filter: grayscale(50%);' : ''}">
      <div class="habit-icon-wrap" data-action="memo">
        <div class="habit-icon-bg" style="background: ${habit.color}"></div>
        <span class="habit-icon-emoji">${habit.icon}</span>
      </div>
      <div class="habit-info" data-action="memo">
        <div class="habit-name">${escapeHtml(habit.name)}</div>
        <div class="habit-meta">
          <span class="habit-streak">${streakLabel}</span>
          <div class="habit-week-dots">${weekDotsHtml}</div>
        </div>
      </div>
      <button class="habit-check"
        data-id="${habit.id}"
        data-action="toggle"
        aria-label="${escapeHtml(habit.name)}を完了にする"
        aria-checked="${isCompleted}">
        ${checkHtml}
      </button>
    </div>
  `;
}

/**
 * 今日タブ全体をレンダリングする
 */
function renderTodayTab() {
  renderDateDisplay();
  renderProgress();
  renderWeekCalendar();

  const listEl = document.getElementById('habits-list');
  const skippedContainer = document.getElementById('skipped-habits-container');
  const skippedListEl = document.getElementById('skipped-habits-list');
  const emptyEl = document.getElementById('empty-state');
  if (!listEl || !emptyEl) return;

  if (habits.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.innerHTML = '';
    if(skippedContainer) skippedContainer.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  const todayStr = getDateString();
  const todayDate = new Date();
  
  const activeHabits = [];
  const skippedHabits = [];
  
  habits.forEach(h => {
    if (isHabitDueOnDate(h, todayDate)) activeHabits.push(h);
    else skippedHabits.push(h);
  });

  // アクティブな習慣（完了済みを下へソート）
  activeHabits.sort((a, b) => {
    const aComp = getHabitProgress(a, todayStr).done;
    const bComp = getHabitProgress(b, todayStr).done;
    return aComp - bComp;
  });

  listEl.innerHTML = activeHabits.map((h, i) => renderHabitCard(h, i)).join('');

  // お休みの習慣をレンダリング
  if (skippedHabits.length > 0 && skippedContainer && skippedListEl) {
    skippedContainer.classList.remove('hidden');
    skippedListEl.innerHTML = skippedHabits.map((h, i) => renderHabitCard(h, i, true)).join('');
  } else if (skippedContainer) {
    skippedContainer.classList.add('hidden');
  }

  // 健康記録フォームに今日のデータを反映
  const intakeInput = document.getElementById('metric-intake');
  const burnedInput = document.getElementById('metric-burned');
  const weightInput = document.getElementById('metric-weight');
  const metrics = dailyMetrics[today] || {};
  if (intakeInput) intakeInput.value = metrics.intake || '';
  if (burnedInput) burnedInput.value = metrics.burned || '';
  if (weightInput) weightInput.value = metrics.weight || '';
}

// ===============================
// レンダリング - 統計タブ
// ===============================

/**
 * 統計タブをレンダリングする
 */
function renderStatsTab() {
  // サマリー数値を更新
  const bestStreak = document.getElementById('stat-best-streak');
  const compRate = document.getElementById('stat-completion-rate');
  const totalComp = document.getElementById('stat-total-completions');
  if (bestStreak) bestStreak.textContent = getOverallBestStreak();
  if (compRate) compRate.textContent = getWeeklyCompletionRate() + '%';
  if (totalComp) totalComp.textContent = getTotalCompletions();

  renderHealthChart();
  renderHabitStreaks();
  renderHeatmap();
}

/**
 * 習慣別ストリークリストをレンダリングする
 */
function renderHabitStreaks() {
  const container = document.getElementById('habit-streaks');
  if (!container) return;

  if (habits.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; padding: 24px; 
        font-size:14px;">習慣を追加すると統計が表示されます</div>`;
    return;
  }

  const maxStreak = Math.max(...habits.map(h => getCurrentStreak(h)), 1);

  container.innerHTML = habits.map(h => {
    const streak = getCurrentStreak(h);
    const barWidth = Math.max((streak / maxStreak) * 100, streak > 0 ? 4 : 0);

    return `
      <div class="streak-item">
        <div class="streak-habit-icon">${h.icon}</div>
        <div class="streak-info">
          <div class="streak-name">${escapeHtml(h.name)}</div>
          <div class="streak-bar-container">
            <div class="streak-bar" style="width: ${barWidth}%; background: ${h.color};"></div>
          </div>
        </div>
        <div class="streak-count">
          <span class="streak-count-value" style="color: ${h.color}">${streak}</span>
          <span class="streak-count-label">日連続</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 月間ヒートマップをレンダリングする
 */
function renderHeatmap() {
  const container = document.getElementById('monthly-heatmap');
  if (!container) return;

  const today = getDateString();
  const daysInMonth = getDaysInMonth(heatmapYear, heatmapMonth);
  const firstDay = getFirstDayOfMonth(heatmapYear, heatmapMonth);

  // 空セル（月初めの端数）
  const cellsHtml = [];
  for (let i = 0; i < firstDay; i++) {
    cellsHtml.push('<div class="heatmap-cell empty"></div>');
  }

  // 各日のセル
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${heatmapYear}-${String(heatmapMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === today;
    const isFuture = dateStr > today;

    if (habits.length === 0) {
      cellsHtml.push(`<div class="heatmap-cell no-habits ${isToday ? 'is-today' : ''}">${day}</div>`);
      continue;
    }

    if (isFuture) {
      cellsHtml.push(`<div class="heatmap-cell no-data ${isToday ? 'is-today' : ''}" style="opacity:0.25">${day}</div>`);
      continue;
    }

    const total = habits.length;
    const completed = habits.filter(h => getHabitProgress(h, dateStr).done).length;
    const ratio = completed / total;

    let levelClass = 'no-data';
    if (total > 0) {
      if (ratio === 0)    levelClass = 'no-data';
      else if (ratio < 0.25) levelClass = 'level-1';
      else if (ratio < 0.5)  levelClass = 'level-2';
      else if (ratio < 1)    levelClass = 'level-3';
      else                   levelClass = 'level-4';
    }

    cellsHtml.push(`
      <div class="heatmap-cell ${levelClass} ${isToday ? 'is-today' : ''}"
        title="${dateStr}: ${completed}/${total}達成">${day}</div>
    `);
  }

  // ナビゲーションが現在月を超えないようにする
  const now = new Date();
  const isCurrentMonth = heatmapYear === now.getFullYear() && heatmapMonth === now.getMonth();

  container.innerHTML = `
    <div class="heatmap-header">
      <span class="heatmap-month">${heatmapYear}年 ${MONTH_NAMES[heatmapMonth]}</span>
      <div class="heatmap-nav">
        <button class="heatmap-nav-btn" id="heatmap-prev" aria-label="前月">‹</button>
        <button class="heatmap-nav-btn" id="heatmap-next" aria-label="翌月"
          ${isCurrentMonth ? 'disabled style="opacity:0.3"' : ''}>›</button>
      </div>
    </div>
    <div class="heatmap-weekdays">
      ${WEEKDAY_SHORT.map(d => `<div class="heatmap-weekday">${d}</div>`).join('')}
    </div>
    <div class="heatmap-grid">
      ${cellsHtml.join('')}
    </div>
  `;

  // ナビゲーションイベント
  document.getElementById('heatmap-prev').addEventListener('click', () => {
    heatmapMonth--;
    if (heatmapMonth < 0) { heatmapMonth = 11; heatmapYear--; }
    renderHeatmap();
  });

  const nextBtn = document.getElementById('heatmap-next');
  if (nextBtn && !isCurrentMonth) {
    nextBtn.addEventListener('click', () => {
      heatmapMonth++;
      if (heatmapMonth > 11) { heatmapMonth = 0; heatmapYear++; }
      renderHeatmap();
    });
  }
}

/**
 * 健康記録推移（カロリー・体重）をグラフで描画する
 */
function renderHealthChart() {
  const canvas = document.getElementById('health-chart');
  if (!canvas) return;

  // Chart.js が読み込まれていない場合はスキップ
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not loaded.');
    return;
  }

  // 過去7日間の日付を取得し、古い順に並び替え（グラフ表示用）
  const labels = getLast7Days().reverse();

  const dataIntake = [];
  const dataBurned = [];
  const dataWeight = [];

  labels.forEach(dateStr => {
    const m = dailyMetrics[dateStr] || {};
    dataIntake.push(m.intake || null);
    dataBurned.push(m.burned || null);
    dataWeight.push(m.weight || null);
  });

  // 日付ラベルを「M/D」形式にする
  const formattedLabels = labels.map(l => {
    const d = new Date(l);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  if (healthChart) {
    healthChart.destroy();
  }

  healthChart = new Chart(canvas, {
    type: 'line', // 基本タイプはLine
    data: {
      labels: formattedLabels,
      datasets: [
        {
          label: '摂取カロリー (kcal)',
          data: dataIntake,
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          yAxisID: 'y-calories',
          spanGaps: true,
          tension: 0.2
        },
        {
          label: '消費カロリー (kcal)',
          data: dataBurned,
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          yAxisID: 'y-calories',
          spanGaps: true,
          tension: 0.2
        },
        {
          label: '体重 (kg)',
          data: dataWeight,
          borderColor: '#06b6d4',
          backgroundColor: '#06b6d4',
          borderDash: [5, 5], // 点線で区別
          yAxisID: 'y-weight',
          spanGaps: true,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      color: '#9ca3af', // tooltip text color
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#d1d5db',
            usePointStyle: true,
            boxWidth: 8
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            color: '#9ca3af'
          }
        },
        'y-calories': {
          type: 'linear',
          position: 'left',
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          },
          ticks: {
            color: '#9ca3af'
          },
          title: {
            display: true,
            text: 'kcal',
            color: '#9ca3af',
            font: { size: 10 }
          }
        },
        'y-weight': {
          type: 'linear',
          position: 'right',
          grid: {
            drawOnChartArea: false // 左右のグリッド線の重なりを防ぐ
          },
          ticks: {
            color: '#06b6d4'
          },
          title: {
            display: true,
            text: 'kg',
            color: '#06b6d4',
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// ===============================
// レンダリング - 履歴タブ
// ===============================

/**
 * 履歴タブをレンダリングする（過去30日間）
 */
function renderHistoryTab() {
  const container = document.getElementById('history-content');
  if (!container) return;

  if (habits.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; padding: 48px; font-size:14px;">
        習慣を追加すると履歴が表示されます
      </div>`;
    return;
  }

  const today = new Date();
  const groups = [];

  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getDateString(d);

    const completedHabits = habits.filter(h => getHabitProgress(h, dateStr).done);
    const metrics = dailyMetrics[dateStr];
    const hasMetrics = metrics && (metrics.intake || metrics.burned || metrics.weight);

    // 今日か、何かしら記録のある日のみ表示
    if (i === 0 || completedHabits.length > 0 || hasMetrics) {
      groups.push({ dateStr, completedCount: completedHabits.length, total: habits.length, metrics });
    }
  }

  if (groups.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; padding: 48px; font-size:14px;">
        まだ記録がありません
      </div>`;
    return;
  }

  container.innerHTML = groups.map(g => {
    const rate = Math.round((g.completedCount / g.total) * 100) || 0;
    const habitItems = habits.map(h => {
      const done = getHabitProgress(h, g.dateStr).done;
      const memoText = (h.memos && h.memos[g.dateStr]) ? h.memos[g.dateStr] : '';
      return `
        <div class="history-habit-item-wrap" style="display: flex; flex-direction: column;">
          <div class="history-habit-item">
            <span class="history-habit-icon">${h.icon}</span>
            <span class="history-habit-name"
              style="${done ? '' : 'color: var(--text-muted)'}">
              ${escapeHtml(h.name)}
            </span>
            <span class="history-habit-check">${done ? '✅' : '⬜'}</span>
          </div>
          ${memoText ? `<span class="history-memo">💬 ${escapeHtml(memoText)}</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="history-date-group">
        <div class="history-date-header">
          <span class="history-date-label">${formatDateJa(g.dateStr)}</span>
          <span class="history-date-rate">${rate}% 達成</span>
        </div>
        ${g.metrics && (g.metrics.intake || g.metrics.burned || g.metrics.weight) ? `
        <div class="history-metrics">
          ${g.metrics.intake ? `<div class="history-metric-item">🍔 <span class="history-metric-val">${g.metrics.intake}</span>kcal</div>` : ''}
          ${g.metrics.burned ? `<div class="history-metric-item">🔥 <span class="history-metric-val">${g.metrics.burned}</span>kcal</div>` : ''}
          ${g.metrics.weight ? `<div class="history-metric-item">⚖️ <span class="history-metric-val">${g.metrics.weight}</span>kg</div>` : ''}
        </div>
        ` : ''}
        ${habitItems}
      </div>
    `;
  }).join('');
}

// ===============================
// モーダル管理
// ===============================

/**
 * アイコングリッドを初期化する
 */
function initIconGrid() {
  const grid = document.getElementById('icon-grid');
  if (!grid) return;

  grid.innerHTML = ICONS.map(icon => `
    <button class="icon-option ${icon === selectedIcon ? 'selected' : ''}"
      data-icon="${icon}"
      aria-label="${icon}">${icon}</button>
  `).join('');

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-option');
    if (!btn) return;
    selectedIcon = btn.dataset.icon;
    const iconBtn = document.getElementById('selected-icon-btn');
    if (iconBtn) iconBtn.textContent = selectedIcon;
    grid.querySelectorAll('.icon-option').forEach(b => {
      b.classList.toggle('selected', b.dataset.icon === selectedIcon);
    });
  });
}

/**
 * カテゴリピッカーを初期化する
 */
function initCategoryPicker() {
  const picker = document.getElementById('category-picker');
  if (!picker) return;

  picker.innerHTML = CATEGORIES.map(cat => `
    <button class="category-option ${cat === selectedCategory ? 'selected' : ''}"
      data-cat="${cat}">${cat}</button>
  `).join('');

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.category-option');
    if (!btn) return;
    selectedCategory = btn.dataset.cat;
    picker.querySelectorAll('.category-option').forEach(b => {
      b.classList.toggle('selected', b.dataset.cat === selectedCategory);
    });
  });
}

/**
 * カラーピッカーを初期化する
 */
function initColorPicker() {
  const picker = document.getElementById('color-picker');
  if (!picker) return;

  picker.innerHTML = COLORS.map(color => `
    <button class="color-option ${color === selectedColor ? 'selected' : ''}"
      data-color="${color}"
      style="border-color: ${color === selectedColor ? 'rgba(255,255,255,0.6)' : 'transparent'}"
      aria-label="色: ${color}">
      <div class="color-option-inner" style="background: ${color}"></div>
    </button>
  `).join('');

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-option');
    if (!btn) return;
    selectedColor = btn.dataset.color;
    picker.querySelectorAll('.color-option').forEach(b => {
      const isSelected = b.dataset.color === selectedColor;
      b.classList.toggle('selected', isSelected);
      b.style.borderColor = isSelected ? 'rgba(255,255,255,0.6)' : 'transparent';
    });
  });
}

/**
 * 曜日ピッカーを初期化する
 */
function initFrequencyPicker() {
  const picker = document.getElementById('frequency-picker');
  if (!picker) return;

  picker.querySelectorAll('.freq-option').forEach(btn => {
    const dayIndex = parseInt(btn.dataset.day, 10);
    btn.classList.toggle('selected', selectedFrequency.includes(dayIndex));
  });

  // イベントの重複登録を防ぐためのハック
  if (!picker.dataset.initialized) {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.freq-option');
      if (!btn) return;
      const dayIndex = parseInt(btn.dataset.day, 10);
      
      if (selectedFrequency.includes(dayIndex)) {
        selectedFrequency = selectedFrequency.filter(d => d !== dayIndex);
      } else {
        selectedFrequency.push(dayIndex);
      }
      btn.classList.toggle('selected', selectedFrequency.includes(dayIndex));
    });
    picker.dataset.initialized = 'true';
  }
}

/**
 * 目標タイプピッカーを初期化する
 */
function initGoalTypePicker() {
  const picker = document.getElementById('goal-type-picker');
  const group = document.getElementById('goal-value-group');
  const label = document.getElementById('goal-value-label');
  const unit = document.getElementById('goal-value-unit');
  const input = document.getElementById('goal-value-input');
  
  if (!picker) return;

  const updateUI = () => {
    picker.querySelectorAll('.goal-type-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.type === selectedGoalType);
    });
    
    if (selectedGoalType === 'check') {
      group.classList.add('hidden');
    } else {
      group.classList.remove('hidden');
      if (selectedGoalType === 'count') {
        label.textContent = '目標回数';
        unit.textContent = '回';
        // Checkから切り替わったときのデフォルト値セット
        if (input.value == 1 && selectedGoalValue == 1) input.value = 3; 
        else input.value = selectedGoalValue;
      } else if (selectedGoalType === 'timer') {
        label.textContent = '目標時間';
        unit.textContent = '分';
        if (input.value == 1 && selectedGoalValue == 1) input.value = 15;
        else input.value = selectedGoalValue;
      }
    }
  };

  updateUI();

  if (!picker.dataset.initialized) {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.goal-type-btn');
      if (!btn) return;
      selectedGoalType = btn.dataset.type;
      // 入力中の値も変数に退避
      selectedGoalValue = Number(input.value) || 1; 
      updateUI();
    });
    picker.dataset.initialized = 'true';
  }
}

/**
 * 習慣追加モーダルを開く
 */
function openAddModal() {
  editingHabitId = null;
  selectedIcon = '😊';
  selectedColor = COLORS[0];
  selectedCategory = CATEGORIES[0];
  selectedFrequency = [0, 1, 2, 3, 4, 5, 6];
  selectedGoalType = 'check';
  selectedGoalValue = 1;

  document.getElementById('modal-title-text').textContent = '習慣を追加';
  document.getElementById('habit-name-input').value = '';
  document.getElementById('selected-icon-btn').textContent = selectedIcon;
  document.getElementById('reminder-toggle').checked = false;
  document.getElementById('reminder-time').disabled = true;
  document.getElementById('reminder-time').value = '08:00';
  document.getElementById('delete-habit-row').classList.add('hidden');
  document.getElementById('skip-habit-row').classList.add('hidden');
  const gInput = document.getElementById('goal-value-input');
  if (gInput) gInput.value = 1;

  initIconGrid();
  initCategoryPicker();
  initColorPicker();
  initFrequencyPicker();
  initGoalTypePicker();

  document.getElementById('habit-modal').classList.remove('hidden');

  // キーボードが開く前にスクロール
  setTimeout(() => {
    const input = document.getElementById('habit-name-input');
    if (input) input.focus();
  }, 400);
}

/**
 * 習慣編集モーダルを開く
 */
function openEditModal(habitId) {
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;

  editingHabitId = habitId;
  selectedIcon = habit.icon;
  selectedColor = habit.color;
  selectedCategory = habit.category;
  selectedFrequency = habit.frequency ? [...habit.frequency] : [0, 1, 2, 3, 4, 5, 6];
  selectedGoalType = habit.goalType || 'check';
  selectedGoalValue = habit.goalValue || 1;

  document.getElementById('modal-title-text').textContent = '習慣を編集';
  document.getElementById('habit-name-input').value = habit.name;
  document.getElementById('selected-icon-btn').textContent = habit.icon;
  document.getElementById('reminder-toggle').checked = habit.reminderEnabled || false;
  document.getElementById('reminder-time').value = habit.reminderTime || '08:00';
  document.getElementById('reminder-time').disabled = !(habit.reminderEnabled);
  document.getElementById('delete-habit-row').classList.remove('hidden');

  const gInput = document.getElementById('goal-value-input');
  if (gInput) gInput.value = selectedGoalValue;

  const skipRow = document.getElementById('skip-habit-row');
  const skipBtn = document.getElementById('btn-skip-habit');
  skipRow.classList.remove('hidden');
  
  const todayStr = getDateString();
  if (habit.skips && habit.skips[todayStr]) {
    skipBtn.textContent = '🔄 今日のお休みを取り消す';
  } else {
    skipBtn.textContent = '💤 今日をお休みにする';
  }

  initIconGrid();
  initCategoryPicker();
  initColorPicker();
  initFrequencyPicker();
  initGoalTypePicker();

  document.getElementById('habit-modal').classList.remove('hidden');
}

/**
 * モーダルを閉じる
 */
function closeModal() {
  document.getElementById('habit-modal').classList.add('hidden');
  editingHabitId = null;
}

/**
 * モーダルのデータを保存する
 */
function saveFromModal() {
  const nameInput = document.getElementById('habit-name-input');
  const name = nameInput ? nameInput.value.trim() : '';

  if (!name) {
    showToast('習慣の名前を入力してください', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  const goalValueInput = document.getElementById('goal-value-input');
  const countVal = goalValueInput ? Number(goalValueInput.value) : 1;
  selectedGoalValue = Math.max(1, countVal);

  const data = {
    name,
    icon: selectedIcon,
    color: selectedColor,
    category: selectedCategory,
    frequency: selectedFrequency,
    goalType: selectedGoalType,
    goalValue: selectedGoalValue,
    reminderEnabled: document.getElementById('reminder-toggle').checked,
    reminderTime: document.getElementById('reminder-time').value,
  };

  if (editingHabitId) {
    updateHabit(editingHabitId, data);
    showToast('習慣を更新しました ✨', 'success');
  } else {
    createHabit(data);
    showToast('習慣を追加しました 🌱', 'success');
  }

  closeModal();
  renderAll();
}

// ===============================
// 確認ダイアログ
// ===============================

/**
 * 確認ダイアログを表示する
 */
function showConfirmModal({ title, message, onConfirm, confirmText = '削除', icon = '⚠️' }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = confirmText;
  document.getElementById('confirm-icon').textContent = icon;

  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('hidden');

  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  const overlay = document.getElementById('confirm-overlay');

  const close = () => {
    modal.classList.add('hidden');
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', close);
    overlay.removeEventListener('click', close);
  };

  const handleOk = () => {
    close();
    onConfirm();
  };

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
}

// ===============================
// トースト通知
// ===============================

/**
 * トースト通知を表示する
 */
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===============================
// ナビゲーション
// ===============================

/**
 * タブを切り替える
 */
function switchTab(tabName) {
  if (currentTab === tabName) return;
  currentTab = tabName;

  // タブパネルの切り替え
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  const targetPane = document.getElementById(`tab-${tabName}`);
  if (targetPane) targetPane.classList.add('active');

  // ナビゲーションのアクティブ状態更新
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });

  // タブ固有のレンダリング
  switch (tabName) {
    case 'today':    renderTodayTab();    break;
    case 'stats':    renderStatsTab();    break;
    case 'history':  renderHistoryTab();  break;
  }
}

// ===============================
// 全体レンダリング
// ===============================

/**
 * 現在のタブを再レンダリングする
 */
function renderAll() {
  switch (currentTab) {
    case 'today':    renderTodayTab();    break;
    case 'stats':    renderStatsTab();    break;
    case 'history':  renderHistoryTab();  break;
  }
}

// ===============================
// タップイベント処理
// ===============================

/**
 * 習慣リストのクリック（タップ）イベントを処理する
 */
function handleHabitListClick(e) {
  const card = e.target.closest('.habit-card');
  if (!card) return;
  const habitId = card.dataset.id;
  const habit = habits.find(h => h.id === habitId);
  if (!habit) return;

  const todayStr = getDateString();
  const prog = getHabitProgress(habit, todayStr);

  const toggleBtn = e.target.closest('[data-action="toggle"]');
  const memoEl = e.target.closest('[data-action="memo"]');

  // チェックボタンを押した時
  if (toggleBtn) {
    if (habit.goalType === 'timer' && !prog.done) {
      openTimerModal(habit);
      return;
    }
    
    if (!habit.completions) habit.completions = {};

    if (habit.goalType === 'count') {
      if (!prog.done) {
        habit.completions[todayStr] = prog.count + 1;
        addXp(2); // 部分完了
        if (prog.count + 1 >= (habit.goalValue || 1)) {
          addXp(8); // フル完了で残り加算
        }
      } else {
        delete habit.completions[todayStr];
      }
    } else {
      if (prog.done) {
        delete habit.completions[todayStr];
      } else {
        habit.completions[todayStr] = true;
        addXp(10);
      }
    }
    
    // リップルエフェクト
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    const rect = toggleBtn.getBoundingClientRect();
    const x = Math.max(0, (e.clientX || e.touches?.[0]?.clientX || rect.left + rect.width / 2) - rect.left - 50);
    const y = Math.max(0, (e.clientY || e.touches?.[0]?.clientY || rect.top + rect.height / 2) - rect.top - 50);
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    toggleBtn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
    
    if (navigator.vibrate) navigator.vibrate(30);

    saveHabits();
    renderAll();
    return;
  }

  // カード本体を押した時（メモ）
  if (memoEl) {
    openMemoModal(habit, todayStr);
    return;
  }
}

// ===============================
// タイマー＆メモモーダル機能
// ===============================

function openTimerModal(habit) {
  const modal = document.getElementById('timer-modal');
  const nameEl = document.getElementById('timer-habit-name');
  const iconEl = document.getElementById('timer-icon');
  const display = document.getElementById('timer-display');
  const fill = document.getElementById('timer-circle-fill');
  const startBtn = document.getElementById('timer-start-btn');
  const stopBtn = document.getElementById('timer-stop-btn');

  if (!modal || !nameEl) return;

  nameEl.textContent = habit.name;
  iconEl.textContent = habit.icon;
  
  const targetMinutes = habit.goalValue || 15;
  let remainingSeconds = targetMinutes * 60;
  const totalSeconds = remainingSeconds;
  
  if (activeTimerInfo) {
    clearInterval(activeTimerInfo.interval);
    activeTimerInfo = null;
  }

  const updateDisplay = () => {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const pct = (remainingSeconds / totalSeconds) * 283;
    fill.style.strokeDasharray = `${pct}, 283`;
  };

  updateDisplay();
  modal.classList.remove('hidden');
  startBtn.textContent = 'スタート';
  startBtn.onclick = () => {
    if (activeTimerInfo && activeTimerInfo.isRunning) {
      // 一時停止
      clearInterval(activeTimerInfo.interval);
      activeTimerInfo.isRunning = false;
      startBtn.textContent = '再開';
    } else {
      // スタート
      startBtn.textContent = '一時停止';
      if (!activeTimerInfo) activeTimerInfo = { habitId: habit.id, isRunning: true };
      else activeTimerInfo.isRunning = true;
      
      activeTimerInfo.interval = setInterval(() => {
        remainingSeconds--;
        updateDisplay();
        if (remainingSeconds <= 0) {
          clearInterval(activeTimerInfo.interval);
          activeTimerInfo = null;
          modal.classList.add('hidden');
          
          if (!habit.completions) habit.completions = {};
          habit.completions[getDateString()] = true;
          addXp(10);
          saveHabits();
          renderAll();
          showToast(`「${habit.name}」達成！🎉`, 'success');
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      }, 1000);
    }
  };

  const closeTimer = () => {
    if (activeTimerInfo) clearInterval(activeTimerInfo.interval);
    activeTimerInfo = null;
    modal.classList.add('hidden');
  };

  stopBtn.onclick = closeTimer;
  document.getElementById('timer-close-btn').onclick = closeTimer;
}

function openMemoModal(habit, dateStr) {
  const modal = document.getElementById('memo-modal');
  const nameEl = document.getElementById('memo-habit-name');
  const input = document.getElementById('memo-input');
  const saveBtn = document.getElementById('memo-save');
  const closeBtn = document.getElementById('memo-close');
  const overlay = document.getElementById('memo-overlay');

  if (!modal) return;

  nameEl.textContent = `${habit.icon} ${habit.name} のメモ`;
  input.value = (habit.memos && habit.memos[dateStr]) || '';
  modal.classList.remove('hidden');
  
  // キーボード開くの待つ
  setTimeout(() => input.focus(), 100);

  const closeMemo = () => modal.classList.add('hidden');

  saveBtn.onclick = () => {
    if (!habit.memos) habit.memos = {};
    const val = input.value.trim();
    if (val) {
      habit.memos[dateStr] = val;
    } else {
      delete habit.memos[dateStr];
    }
    saveHabits();
    renderAll();
    closeMemo();
    showToast('メモを保存しました', 'success');
  };

  const removeListeners = () => {
    closeBtn.removeEventListener('click', handleCloseClick);
    overlay.removeEventListener('click', handleCloseClick);
  };
  const handleCloseClick = () => {
    closeMemo();
    removeListeners();
  };

  closeBtn.addEventListener('click', handleCloseClick);
  overlay.addEventListener('click', handleCloseClick);
}

/**
 * 長押し検出を設定する（習慣カードの編集）
 */
function setupLongPress() {
  const list = document.getElementById('habits-list');
  if (!list) return;

  let timer = null;
  let startX = 0;
  let startY = 0;

  list.addEventListener('touchstart', (e) => {
    const card = e.target.closest('.habit-card');
    // チェックボタン上の長押しは無視
    if (!card || e.target.closest('[data-action="toggle"]')) return;

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    card.classList.add('long-pressing');

    timer = setTimeout(() => {
      timer = null;
      card.classList.remove('long-pressing');
      const habitId = card.dataset.id;
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      openEditModal(habitId);
    }, 600);
  }, { passive: true });

  list.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(timer);
      timer = null;
      document.querySelectorAll('.habit-card.long-pressing').forEach(c => {
        c.classList.remove('long-pressing');
      });
    }
  }, { passive: true });

  const clearLongPress = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    document.querySelectorAll('.habit-card.long-pressing').forEach(c => {
      c.classList.remove('long-pressing');
    });
  };

  list.addEventListener('touchend', clearLongPress, { passive: true });
  list.addEventListener('touchcancel', clearLongPress, { passive: true });

  // デスクトップ用：右クリックで編集
  list.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.habit-card');
    if (!card) return;
    e.preventDefault();
    openEditModal(card.dataset.id);
  });
}

// ===============================
// 設定画面イベント
// ===============================

/**
 * データをJSONとしてエクスポートする
 */
function exportData() {
  const data = {
    habits,
    dailyMetrics,
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    app: 'HabitFlow',
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `habitflow_backup_${getDateString()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('データをエクスポートしました 📤', 'success');
}

/**
 * JSONファイルからデータをインポートする
 */
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.habits || !Array.isArray(data.habits)) {
        throw new Error('フォーマットが無効です');
      }
      habits = data.habits.filter(h => h && h.id && h.name);
      saveHabits();
      
      if (data.dailyMetrics) {
        dailyMetrics = data.dailyMetrics;
        saveMetrics();
      }

      renderAll();
      showToast(`${habits.length}件の習慣をインポートしました 📥`, 'success');
    } catch (err) {
      showToast('ファイルの読み込みに失敗しました', 'error');
    }
  };
  reader.readAsText(file);
}

/**
 * 全データを削除する
 */
function clearAllData() {
  showConfirmModal({
    title: '全データを削除',
    message: 'すべての習慣と記録が削除されます。この操作は取り消せません。',
    confirmText: '削除する',
    icon: '🗑️',
    onConfirm: () => {
      habits = [];
      saveHabits();
      dailyMetrics = {};
      saveMetrics();
      renderAll();
      showToast('データをすべて削除しました', 'info');
    },
  });
}

// ===============================
// PWA関連
// ===============================

/**
 * Service Workerを登録する
 */
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      // Service Worker登録失敗はアプリ動作に影響しない
    }
  }
}

// ===============================
// アプリ初期化
// ===============================

// ===============================
// 通知・リマインダー機能
// ===============================

/**
 * Notification APIの許可を要求する
 */
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('このブラウザは通知に対応していません', 'error');
    return false;
  }

  if (Notification.permission === 'granted') {
    showToast('通知はすでに許可されています 🔔', 'info');
    startReminderChecker();
    updateNotificationStatusUI();
    return true;
  }

  if (Notification.permission === 'denied') {
    showToast('通知がブロックされています。ブラウザの設定から許可してください', 'error');
    updateNotificationStatusUI();
    return false;
  }

  // 許可ダイアログを表示（"default" 状態の場合）
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    showToast('通知を許可しました 🔔', 'success');
    startReminderChecker();
  } else {
    showToast('通知が拒否されました', 'error');
  }
  updateNotificationStatusUI();
  return permission === 'granted';
}

/**
 * リマインダーチェッカーを開始する（30秒ごとに時刻を確認）
 */
function startReminderChecker() {
  if (reminderCheckInterval) clearInterval(reminderCheckInterval);
  checkReminders(); // 即時チェック
  reminderCheckInterval = setInterval(checkReminders, 30000);
}

/**
 * 日付が変わった場合は今日の通知済みセットをリセットする
 */
function resetDailyNotificationsIfNeeded() {
  const today = getDateString();
  if (settings.lastNotificationDate !== today) {
    notifiedToday.clear();
    settings.lastNotificationDate = today;
    saveSettings();
  }
}

/**
 * 現在時刻とリマインダー設定を照合して通知を送信する
 */
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  resetDailyNotificationsIfNeeded();

  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();

  // 同じ分に複数回チェックが走っても通知しない
  if (currentMinute === lastCheckedMinute) return;
  lastCheckedMinute = currentMinute;

  const currentTime =
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = getDateString();

  habits.forEach(habit => {
    if (!habit.reminderEnabled || !habit.reminderTime) return;
    if (habit.reminderTime !== currentTime) return;
    if (notifiedToday.has(habit.id)) return; // 今日すでに通知済み
    if (habit.completions && habit.completions[today]) return; // すでに完了済みなら通知しない

    notifiedToday.add(habit.id);
    showHabitNotification(habit);
  });
}

/**
 * 指定した習慣のリマインダー通知を表示する
 */
async function showHabitNotification(habit) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const title = `${habit.icon} ${habit.name}の時間です！`;
  const body = 'HabitFlow でチェックしましょう 💪';
  const notifOptions = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: `habit-reminder-${habit.id}`,
    data: { habitId: habit.id },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  try {
    // Service Worker が有効なら SW 経由（バックグラウンドでも動作）
    const sw = navigator.serviceWorker;
    if (sw && sw.controller) {
      sw.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        ...notifOptions,
      });
    } else {
      // フォールバック：直接 Notification API
      new Notification(title, notifOptions);
    }
  } catch (err) {
    try {
      new Notification(title, notifOptions);
    } catch (e) {
      // 通知表示失敗時はサイレントに無視
    }
  }
}

/**
 * 設定画面の通知ステータス表示を更新する
 */
function updateNotificationStatusUI() {
  const btn = document.getElementById('btn-notification-permission');
  const sub = document.getElementById('notification-status-sub');
  const badge = document.getElementById('notification-status-badge');
  if (!btn) return;

  if (!('Notification' in window)) {
    if (sub) sub.textContent = 'このブラウザは通知に対応していません';
    if (badge) { badge.textContent = '非対応'; badge.className = 'notification-badge'; }
    btn.disabled = true;
    return;
  }

  switch (Notification.permission) {
    case 'granted':
      if (sub) sub.textContent = 'リマインダーをONにした習慣に通知します';
      if (badge) { badge.textContent = '許可済み ✅'; badge.className = 'notification-badge granted'; }
      btn.disabled = true;
      btn.style.opacity = '0.7';
      break;
    case 'denied':
      if (sub) sub.textContent = 'ブラウザの設定から通知を許可してください';
      if (badge) { badge.textContent = 'ブロック ❌'; badge.className = 'notification-badge denied'; }
      btn.disabled = false;
      break;
    default:
      if (sub) sub.textContent = 'タップして通知を有効にする';
      if (badge) { badge.textContent = '未設定'; badge.className = 'notification-badge'; }
      btn.disabled = false;
      break;
  }
}

/**
 * アプリを初期化して、全イベントリスナーを設定する
 */
function init() {
  // データを読み込む
  loadHabits();
  loadSettings();
  loadMetrics();

  // スプラッシュスクリーンの非表示処理
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.style.display = 'none';
        const app = document.getElementById('app');
        if (app) app.classList.remove('hidden');
        renderTodayTab();
      }, 500);
    }
  }, 1800);

  // ===== ボトムナビゲーション =====
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // ===== FABボタン（習慣追加） =====
  const fabBtn = document.getElementById('fab-btn');
  if (fabBtn) {
    fabBtn.addEventListener('click', openAddModal);
  }

  // ===== 習慣リスト（チェックトグル） =====
  const habitsList = document.getElementById('habits-list');
  if (habitsList) {
    habitsList.addEventListener('click', handleHabitListClick);
  }

  // ===== 長押し（編集） =====
  setupLongPress();

  // ===== モーダル =====
  const modalClose = document.getElementById('modal-close');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay) modalOverlay.addEventListener('click', closeModal);

  const modalSave = document.getElementById('modal-save');
  if (modalSave) modalSave.addEventListener('click', saveFromModal);

  // ===== リマインダートグル =====
  const reminderToggle = document.getElementById('reminder-toggle');
  if (reminderToggle) {
    reminderToggle.addEventListener('change', async (e) => {
      const timeInput = document.getElementById('reminder-time');
      if (timeInput) timeInput.disabled = !e.target.checked;
      // リマインダーをONにした時に通知許可を要求する
      if (e.target.checked) {
        await requestNotificationPermission();
      }
    });
  }

  // ===== 削除ボタン（編集モーダル内） =====
  const deleteBtn = document.getElementById('btn-delete-habit');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!editingHabitId) return;
      const habit = habits.find(h => h.id === editingHabitId);
      if (!habit) return;

      showConfirmModal({
        title: '習慣を削除',
        message: `「${habit.name}」を削除しますか？記録もすべて削除されます。`,
        confirmText: '削除する',
        icon: '🗑️',
        onConfirm: () => {
          deleteHabit(editingHabitId);
          closeModal();
          renderAll();
          showToast('習慣を削除しました', 'info');
        },
      });
    });
  }

  // ===== スキップボタン（編集モーダル内） =====
  const skipBtn = document.getElementById('btn-skip-habit');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      if (!editingHabitId) return;
      const habit = habits.find(h => h.id === editingHabitId);
      if (!habit) return;

      const todayStr = getDateString();
      if (!habit.skips) habit.skips = {};
      
      if (habit.skips[todayStr]) {
        delete habit.skips[todayStr];
        showToast('今日のお休みを取り消しました', 'info');
      } else {
        habit.skips[todayStr] = true;
        // もし今日すでに完了していたら完了状態も解除する
        if (habit.completions && habit.completions[todayStr]) {
          delete habit.completions[todayStr];
        }
        showToast('今日はお休みにしました 💤', 'info');
      }
      
      saveHabits();
      closeModal();
      renderAll();
    });
  }

  // ===== 設定画面ボタン =====
  const btnExport = document.getElementById('btn-export');
  if (btnExport) btnExport.addEventListener('click', exportData);

  const btnImport = document.getElementById('btn-import');
  const importInput = document.getElementById('import-input');
  if (btnImport && importInput) {
    btnImport.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importData(e.target.files[0]);
      }
      e.target.value = '';
    });
  }

  const btnClear = document.getElementById('btn-clear');
  if (btnClear) btnClear.addEventListener('click', clearAllData);

  // ===== PWAインストール =====
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installSection = document.getElementById('pwa-install-section');
    if (installSection) installSection.style.display = 'block';
  });

  const btnInstallPwa = document.getElementById('btn-install-pwa');
  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('ホーム画面に追加しました！', 'success');
        const installSection = document.getElementById('pwa-install-section');
        if (installSection) installSection.style.display = 'none';
      }
      deferredInstallPrompt = null;
    });
  }

  // ===== 通知許可ボタン（設定画面） =====
  const btnNotificationPerm = document.getElementById('btn-notification-permission');
  if (btnNotificationPerm) {
    btnNotificationPerm.addEventListener('click', requestNotificationPermission);
  }

  // ===== Service Worker登録 =====
  registerServiceWorker();

  // ===== 通知ステータスの初期表示 =====
  updateNotificationStatusUI();

  // ===== 通知許可済みならリマインダーチェッカーを開始 =====
  if ('Notification' in window && Notification.permission === 'granted') {
    startReminderChecker();
  }

  // ===== 健康記録の自動保存 =====
  const intakeInput = document.getElementById('metric-intake');
  const burnedInput = document.getElementById('metric-burned');
  const weightInput = document.getElementById('metric-weight');

  const saveMetricsHandler = () => {
    const today = getDateString();
    if (!dailyMetrics[today]) {
      dailyMetrics[today] = {};
    }
    dailyMetrics[today].intake = intakeInput.value ? Number(intakeInput.value) : null;
    dailyMetrics[today].burned = burnedInput.value ? Number(burnedInput.value) : null;
    dailyMetrics[today].weight = weightInput.value ? Number(weightInput.value) : null;
    saveMetrics();
  };

  if (intakeInput) intakeInput.addEventListener('change', saveMetricsHandler);
  if (burnedInput) burnedInput.addEventListener('change', saveMetricsHandler);
  if (weightInput) weightInput.addEventListener('change', saveMetricsHandler);
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', init);

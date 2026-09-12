(() => {
  "use strict";

  if (!window.DashboardData) {
    console.error("ReminderService requires shared/dashboard-data.js to load first.");
    return;
  }

  if (!window.BellService) {
    console.error("ReminderService requires shared/bell-service.js to load first.");
    return;
  }

  const STORAGE_KEY = "teacherDashboard.classReminders.v1";
  const CHANGE_EVENT = "teacher-dashboard-reminders-changed";
  const TODO_STORAGE_KEY = "teacherDashboard.todoList.v1";
  const TODO_CHANGE_EVENT = "teacher-dashboard-todos-changed";
  const BELL_STATE_KEY = "teacherDashboard.bellState.v1";
  const PASSING_MINUTES = 4;
  const INSTANCE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const CLAIM_MS = 15000;
  const POLL_MS = 1000;

  const VALID_TIMINGS = new Set([
    "start",
    "after5",
    "custom",
    "before5",
    "before10",
    "end"
  ]);

  const FALLBACK_STARTS = Object.freeze({
    regular: "08:10",
    lateStart: "09:02",
    minimum: "08:10"
  });

  let activeReminderId = "";
  let audioContext = null;
  let checkTimer = null;

  function canThisTabAlert() {
    // Never let a background/prerendered Dashboard tab claim a reminder.
    // The visible Dashboard page should own the popup.
    return document.visibilityState === "visible";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(key) {
    const parts = String(key || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function timeOnDate(timeString, date) {
    const [hours, minutes] = String(timeString || "").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      hours,
      minutes,
      0,
      0
    );
  }

  function scheduleLabel(key) {
    if (key === "lateStart") return "Late Start";
    if (key === "minimum") return "Minimum Day";
    return "Regular";
  }

  function getScheduleKeyForDate(date) {
    const requestedKey = dateKey(date);
    const todayKey = dateKey();

    // Today's manual Bell Countdown override is authoritative for reminders too.
    if (requestedKey === todayKey) {
      try {
        const state = JSON.parse(localStorage.getItem(BELL_STATE_KEY) || "{}");
        const mode = String(state?.scheduleMode || "");

        if (
          state?.dateKey === todayKey &&
          ["regular", "lateStart", "minimum"].includes(mode)
        ) {
          return mode;
        }
      } catch (error) {}

      try {
        const snapshot = BellService.getSnapshot();
        if (
          snapshot &&
          ["regular", "lateStart", "minimum"].includes(snapshot.scheduleKey) &&
          (snapshot.targetDateKey === todayKey || snapshot.dateKey === todayKey)
        ) {
          return snapshot.scheduleKey;
        }
      } catch (error) {
        console.warn("ReminderService could not read today's BellService schedule.", error);
      }
    }

    try {
      if (DashboardData.isMinimumDayDate(date)) return "minimum";
    } catch (error) {}

    return date.getDay() === 3 ? "lateStart" : "regular";
  }

  function getSchedule(scheduleKey) {
    try {
      const schedule = DashboardData.getBellSchedule(scheduleKey);
      return Array.isArray(schedule) ? schedule : [];
    } catch (error) {
      console.warn("ReminderService could not read the shared bell schedule.", error);
      return [];
    }
  }

  function getSchoolStart(scheduleKey) {
    try {
      if (typeof DashboardData.getSchoolStartTime === "function") {
        const value = DashboardData.getSchoolStartTime(scheduleKey);
        if (/^\d{2}:\d{2}$/.test(String(value || ""))) return String(value);
      }
    } catch (error) {}

    return FALLBACK_STARTS[scheduleKey] || FALLBACK_STARTS.regular;
  }

  function classLabel(classId) {
    try {
      return DashboardData.getClass(String(classId))?.name || `Period ${classId}`;
    } catch (error) {
      return `Period ${classId}`;
    }
  }

  function targetLabel(reminder) {
    if (reminder?.entryName) return String(reminder.entryName);
    if (reminder?.classId) return classLabel(reminder.classId);
    return "Reminder";
  }

  function scheduleEntryName(reminder) {
    if (reminder?.entryName) return String(reminder.entryName);
    if (reminder?.classId) return `Period ${reminder.classId}`;
    return "";
  }

  function getEntryBounds(reminderLike) {
    const date = dateFromKey(reminderLike?.date || reminderLike?.targetDateKey);
    if (!date) return null;

    const scheduleKey = getScheduleKeyForDate(date);
    const schedule = getSchedule(scheduleKey);
    const wantedName = scheduleEntryName(reminderLike);

    if (!wantedName || !schedule.length) return null;

    const index = schedule.findIndex(
      item => String(item?.name || "").toLocaleLowerCase() === wantedName.toLocaleLowerCase()
    );

    if (index < 0) return null;

    const entry = schedule[index];
    const end = timeOnDate(entry.end, date);
    if (!end) return null;

    let start;

    if (index === 0) {
      start = timeOnDate(getSchoolStart(scheduleKey), date);
    } else {
      const previousEnd = timeOnDate(schedule[index - 1]?.end, date);
      if (!previousEnd) return null;

      // Snack and Lunch begin the instant the preceding class ends.
      // Teaching periods begin after the dashboard's 4-minute passing period.
      if (/^(Snack|Lunch)$/i.test(String(entry.name || ""))) {
        start = previousEnd;
      } else {
        start = new Date(previousEnd.getTime() + PASSING_MINUTES * 60 * 1000);
      }
    }

    if (!start) return null;

    return {
      scheduleKey,
      scheduleLabel: scheduleLabel(scheduleKey),
      start,
      end,
      entry: clone(entry)
    };
  }

  function clampCustomMinutes(value) {
    return Math.max(1, Math.min(60, Math.floor(Number(value) || 10)));
  }

  function timingLabel(timing, customMinutes = 10) {
    switch (timing) {
      case "after5": return "5 minutes into class";
      case "custom": return `${clampCustomMinutes(customMinutes)} minutes before class ends`;
      case "before5": return "5 minutes before class ends";
      case "before10": return "10 minutes before class ends";
      case "end": return "End of class";
      case "start":
      default: return "Start of class";
    }
  }

  function timingLabelForTarget(timing, customMinutes = 10, label = "class", isBreak = false) {
    if (!isBreak) return timingLabel(timing, customMinutes);

    switch (timing) {
      case "after5": return `5 minutes into ${label}`;
      case "custom": return `${clampCustomMinutes(customMinutes)} minutes before ${label} ends`;
      case "before5": return `5 minutes before ${label} ends`;
      case "before10": return `10 minutes before ${label} ends`;
      case "end": return `End of ${label}`;
      case "start":
      default: return `Start of ${label}`;
    }
  }

  function getTriggerTime(reminderLike) {
    const bounds = getEntryBounds(reminderLike);
    if (!bounds) return null;

    const timing = VALID_TIMINGS.has(String(reminderLike?.timing || reminderLike?.trigger || ""))
      ? String(reminderLike.timing || reminderLike.trigger)
      : "start";

    const customMinutes = clampCustomMinutes(reminderLike?.customMinutes);
    let trigger;

    switch (timing) {
      case "after5":
        trigger = new Date(bounds.start.getTime() + 5 * 60 * 1000);
        break;
      case "custom":
        trigger = new Date(bounds.end.getTime() - customMinutes * 60 * 1000);
        break;
      case "before5":
        trigger = new Date(bounds.end.getTime() - 5 * 60 * 1000);
        break;
      case "before10":
        trigger = new Date(bounds.end.getTime() - 10 * 60 * 1000);
        break;
      case "end":
        trigger = new Date(bounds.end);
        break;
      case "start":
      default:
        trigger = new Date(bounds.start);
        break;
    }

    return {
      trigger,
      start: new Date(bounds.start),
      end: new Date(bounds.end),
      scheduleKey: bounds.scheduleKey,
      scheduleLabel: bounds.scheduleLabel,
      entry: clone(bounds.entry)
    };
  }

  function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return 0;
    const number = Number(value);
    if (Number.isFinite(number) && number > 100000000000) return number;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeReminder(item = {}) {
    const legacyClassId = String(item.classId ?? item.periodId ?? "").trim();
    const entryName = String(item.entryName ?? "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? item.targetDateKey ?? ""))
      ? String(item.date ?? item.targetDateKey)
      : dateKey();

    let timing = String(item.timing ?? item.trigger ?? "start");
    if (!VALID_TIMINGS.has(timing)) timing = "start";

    const customMinutes = timing === "before10" ? 10 : clampCustomMinutes(item.customMinutes);
    const completedAt = String(item.completedAt || "");
    const snoozeUntil = parseTimestamp(item.snoozeUntil || item.snoozedUntil);

    let status = String(item.status || "");
    if (!["pending", "alerting", "snoozed", "done", "missed"].includes(status)) {
      if (completedAt) status = "done";
      else if (snoozeUntil > Date.now()) status = "snoozed";
      else if (item.baseTriggeredAt) status = "alerting";
      else status = "pending";
    }

    const normalized = {
      id: String(item.id || makeId()),
      date,
      classId: entryName ? "" : legacyClassId,
      entryName,
      className: String(item.className || ""),
      studentId: String(item.studentId || ""),
      studentClassId: String(item.studentClassId || ""),
      studentName: String(item.studentName || "").trim(),
      text: String(item.text ?? item.note ?? "").trim(),
      timing,
      customMinutes,
      privacy: item.privacy === "private" ? "private" : "normal",
      status,
      triggerAt: parseTimestamp(item.triggerAt),
      triggerLabel: String(item.triggerLabel || ""),
      scheduleKey: String(item.scheduleKey || ""),
      scheduleLabel: String(item.scheduleLabel || ""),
      scheduleUnavailable: item.scheduleUnavailable === true,
      createdAt: String(item.createdAt || new Date().toISOString()),
      completedAt,
      snoozeUntil,
      alertedDueAt: parseTimestamp(item.alertedDueAt || item.lastAlertedDue),
      claimOwner: String(item.claimOwner || ""),
      claimUntil: parseTimestamp(item.claimUntil)
    };

    return recalculateReminder(normalized);
  }

  function recalculateReminder(reminder) {
    const next = { ...reminder };
    const info = getTriggerTime(next);
    const label = targetLabel(next);
    const isBreak = Boolean(next.entryName);

    next.className = label;
    next.triggerLabel = timingLabelForTarget(
      next.timing,
      next.customMinutes,
      label,
      isBreak
    );

    if (info) {
      next.triggerAt = info.trigger.getTime();
      next.scheduleKey = info.scheduleKey;
      next.scheduleLabel = info.scheduleLabel;
      next.scheduleUnavailable = false;
    } else {
      next.triggerAt = 0;
      next.scheduleKey = "";
      next.scheduleLabel = "";
      next.scheduleUnavailable = true;
    }

    if (next.status === "done" && !next.completedAt) {
      next.completedAt = new Date().toISOString();
    }

    return next;
  }

  function readRawState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const reminders = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.reminders)
          ? parsed.reminders
          : [];

      return reminders.map(normalizeReminder);
    } catch (error) {
      console.warn("ReminderService could not load reminders.", error);
      return [];
    }
  }

  function samePersistedReminder(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function writeReminders(reminders, detail = {}, { dispatch = true } = {}) {
    const normalized = reminders.map(normalizeReminder);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, reminders: normalized })
    );

    if (dispatch) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
        detail: {
          reminders: clone(normalized),
          ...detail
        }
      }));
    }

    return clone(normalized);
  }

  function refreshTriggers({ dispatch = false } = {}) {
    const rawText = localStorage.getItem(STORAGE_KEY);
    const before = readRawState();
    const after = before.map(recalculateReminder);

    if (!rawText) return clone(after);

    const changed = before.some((item, index) => !samePersistedReminder(item, after[index]));
    if (changed) {
      return writeReminders(after, { type: "timings-refreshed" }, { dispatch });
    }

    return clone(after);
  }

  function getReminders() {
    return refreshTriggers({ dispatch: false });
  }

  function getReminder(id) {
    return getReminders().find(item => item.id === String(id)) || null;
  }

  function addReminder(input = {}) {
    const classId = String(input.classId || "").trim();
    const entryName = String(input.entryName || "").trim();
    const date = String(input.date || "").trim();
    const text = String(input.text || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dateFromKey(date)) {
      throw new Error("Choose a valid reminder date.");
    }

    if (!classId && !entryName) {
      throw new Error("Choose a period, Snack, or Lunch.");
    }

    if (!text) {
      throw new Error("Enter a reminder first.");
    }

    const reminder = normalizeReminder({
      id: makeId(),
      date,
      classId,
      entryName,
      studentId: input.studentId,
      studentClassId: input.studentClassId,
      studentName: input.studentName,
      text,
      timing: input.timing,
      customMinutes: input.customMinutes,
      privacy: input.privacy,
      status: "pending",
      createdAt: new Date().toISOString(),
      completedAt: "",
      snoozeUntil: 0,
      alertedDueAt: 0,
      claimOwner: "",
      claimUntil: 0
    });

    if (reminder.scheduleUnavailable) {
      const dateObj = dateFromKey(date);
      const scheduleKey = getScheduleKeyForDate(dateObj);
      throw new Error(`${targetLabel(reminder)} is not part of the ${scheduleLabel(scheduleKey)} schedule on that day.`);
    }

    const reminders = readRawState();
    reminders.push(reminder);
    writeReminders(reminders, { type: "reminder-added", reminderId: reminder.id });
    setTimeout(checkDueReminders, 0);

    return clone(reminder);
  }

  function updateReminder(id, updates = {}) {
    const reminders = readRawState();
    const index = reminders.findIndex(item => item.id === String(id));
    if (index < 0) return null;

    const merged = {
      ...reminders[index],
      ...updates
    };

    // Support both the old and current field names.
    if (Object.prototype.hasOwnProperty.call(updates, "snoozedUntil")) {
      merged.snoozeUntil = updates.snoozedUntil;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "note")) {
      merged.text = updates.note;
    }

    const next = normalizeReminder(merged);
    reminders[index] = next;
    writeReminders(reminders, { type: "reminder-updated", reminderId: next.id });

    if (next.status === "done" && activeReminderId === next.id) {
      closeAlert();
    }

    return clone(next);
  }

  function deleteReminder(id) {
    const reminderId = String(id);
    const reminders = readRawState();
    const next = reminders.filter(item => item.id !== reminderId);

    if (next.length === reminders.length) return false;

    writeReminders(next, { type: "reminder-deleted", reminderId });

    if (activeReminderId === reminderId) {
      closeAlert();
    }

    return true;
  }

  function clearCompleted() {
    const reminders = readRawState();
    const completed = reminders.filter(item => item.status === "done" || item.completedAt).length;
    if (!completed) return 0;

    writeReminders(
      reminders.filter(item => !(item.status === "done" || item.completedAt)),
      { type: "completed-cleared", count: completed }
    );

    return completed;
  }

  function normalizeTodo(raw = {}) {
    const createdAt = String(raw.createdAt || "").trim();
    const completedAt = String(raw.completedAt || "").trim();

    return {
      id: String(raw.id || makeId()),
      text: String(raw.text || "").trim(),
      createdAt: createdAt && !Number.isNaN(Date.parse(createdAt))
        ? createdAt
        : new Date().toISOString(),
      completedAt: completedAt && !Number.isNaN(Date.parse(completedAt))
        ? completedAt
        : "",
      source: String(raw.source || "manual").trim() || "manual"
    };
  }

  function readTodos() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TODO_STORAGE_KEY) || "{}");
      const todos = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.todos)
          ? parsed.todos
          : [];

      return todos
        .map(normalizeTodo)
        .filter(todo => todo.text);
    } catch (error) {
      console.warn("ReminderService could not load to-do items.", error);
      return [];
    }
  }

  function writeTodos(todos, detail = {}, { dispatch = true } = {}) {
    const normalized = todos
      .map(normalizeTodo)
      .filter(todo => todo.text);

    localStorage.setItem(
      TODO_STORAGE_KEY,
      JSON.stringify({ version: 1, todos: normalized })
    );

    if (dispatch) {
      window.dispatchEvent(new CustomEvent(TODO_CHANGE_EVENT, {
        detail: {
          todos: clone(normalized),
          ...detail
        }
      }));
    }

    return clone(normalized);
  }

  function getTodos() {
    return clone(readTodos());
  }

  function addTodo(textOrInput = "", options = {}) {
    const input = typeof textOrInput === "object" && textOrInput !== null
      ? textOrInput
      : { text: textOrInput, ...options };

    const text = String(input.text || "").trim();
    if (!text) throw new Error("Enter a to-do item first.");

    const todo = normalizeTodo({
      id: makeId(),
      text,
      createdAt: new Date().toISOString(),
      completedAt: "",
      source: input.source || "manual"
    });

    const todos = readTodos();
    todos.push(todo);
    writeTodos(todos, { type: "todo-added", todoId: todo.id });
    return clone(todo);
  }

  function setTodoCompleted(id, completed = true) {
    const todoId = String(id || "");
    const todos = readTodos();
    const index = todos.findIndex(todo => todo.id === todoId);
    if (index < 0) return null;

    todos[index] = normalizeTodo({
      ...todos[index],
      completedAt: completed ? new Date().toISOString() : ""
    });

    writeTodos(todos, {
      type: completed ? "todo-completed" : "todo-restored",
      todoId
    });

    return clone(todos[index]);
  }

  function deleteTodo(id) {
    const todoId = String(id || "");
    const todos = readTodos();
    const next = todos.filter(todo => todo.id !== todoId);
    if (next.length === todos.length) return false;

    writeTodos(next, { type: "todo-deleted", todoId });
    return true;
  }

  function clearCompletedTodos() {
    const todos = readTodos();
    const completedCount = todos.filter(todo => todo.completedAt).length;
    if (!completedCount) return 0;

    writeTodos(
      todos.filter(todo => !todo.completedAt),
      { type: "todo-completed-cleared", count: completedCount }
    );

    return completedCount;
  }

  function effectiveDue(reminder) {
    if (reminder.status === "snoozed" && reminder.snoozeUntil > 0) {
      return reminder.snoozeUntil;
    }
    return reminder.triggerAt;
  }

  function claimReminder(id) {
    if (!canThisTabAlert()) return null;

    const now = Date.now();
    const reminders = readRawState();
    const index = reminders.findIndex(item => item.id === String(id));
    if (index < 0) return null;

    const reminder = reminders[index];
    if (
      reminder.claimOwner &&
      reminder.claimOwner !== INSTANCE_ID &&
      reminder.claimUntil > now
    ) {
      return null;
    }

    reminder.claimOwner = INSTANCE_ID;
    reminder.claimUntil = now + CLAIM_MS;
    reminders[index] = reminder;
    writeReminders(reminders, { type: "reminder-claimed", reminderId: reminder.id }, { dispatch: false });
    return clone(reminder);
  }

  function releaseClaim(id) {
    const reminders = readRawState();
    const index = reminders.findIndex(item => item.id === String(id));
    if (index < 0) return;

    if (reminders[index].claimOwner === INSTANCE_ID) {
      reminders[index].claimOwner = "";
      reminders[index].claimUntil = 0;
      writeReminders(reminders, { type: "claim-released", reminderId: id }, { dispatch: false });
    }
  }

  function markOldRemindersMissed(reminders) {
    const today = dateKey();
    let changed = false;

    reminders.forEach(item => {
      if (
        item.date < today &&
        !["done", "missed"].includes(item.status)
      ) {
        item.status = "missed";
        item.claimOwner = "";
        item.claimUntil = 0;
        changed = true;
      }
    });

    if (changed) {
      writeReminders(reminders, { type: "old-reminders-marked-missed" });
    }

    return changed;
  }

  function dueReminders(now = Date.now()) {
    const reminders = getReminders();
    markOldRemindersMissed(reminders);

    return reminders
      .filter(item => {
        if (item.scheduleUnavailable) return false;
        if (["done", "missed"].includes(item.status)) return false;
        if (item.date !== dateKey(new Date(now))) return false;

        const due = effectiveDue(item);
        if (!due || due > now) return false;

        // A snoozed reminder becomes eligible again when its snooze time arrives.
        if (item.status === "snoozed" && item.snoozeUntil <= now) return true;

        // Pending reminders are due once. A stale alerting reminder becomes eligible
        // again only after its cross-tab claim expires, so a closed/crashed tab does
        // not permanently swallow the reminder.
        if (item.status === "pending") return true;
        if (item.status === "alerting" && item.claimUntil <= now) return true;
        return false;
      })
      .sort((a, b) => {
        const dueDiff = effectiveDue(a) - effectiveDue(b);
        if (dueDiff) return dueDiff;
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
  }

  function injectAlertUI() {
    if (document.getElementById("tdReminderBackdrop")) return;

    const style = document.createElement("style");
    style.id = "tdReminderGlobalStyles";
    style.textContent = `
      .td-reminder-backdrop {
        position: fixed;
        inset: 0;
        z-index: 30000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 18px;
        background: rgba(32,33,36,.64);
        backdrop-filter: blur(3px);
        font-family: Arial, Helvetica, sans-serif;
      }
      .td-reminder-backdrop.visible { display: flex; }
      .td-reminder-modal {
        width: min(560px, 100%);
        max-height: calc(100vh - 36px);
        overflow: auto;
        padding: 26px;
        border-radius: 20px;
        background: #fff;
        color: #202124;
        box-shadow: 0 18px 60px rgba(0,0,0,.30);
        text-align: center;
      }
      .td-reminder-icon {
        width: 62px;
        height: 62px;
        margin: 0 auto 12px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #e8f0fe;
        font-size: 30px;
      }
      .td-reminder-eyebrow {
        margin-bottom: 6px;
        color: #5f6368;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .td-reminder-title { margin: 0 0 8px; font-size: 26px; }
      .td-reminder-context { color: #5f6368; font-size: 14px; font-weight: 700; }
      .td-reminder-queue {
        display: none;
        width: fit-content;
        margin: 10px auto 0;
        padding: 5px 9px;
        border-radius: 999px;
        background: #fef7e0;
        color: #8a5a00;
        font-size: 12px;
        font-weight: 800;
      }
      .td-reminder-private {
        margin-top: 18px;
        padding: 22px 16px;
        border: 1px dashed #c8ccd1;
        border-radius: 14px;
        background: #fafbfc;
        color: #3c4043;
        line-height: 1.45;
      }
      .td-reminder-details {
        display: none;
        margin-top: 18px;
        padding: 16px;
        border: 1px solid #e3e5e8;
        border-radius: 14px;
        background: #fafbfc;
        text-align: left;
      }
      .td-reminder-details.visible { display: block; }
      .td-reminder-student { margin-bottom: 8px; color: #1a73e8; font-size: 18px; font-weight: 800; }
      .td-reminder-note { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 18px; line-height: 1.45; font-weight: 700; }
      .td-reminder-reveal { margin-top: 14px; }
      .td-reminder-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
        margin-top: 18px;
      }
      .td-reminder-actions button,
      .td-reminder-reveal button {
        min-height: 48px;
        border: 0;
        border-radius: 10px;
        padding: 10px 9px;
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        cursor: pointer;
        background: #e8eaed;
        color: #202124;
      }
      .td-reminder-actions .done { background: #e6f4ea; color: #137333; }
      .td-reminder-reveal button { background: #1a73e8; color: white; }
      .td-reminder-footnote { margin-top: 13px; color: #5f6368; font-size: 12px; line-height: 1.4; }
      @media (max-width: 600px) {
        .td-reminder-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `;
    document.head.appendChild(style);

    const backdrop = document.createElement("div");
    backdrop.id = "tdReminderBackdrop";
    backdrop.className = "td-reminder-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML = `
      <div class="td-reminder-modal">
        <div class="td-reminder-icon" aria-hidden="true">🔔</div>
        <div class="td-reminder-eyebrow">Teacher Reminder</div>
        <h2 class="td-reminder-title">Teacher Reminder</h2>
        <div id="tdReminderContext" class="td-reminder-context"></div>
        <div id="tdReminderQueue" class="td-reminder-queue"></div>

        <div id="tdReminderPrivate" class="td-reminder-private">
          This reminder is private. Press Show to reveal the student name and reminder.
        </div>

        <div id="tdReminderDetails" class="td-reminder-details">
          <div id="tdReminderStudent" class="td-reminder-student"></div>
          <div id="tdReminderNote" class="td-reminder-note"></div>
        </div>

        <div id="tdReminderReveal" class="td-reminder-reveal">
          <button id="tdReminderShow" type="button">Show</button>
        </div>

        <div class="td-reminder-actions">
          <button id="tdReminderDone" class="done" type="button">✓ Done</button>
          <button id="tdReminderSnooze5" type="button">5 min</button>
          <button id="tdReminderSnooze10" type="button">10 min</button>
          <button id="tdReminderSnoozeEnd" type="button">End of Period</button>
        </div>

        <div class="td-reminder-footnote">
          Snoozing keeps the reminder unresolved. If multiple reminders are due together, they are shown one at a time.
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    document.getElementById("tdReminderShow").addEventListener("click", revealAlert);
    document.getElementById("tdReminderDone").addEventListener("click", completeActiveReminder);
    document.getElementById("tdReminderSnooze5").addEventListener("click", () => snoozeActiveReminder(5));
    document.getElementById("tdReminderSnooze10").addEventListener("click", () => snoozeActiveReminder(10));
    document.getElementById("tdReminderSnoozeEnd").addEventListener("click", snoozeActiveToEnd);
  }

  function primeAudio() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === "suspended") audioContext.resume();
    } catch (error) {}
  }

  function playReminderSound() {
    try {
      primeAudio();
      if (!audioContext || audioContext.state !== "running") return;

      const now = audioContext.currentTime;
      [0, 0.18].forEach((offset, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 0 ? 880 : 1046.5;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.18);
      });
    } catch (error) {}
  }

  function formatClock(milliseconds) {
    return new Date(milliseconds).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function currentAlertReminder() {
    return activeReminderId ? getReminder(activeReminderId) : null;
  }

  function revealAlert() {
    const privateBox = document.getElementById("tdReminderPrivate");
    const reveal = document.getElementById("tdReminderReveal");
    const details = document.getElementById("tdReminderDetails");
    if (privateBox) privateBox.style.display = "none";
    if (reveal) reveal.style.display = "none";
    if (details) details.classList.add("visible");
  }

  function queueCountExcluding(id) {
    return dueReminders().filter(item => item.id !== id).length;
  }

  function openAlert(reminder) {
    injectAlertUI();
    activeReminderId = reminder.id;

    const backdrop = document.getElementById("tdReminderBackdrop");
    const context = document.getElementById("tdReminderContext");
    const queue = document.getElementById("tdReminderQueue");
    const privateBox = document.getElementById("tdReminderPrivate");
    const reveal = document.getElementById("tdReminderReveal");
    const details = document.getElementById("tdReminderDetails");
    const student = document.getElementById("tdReminderStudent");
    const note = document.getElementById("tdReminderNote");
    const snoozeEnd = document.getElementById("tdReminderSnoozeEnd");

    const dueAt = effectiveDue(reminder);
    context.textContent = `${reminder.className} • ${reminder.triggerLabel}${dueAt ? ` • ${formatClock(dueAt)}` : ""}`;

    const moreDue = queueCountExcluding(reminder.id);
    if (moreDue > 0) {
      queue.textContent = `+${moreDue} more reminder${moreDue === 1 ? "" : "s"} due`;
      queue.style.display = "block";
    } else {
      queue.textContent = "";
      queue.style.display = "none";
    }

    student.textContent = reminder.studentName || "General reminder";
    note.textContent = reminder.text;

    const isPrivate = reminder.privacy === "private";
    privateBox.style.display = isPrivate ? "block" : "none";
    reveal.style.display = isPrivate ? "block" : "none";
    details.classList.toggle("visible", !isPrivate);

    snoozeEnd.textContent = reminder.entryName
      ? `End of ${reminder.entryName}`
      : "End of Period";

    backdrop.classList.add("visible");
    document.title = `🔔 Teacher Reminder • ${document.title.replace(/^🔔 Teacher Reminder • /, "")}`;
    playReminderSound();
  }

  function closeAlert() {
    const backdrop = document.getElementById("tdReminderBackdrop");
    if (backdrop) backdrop.classList.remove("visible");

    const oldId = activeReminderId;
    activeReminderId = "";
    if (oldId) releaseClaim(oldId);

    document.title = document.title.replace(/^🔔 Teacher Reminder • /, "");
    setTimeout(checkDueReminders, 75);
  }

  function completeActiveReminder() {
    const reminder = currentAlertReminder();
    if (!reminder) return closeAlert();

    updateReminder(reminder.id, {
      status: "done",
      completedAt: new Date().toISOString(),
      snoozeUntil: 0,
      claimOwner: "",
      claimUntil: 0
    });

    closeAlert();
  }

  function snoozeActiveReminder(minutes) {
    const reminder = currentAlertReminder();
    if (!reminder) return closeAlert();

    const until = Date.now() + minutes * 60 * 1000;
    updateReminder(reminder.id, {
      status: "snoozed",
      snoozeUntil: until,
      claimOwner: "",
      claimUntil: 0
    });

    closeAlert();
  }

  function snoozeActiveToEnd() {
    const reminder = currentAlertReminder();
    if (!reminder) return closeAlert();

    const info = getTriggerTime(reminder);
    let until = info?.end?.getTime() || 0;

    if (!until || until <= Date.now()) {
      until = Date.now() + 10 * 60 * 1000;
    }

    updateReminder(reminder.id, {
      status: "snoozed",
      snoozeUntil: until,
      claimOwner: "",
      claimUntil: 0
    });

    closeAlert();
  }

  function checkDueReminders() {
    if (!document.body || !canThisTabAlert()) return;

    injectAlertUI();

    const backdrop = document.getElementById("tdReminderBackdrop");
    if (backdrop?.classList.contains("visible")) {
      // Renew the cross-tab claim while this visible tab owns the alert.
      const active = currentAlertReminder();
      if (active && active.claimOwner === INSTANCE_ID && active.claimUntil - Date.now() < CLAIM_MS / 2) {
        claimReminder(active.id);
      }
      return;
    }

    const due = dueReminders();
    if (!due.length) return;

    for (const candidate of due) {
      const claimed = claimReminder(candidate.id);
      if (!claimed) continue;

      const now = Date.now();
      const effective = effectiveDue(claimed);
      const updated = updateReminder(claimed.id, {
        status: "alerting",
        alertedDueAt: effective || now,
        claimOwner: INSTANCE_ID,
        claimUntil: now + CLAIM_MS
      }) || claimed;

      openAlert(updated);
      break;
    }
  }

  function releaseActiveAlertForHiddenPage() {
    const oldId = activeReminderId;
    activeReminderId = "";

    const backdrop = document.getElementById("tdReminderBackdrop");
    if (backdrop) backdrop.classList.remove("visible");

    if (oldId) releaseClaim(oldId);

    document.title = document.title.replace(/^🔔 Teacher Reminder • /, "");
  }

  function handleVisibilityChange() {
    if (canThisTabAlert()) {
      // Catch a reminder immediately when this Dashboard page becomes active.
      setTimeout(checkDueReminders, 0);
      return;
    }

    // If the teacher switches to another Dashboard tab/page, do not let this
    // hidden page keep ownership of a reminder that the visible page should show.
    releaseActiveAlertForHiddenPage();
  }

  function handlePageHide() {
    // pagehide also covers normal navigation away from a Dashboard utility.
    releaseActiveAlertForHiddenPage();
  }

  function handleStorage(event) {
    if (event.key === TODO_STORAGE_KEY) {
      window.dispatchEvent(new CustomEvent(TODO_CHANGE_EVENT, {
        detail: {
          type: "external-storage-change",
          todos: getTodos()
        }
      }));
      return;
    }

    if (event.key !== STORAGE_KEY) return;
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        type: "external-storage-change",
        reminders: getReminders()
      }
    }));
    setTimeout(checkDueReminders, 0);
  }

  function handleScheduleChange() {
    refreshTriggers({ dispatch: true });
    setTimeout(checkDueReminders, 0);
  }

  function start() {
    const attach = () => {
      injectAlertUI();
      document.addEventListener("pointerdown", primeAudio, { once: true, passive: true });
      document.addEventListener("keydown", primeAudio, { once: true });
      checkDueReminders();

      if (!checkTimer) {
        checkTimer = window.setInterval(checkDueReminders, POLL_MS);
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    } else {
      attach();
    }
  }

  window.addEventListener("storage", handleStorage);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", () => setTimeout(checkDueReminders, 0));
  window.addEventListener("pagehide", handlePageHide);

  if (DashboardData.changeEvent) {
    window.addEventListener(DashboardData.changeEvent, handleScheduleChange);
  }

  if (BellService.changeEvent) {
    window.addEventListener(BellService.changeEvent, handleScheduleChange);
  }

  window.ReminderService = Object.freeze({
    storageKey: STORAGE_KEY,
    changeEvent: CHANGE_EVENT,
    todoStorageKey: TODO_STORAGE_KEY,
    todoChangeEvent: TODO_CHANGE_EVENT,
    dateKey,
    timingLabel,
    timingLabelForTarget,
    getTriggerTime,
    getEntryBounds,
    getReminders,
    getReminder,
    addReminder,
    updateReminder,
    deleteReminder,
    clearCompleted,
    getTodos,
    addTodo,
    setTodoCompleted,
    deleteTodo,
    clearCompletedTodos,
    refreshTriggers,
    checkDueReminders
  });

  start();
})();

(() => {
  "use strict";

  if (!window.DashboardData || !window.BellService) {
    console.warn("ReminderService requires DashboardData and BellService.");
    return;
  }

  const STORAGE_KEY = "teacherDashboard.classReminders.v1";
  const CHANGE_EVENT = "teacher-dashboard-reminders-changed";
  const INSTANCE_ID = `reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const CLAIM_MS = 60_000;
  const PASSING_MINUTES = 4;

  let activeReminderId = "";
  let popupRoot = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeReminder(item) {
    if (!item || typeof item !== "object") return null;

    const id = String(item.id || "").trim();
    const reminderDate = String(item.date || "").trim();
    const classId = String(item.classId || "").trim();
    const text = String(item.text || "").trim();
    const timing = ["start", "after5", "before10", "before5"].includes(item.timing)
      ? item.timing
      : "start";

    if (!id || !/^[1-7]$/.test(classId) || !text || !parseDateKey(reminderDate)) {
      return null;
    }

    return {
      id,
      date: reminderDate,
      classId,
      studentId: String(item.studentId || "").trim(),
      studentName: String(item.studentName || "").trim(),
      text,
      timing,
      status: ["pending", "snoozed", "alerting", "done", "missed"].includes(item.status)
        ? item.status
        : "pending",
      snoozeUntil: Number(item.snoozeUntil) || 0,
      claimOwner: String(item.claimOwner || ""),
      claimUntil: Number(item.claimUntil) || 0,
      createdAt: String(item.createdAt || ""),
      completedAt: String(item.completedAt || ""),
      lastFiredAt: String(item.lastFiredAt || "")
    };
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeReminder).filter(Boolean);
    } catch (error) {
      console.warn("Class reminders could not be loaded.", error);
      return [];
    }
  }

  function save(reminders, detail = {}) {
    const normalized = (Array.isArray(reminders) ? reminders : [])
      .map(normalizeReminder)
      .filter(Boolean);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));

    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        reminders: clone(normalized),
        ...detail
      }
    }));

    return clone(normalized);
  }

  function createId() {
    return `rem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function getScheduleKeyForDate(targetDate) {
    const today = dateKey();
    const targetKey = dateKey(targetDate);

    if (targetKey === today) {
      try {
        return BellService.getSnapshot().scheduleKey || "regular";
      } catch (_) {}
    }

    if (typeof DashboardData.isMinimumDayDate === "function" &&
        DashboardData.isMinimumDayDate(targetKey)) {
      return "minimum";
    }

    return targetDate.getDay() === 3 ? "lateStart" : "regular";
  }

  function timeOnDate(hhmm, targetDate) {
    const [hours, minutes] = String(hhmm || "00:00").split(":").map(Number);
    const value = new Date(targetDate);
    value.setHours(hours || 0, minutes || 0, 0, 0);
    return value;
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + Number(minutes || 0) * 60_000);
  }

  function getClassWindow(classId, reminderDate) {
    const targetDate = parseDateKey(reminderDate);
    if (!targetDate) return null;

    const scheduleKey = getScheduleKeyForDate(targetDate);
    const schedule = DashboardData.getBellSchedule(scheduleKey) || [];
    const className = `Period ${String(classId)}`;
    const index = schedule.findIndex(item => String(item?.name || "") === className);

    if (index < 0) return null;

    const entry = schedule[index];
    const end = timeOnDate(entry.end, targetDate);
    let start;

    if (String(classId) === "1") {
      const schoolStart = DashboardData.getSchoolStartTime(scheduleKey);
      start = timeOnDate(schoolStart, targetDate);
    } else {
      const previous = schedule[index - 1];
      if (!previous?.end) return null;
      start = addMinutes(timeOnDate(previous.end, targetDate), PASSING_MINUTES);
    }

    return {
      scheduleKey,
      scheduleLabel: BellService.scheduleDisplayName(scheduleKey),
      start,
      end,
      classId: String(classId),
      className: DashboardData.getClass(classId)?.name || className
    };
  }

  function getTriggerTime(reminder) {
    const windowInfo = getClassWindow(reminder.classId, reminder.date);
    if (!windowInfo) return null;

    let trigger = new Date(windowInfo.start);

    switch (reminder.timing) {
      case "after5":
        trigger = addMinutes(windowInfo.start, 5);
        break;
      case "before10":
        trigger = addMinutes(windowInfo.end, -10);
        break;
      case "before5":
        trigger = addMinutes(windowInfo.end, -5);
        break;
      case "start":
      default:
        trigger = new Date(windowInfo.start);
        break;
    }

    return {
      ...windowInfo,
      trigger
    };
  }

  function timingLabel(timing) {
    return {
      start: "Start of class",
      after5: "5 minutes into class",
      before10: "10 minutes before class ends",
      before5: "5 minutes before class ends"
    }[timing] || "Start of class";
  }

  function formatTime(date) {
    return date?.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    }) || "";
  }

  function addReminder(input) {
    const classId = String(input?.classId || "");
    const reminderDate = String(input?.date || dateKey());
    const text = String(input?.text || "").trim();

    if (!/^[1-7]$/.test(classId)) {
      throw new Error("Choose a class period.");
    }

    if (!text) {
      throw new Error("Enter a reminder.");
    }

    const reminder = normalizeReminder({
      id: createId(),
      date: reminderDate,
      classId,
      studentId: String(input?.studentId || ""),
      studentName: String(input?.studentName || "").trim(),
      text,
      timing: input?.timing || "start",
      status: "pending",
      createdAt: new Date().toISOString()
    });

    if (!reminder) {
      throw new Error("The reminder could not be created.");
    }

    const triggerInfo = getTriggerTime(reminder);
    if (!triggerInfo) {
      throw new Error("That period is not available on the selected schedule.");
    }

    if (reminder.date === dateKey() && triggerInfo.trigger <= new Date()) {
      throw new Error(`${timingLabel(reminder.timing)} has already passed for ${triggerInfo.className} today.`);
    }

    const reminders = load();
    reminders.push(reminder);
    save(reminders, { type: "reminder-added", reminderId: reminder.id });
    return clone(reminder);
  }

  function updateReminder(id, updates = {}) {
    const reminders = load();
    const index = reminders.findIndex(item => item.id === String(id));
    if (index < 0) return null;

    reminders[index] = normalizeReminder({
      ...reminders[index],
      ...updates,
      id: reminders[index].id
    });

    save(reminders, { type: "reminder-updated", reminderId: String(id) });
    return clone(reminders[index]);
  }

  function deleteReminder(id) {
    const target = String(id);
    const reminders = load().filter(item => item.id !== target);
    save(reminders, { type: "reminder-deleted", reminderId: target });

    if (activeReminderId === target) {
      closePopup();
    }

    return clone(reminders);
  }

  function resolveStudentDisplay(reminder) {
    if (!reminder.studentId) return reminder.studentName;

    try {
      const student = DashboardData.getStudent(reminder.classId, reminder.studentId);
      return student?.name || reminder.studentName;
    } catch (_) {
      return reminder.studentName;
    }
  }

  function injectStyles() {
    if (document.getElementById("td-reminder-service-styles")) return;

    const style = document.createElement("style");
    style.id = "td-reminder-service-styles";
    style.textContent = `
      .td-reminder-alert {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(32,33,36,.58);
        font-family: Arial, Helvetica, sans-serif;
      }
      .td-reminder-card {
        width: min(520px, 100%);
        border-radius: 18px;
        background: #fff;
        color: #202124;
        box-shadow: 0 18px 56px rgba(0,0,0,.28);
        overflow: hidden;
      }
      .td-reminder-head {
        padding: 20px 22px 15px;
        border-bottom: 1px solid #e5e7eb;
      }
      .td-reminder-eyebrow {
        color: #1a73e8;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .8px;
        text-transform: uppercase;
      }
      .td-reminder-title {
        margin: 6px 0 0;
        font-size: 24px;
        font-weight: 800;
        line-height: 1.2;
      }
      .td-reminder-body {
        padding: 20px 22px;
      }
      .td-reminder-context {
        margin-bottom: 12px;
        color: #5f6368;
        font-size: 14px;
        font-weight: 700;
      }
      .td-reminder-message {
        font-size: 20px;
        line-height: 1.45;
        font-weight: 700;
      }
      .td-reminder-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        flex-wrap: wrap;
        padding: 0 22px 22px;
      }
      .td-reminder-actions button {
        min-height: 44px;
        border: 0;
        border-radius: 10px;
        padding: 11px 17px;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .td-reminder-snooze {
        background: #e8eaed;
        color: #202124;
      }
      .td-reminder-done {
        background: #1a73e8;
        color: #fff;
      }
      @media (max-width: 520px) {
        .td-reminder-alert { align-items: flex-end; padding: 12px; }
        .td-reminder-card { border-radius: 16px; }
        .td-reminder-actions button { flex: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function closePopup() {
    if (popupRoot) {
      popupRoot.remove();
      popupRoot = null;
    }
    activeReminderId = "";
  }

  function showPopup(reminder) {
    injectStyles();
    closePopup();

    activeReminderId = reminder.id;
    popupRoot = document.createElement("div");
    popupRoot.className = "td-reminder-alert";
    popupRoot.setAttribute("role", "dialog");
    popupRoot.setAttribute("aria-modal", "true");
    popupRoot.setAttribute("aria-label", "Class reminder");

    const triggerInfo = getTriggerTime(reminder);
    const studentName = resolveStudentDisplay(reminder);
    const contextBits = [
      triggerInfo?.className || `Period ${reminder.classId}`,
      studentName || "",
      timingLabel(reminder.timing)
    ].filter(Boolean);

    const card = document.createElement("div");
    card.className = "td-reminder-card";

    const head = document.createElement("div");
    head.className = "td-reminder-head";
    head.innerHTML = `
      <div class="td-reminder-eyebrow">Class Reminder</div>
      <div class="td-reminder-title">${studentName ? escapeHtml(studentName) : "Reminder"}</div>
    `;

    const body = document.createElement("div");
    body.className = "td-reminder-body";

    const context = document.createElement("div");
    context.className = "td-reminder-context";
    context.textContent = contextBits.join(" • ");

    const message = document.createElement("div");
    message.className = "td-reminder-message";
    message.textContent = reminder.text;

    body.append(context, message);

    const actions = document.createElement("div");
    actions.className = "td-reminder-actions";

    const snooze = document.createElement("button");
    snooze.type = "button";
    snooze.className = "td-reminder-snooze";
    snooze.textContent = "Snooze 5 min";
    snooze.addEventListener("click", () => {
      updateReminder(reminder.id, {
        status: "snoozed",
        snoozeUntil: Date.now() + 5 * 60_000,
        claimOwner: "",
        claimUntil: 0
      });
      closePopup();
    });

    const done = document.createElement("button");
    done.type = "button";
    done.className = "td-reminder-done";
    done.textContent = "Done";
    done.addEventListener("click", () => {
      updateReminder(reminder.id, {
        status: "done",
        completedAt: new Date().toISOString(),
        snoozeUntil: 0,
        claimOwner: "",
        claimUntil: 0
      });
      closePopup();
    });

    actions.append(snooze, done);
    card.append(head, body, actions);
    popupRoot.appendChild(card);
    document.body.appendChild(popupRoot);

    try {
      BellService.playSelectedSoundOnce?.();
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function claimReminder(id) {
    const reminders = load();
    const index = reminders.findIndex(item => item.id === id);
    if (index < 0) return null;

    const now = Date.now();
    const current = reminders[index];

    if (current.claimUntil > now && current.claimOwner && current.claimOwner !== INSTANCE_ID) {
      return null;
    }

    reminders[index] = {
      ...current,
      status: "alerting",
      claimOwner: INSTANCE_ID,
      claimUntil: now + CLAIM_MS,
      lastFiredAt: new Date(now).toISOString()
    };

    save(reminders, { type: "reminder-claimed", reminderId: id });
    return clone(reminders[index]);
  }

  function processReminders() {
    if (activeReminderId || document.visibilityState === "hidden") return;

    const now = new Date();
    const reminders = load();
    let changed = false;

    for (const reminder of reminders) {
      if (reminder.status === "done" || reminder.status === "missed") continue;

      if (reminder.status === "alerting" && reminder.claimUntil <= Date.now()) {
        reminder.status = "pending";
        reminder.claimOwner = "";
        reminder.claimUntil = 0;
        changed = true;
      }
    }

    if (changed) {
      save(reminders, { type: "expired-claims-cleared" });
    }

    const current = load()
      .filter(reminder => reminder.date <= dateKey(now))
      .sort((a, b) => {
        const ta = getTriggerTime(a)?.trigger?.getTime() || 0;
        const tb = getTriggerTime(b)?.trigger?.getTime() || 0;
        return ta - tb;
      });

    for (const reminder of current) {
      if (!["pending", "snoozed"].includes(reminder.status)) continue;

      const triggerInfo = getTriggerTime(reminder);
      if (!triggerInfo) continue;

      if (reminder.date < dateKey(now)) {
        updateReminder(reminder.id, { status: "missed", claimOwner: "", claimUntil: 0 });
        continue;
      }

      if (reminder.status === "snoozed" && reminder.snoozeUntil > Date.now()) {
        continue;
      }

      const dueAt = reminder.status === "snoozed" && reminder.snoozeUntil
        ? new Date(reminder.snoozeUntil)
        : triggerInfo.trigger;

      if (now < dueAt) continue;

      // Once the class is well over, do not surface a stale reminder.
      if (now > addMinutes(triggerInfo.end, 10)) {
        updateReminder(reminder.id, { status: "missed", claimOwner: "", claimUntil: 0 });
        continue;
      }

      const claimed = claimReminder(reminder.id);
      if (claimed) {
        showPopup(claimed);
        break;
      }
    }
  }

  function getReminders(options = {}) {
    let reminders = load();

    if (options.date) {
      reminders = reminders.filter(item => item.date === String(options.date));
    }

    if (options.classId) {
      reminders = reminders.filter(item => item.classId === String(options.classId));
    }

    return reminders.map(item => {
      const triggerInfo = getTriggerTime(item);
      return {
        ...clone(item),
        studentName: resolveStudentDisplay(item),
        className: triggerInfo?.className || DashboardData.getClass(item.classId)?.name || `Period ${item.classId}`,
        triggerAt: triggerInfo?.trigger?.toISOString?.() || "",
        triggerLabel: triggerInfo ? formatTime(triggerInfo.trigger) : "",
        timingLabel: timingLabel(item.timing),
        scheduleLabel: triggerInfo?.scheduleLabel || ""
      };
    });
  }

  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
        detail: {
          type: "external-storage-change",
          reminders: getReminders()
        }
      }));
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      processReminders();
    }
  });

  window.ReminderService = Object.freeze({
    storageKey: STORAGE_KEY,
    changeEvent: CHANGE_EVENT,
    dateKey,
    timingLabel,
    getClassWindow,
    getTriggerTime,
    getReminders,
    addReminder,
    updateReminder,
    deleteReminder,
    processReminders
  });

  setTimeout(processReminders, 350);
  setInterval(processReminders, 5_000);
})();

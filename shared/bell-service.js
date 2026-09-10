(() => {
  "use strict";

  if (!window.DashboardData) {
    console.error(
      "BellService requires shared/dashboard-data.js to load first."
    );
    return;
  }

  const STATE_KEY =
    "teacherDashboard.bellState.v1";

  const PREFS_KEY =
    "bjhClassBellCountdownPrefsV3";

  const CHANGE_EVENT =
    "teacher-dashboard-bell-changed";

  const INSTANCE_ID =
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9);

  const WARNING_REPEAT_MS = 5000;
  const WARNING_DURATION_MS = 60000;
  const PASSING_PERIOD_MINUTES = 4;

  let audioContext = null;
  let activeOscillators = new Set();
  let localAlarmInterval = null;
  let localAlarmTimeout = null;

  // Tracks the bell target that most recently drove the shared class selection.
  // Manual class choices inside a utility are respected until the bell target changes.
  let lastClassSyncTargetKey = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dateKey(date = new Date()) {
    const year = date.getFullYear();
    const month =
      String(date.getMonth() + 1)
        .padStart(2, "0");
    const day =
      String(date.getDate())
        .padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function isSchoolDay(date = new Date()) {
    const day = date.getDay();
    return day >= 1 && day <= 5;
  }

  function validMode(value) {
    return [
      "auto",
      "regular",
      "lateStart",
      "minimum"
    ].includes(value)
      ? value
      : "auto";
  }

  function defaultState() {
    return {
      version: 1,
      dateKey: dateKey(),
      scheduleMode: "auto",
      manualEntryName: "",
      targetKey: "",
      finalBellFiredKey: "",
      warnings: [],
      alarm: {
        active: false,
        ownerId: "",
        triggerId: "",
        startedAt: 0
      }
    };
  }

  function normalizeState(raw) {
    const defaults = defaultState();
    const incoming =
      raw && typeof raw === "object"
        ? raw
        : {};

    const state = {
      version: 1,
      dateKey:
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(incoming.dateKey || "")
        )
          ? incoming.dateKey
          : defaults.dateKey,
      scheduleMode:
        validMode(incoming.scheduleMode),
      manualEntryName:
        String(incoming.manualEntryName || ""),
      targetKey:
        String(incoming.targetKey || ""),
      finalBellFiredKey:
        String(incoming.finalBellFiredKey || ""),
      warnings: [],
      alarm: {
        active:
          incoming.alarm?.active === true,
        ownerId:
          String(incoming.alarm?.ownerId || ""),
        triggerId:
          String(incoming.alarm?.triggerId || ""),
        startedAt:
          Number(incoming.alarm?.startedAt) || 0
      }
    };

    if (Array.isArray(incoming.warnings)) {
      state.warnings =
        incoming.warnings
          .map(item => ({
            minutes:
              Math.max(
                1,
                Math.min(
                  180,
                  Math.floor(
                    Number(item?.minutes) || 0
                  )
                )
              ),
            targetKey:
              String(item?.targetKey || ""),
            status:
              item?.status === "fired"
                ? "fired"
                : "armed"
          }))
          .filter(item =>
            item.minutes >= 1 &&
            item.targetKey
          );
    }

    return state;
  }

  function loadState() {
    try {
      const raw =
        localStorage.getItem(
          STATE_KEY
        );

      return raw
        ? normalizeState(
            JSON.parse(raw)
          )
        : defaultState();
    } catch (error) {
      console.warn(
        "Bell state could not be loaded.",
        error
      );
      return defaultState();
    }
  }

  function saveState(state, detail = {}) {
    const normalized =
      normalizeState(state);

    localStorage.setItem(
      STATE_KEY,
      JSON.stringify(normalized)
    );

    window.dispatchEvent(
      new CustomEvent(
        CHANGE_EVENT,
        {
          detail: {
            state: clone(normalized),
            ...detail
          }
        }
      )
    );

    return clone(normalized);
  }

  function getPreferences() {
    const defaults = {
      alarmSound: "googleStyle",
      finalBellEnabled: false,
      customWarningMinutes: 7
    };

    try {
      const parsed =
        JSON.parse(
          localStorage.getItem(
            PREFS_KEY
          ) || "{}"
        );

      const allowedSounds =
        new Set([
          "googleStyle",
          "chime",
          "schoolBell",
          "alarm",
          "tripleBeep"
        ]);

      return {
        alarmSound:
          allowedSounds.has(
            parsed.alarmSound
          )
            ? parsed.alarmSound
            : defaults.alarmSound,
        finalBellEnabled:
          typeof parsed.finalBellEnabled ===
          "boolean"
            ? parsed.finalBellEnabled
            : defaults.finalBellEnabled,
        customWarningMinutes:
          Number.isInteger(
            Number(
              parsed.customWarningMinutes
            )
          )
            ? Math.max(
                1,
                Math.min(
                  180,
                  Number(
                    parsed.customWarningMinutes
                  )
                )
              )
            : defaults.customWarningMinutes
      };
    } catch (error) {
      return defaults;
    }
  }

  function setPreferences(updates = {}) {
    const next = {
      ...getPreferences(),
      ...updates
    };

    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify(next)
    );

    window.dispatchEvent(
      new CustomEvent(
        CHANGE_EVENT,
        {
          detail: {
            type: "preferences-changed",
            preferences: clone(next)
          }
        }
      )
    );

    return clone(next);
  }

  function getAutoScheduleKey(
    date = new Date()
  ) {
    if (
      DashboardData.isMinimumDayDate(
        date
      )
    ) {
      return "minimum";
    }

    if (date.getDay() === 3) {
      return "lateStart";
    }

    return "regular";
  }

  function getScheduleKey(
    state = loadState(),
    date = new Date()
  ) {
    if (
      state.dateKey !==
      dateKey(date)
    ) {
      return getAutoScheduleKey(
        date
      );
    }

    return state.scheduleMode ===
      "auto"
      ? getAutoScheduleKey(date)
      : state.scheduleMode;
  }

  function timeToday(
    timeString,
    baseDate = new Date()
  ) {
    const [hours, minutes] =
      String(timeString)
        .split(":")
        .map(Number);

    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      minutes,
      0,
      0
    );
  }

  function startOfDay(date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0
    );
  }

  function addDays(date, amount) {
    const next = startOfDay(date);
    next.setDate(next.getDate() + Number(amount || 0));
    return next;
  }

  function nextSchoolDate(
    fromDate = new Date(),
    includeToday = false
  ) {
    let candidate = includeToday
      ? startOfDay(fromDate)
      : addDays(fromDate, 1);

    while (!isSchoolDay(candidate)) {
      candidate = addDays(candidate, 1);
    }

    return candidate;
  }

  function formatClockTime(date) {
    return date.toLocaleTimeString(
      [],
      {
        hour: "numeric",
        minute: "2-digit"
      }
    );
  }

  function formatCountdown(
    seconds
  ) {
    const total =
      Math.max(
        0,
        Math.ceil(
          Number(seconds) || 0
        )
      );

    const days =
      Math.floor(total / 86400);

    const hours =
      Math.floor(
        (total % 86400) / 3600
      );

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const secs =
      total % 60;

    if (days > 0) {
      return `${days}d ${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
    }

    return hours > 0
      ? `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}`
      : `${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  }

  function scheduleDisplayName(key) {
    if (key === "lateStart") {
      return "Late Start";
    }

    if (key === "minimum") {
      return "Minimum Day";
    }

    return "Regular";
  }

  function isClassEntry(entry) {
    return /^Period\s+[1-7]$/i.test(
      String(entry?.name || "")
    );
  }

  function passingPeriodEnd(previousEntry, baseDate = new Date()) {
    const previousEnd = timeToday(
      previousEntry.end,
      baseDate
    );

    return new Date(
      previousEnd.getTime() +
      PASSING_PERIOD_MINUTES * 60 * 1000
    );
  }

  function getSchoolStartTime(scheduleKey) {
    if (
      typeof DashboardData.getSchoolStartTime ===
      "function"
    ) {
      return DashboardData.getSchoolStartTime(
        scheduleKey
      );
    }

    return scheduleKey === "lateStart"
      ? "09:02"
      : "08:10";
  }

  function targetDayLabel(
    targetDate,
    now = new Date()
  ) {
    const target = startOfDay(targetDate);
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);

    if (target.getTime() === today.getTime()) {
      return "Today";
    }

    if (target.getTime() === tomorrow.getTime()) {
      return "Tomorrow";
    }

    return target.toLocaleDateString(
      [],
      { weekday: "long" }
    );
  }

  function buildSchoolStartSnapshot(
    targetDate,
    state,
    now,
    phase
  ) {
    const targetDateKey =
      dateKey(targetDate);

    const scheduleKey =
      getScheduleKey(
        state,
        targetDate
      );

    const schedule =
      DashboardData.getBellSchedule(
        scheduleKey
      );

    const schoolStartTime =
      getSchoolStartTime(
        scheduleKey
      );

    const targetTime =
      timeToday(
        schoolStartTime,
        targetDate
      );

    const targetKey =
      [
        "start",
        targetDateKey,
        scheduleKey,
        schoolStartTime
      ].join("|");

    const remainingSeconds =
      Math.max(
        0,
        Math.ceil(
          (
            targetTime.getTime() -
            now.getTime()
          ) / 1000
        )
      );

    const appliesToToday =
      targetDateKey === dateKey(now);

    const scheduleMode =
      appliesToToday
        ? state.scheduleMode
        : "auto";

    return {
      dateKey: dateKey(now),
      targetDateKey,
      targetDayLabel:
        targetDayLabel(
          targetDate,
          now
        ),
      schoolDay:
        isSchoolDay(now),
      phase,
      countdownType:
        "schoolStart",
      scheduleKey,
      scheduleMode,
      scheduleLabel:
        scheduleDisplayName(
          scheduleKey
        ),
      schedule,
      schoolStartTime,
      entry: null,
      targetTime,
      targetKey,
      remainingSeconds,
      displayCountdown:
        formatCountdown(
          remainingSeconds
        ),
      complete: false,
      manualEntry: false,
      minimumDayAuto:
        scheduleMode === "auto" &&
        scheduleKey === "minimum"
    };
  }

  function getAutomaticClassSnapshot() {
    const now = new Date();

    if (!isSchoolDay(now)) {
      return {
        classId: null,
        targetKey:
          `weekend|${dateKey(now)}`,
        entry: null
      };
    }

    const state = loadState();
    const scheduleKey = getScheduleKey(state, now);
    const schedule = DashboardData.getBellSchedule(scheduleKey);
    const startTime = timeToday(
      getSchoolStartTime(scheduleKey),
      now
    );

    // Before school, class-based utilities should keep the teacher's last
    // active/manual class instead of jumping to Period 1 early.
    if (now < startTime) {
      return {
        classId: null,
        targetKey:
          `before|${dateKey(now)}|${scheduleKey}`,
        entry: null
      };
    }

    // Deliberately ignore manualEntryName here. A teacher may manually point
    // Bell Countdown at a later bell without wanting every class-based utility
    // to jump to that class. Class auto-selection follows the real clock.
    // During a 4-minute passing period, keep the last teaching class selected
    // until the next class actually begins.
    let entry = null;

    for (let index = 0; index < schedule.length; index += 1) {
      const candidate = schedule[index];
      const candidateEnd = timeToday(candidate.end, now);

      if (candidateEnd <= now) {
        continue;
      }

      if (isClassEntry(candidate) && index > 0) {
        const previousEntry = schedule[index - 1];
        const previousEnd = timeToday(previousEntry.end, now);
        const passingEnd = passingPeriodEnd(previousEntry, now);

        if (now >= previousEnd && now < passingEnd) {
          return {
            classId: null,
            targetKey: [
              "passing",
              dateKey(now),
              scheduleKey,
              previousEntry.name,
              candidate.name,
              passingEnd.getTime()
            ].join("|"),
            entry: null,
            nextEntry: clone(candidate)
          };
        }
      }

      entry = candidate;
      break;
    }

    if (!entry) {
      return {
        classId: null,
        targetKey:
          `after|${dateKey(now)}|${scheduleKey}`,
        entry: null
      };
    }

    const targetKey = [
      "class",
      dateKey(now),
      scheduleKey,
      entry.name,
      entry.end
    ].join("|");

    const match = String(entry.name || "").match(/^Period\s+([1-7])$/i);

    if (!match) {
      return {
        classId: null,
        targetKey,
        entry: clone(entry)
      };
    }

    const classId = String(match[1]);
    const classInfo = DashboardData.getClass(classId);

    // Hidden periods are usually preps. Keep the last active teaching class
    // instead of forcing utilities into a hidden class.
    if (!classInfo || classInfo.active === false) {
      return {
        classId: null,
        targetKey,
        entry: clone(entry)
      };
    }

    return {
      classId,
      targetKey,
      entry: clone(entry)
    };
  }

  function getAutomaticClassId() {
    return getAutomaticClassSnapshot().classId;
  }

  function syncCurrentClassFromBell(options = {}) {
    const force = options.force === true;
    const automatic = getAutomaticClassSnapshot();

    // Record every real bell target, including Snack, Lunch, hidden preps,
    // before-school, and after-school. We only react when that target changes.
    const targetChanged = automatic.targetKey !== lastClassSyncTargetKey;

    if (!force && !targetChanged) {
      return automatic.classId;
    }

    lastClassSyncTargetKey = automatic.targetKey;

    if (!automatic.classId) {
      return null;
    }

    try {
      if (DashboardData.getCurrentClassId() !== automatic.classId) {
        DashboardData.setCurrentClass(automatic.classId);
      }
    } catch (error) {
      console.warn(
        "BellService could not sync the current class from the bell schedule.",
        error
      );
    }

    return automatic.classId;
  }

  function resetForNewDate(
    state,
    todayKey
  ) {
    state.dateKey =
      todayKey;

    state.scheduleMode =
      "auto";

    state.manualEntryName =
      "";

    state.finalBellFiredKey =
      "";

    // Keep targetKey and warnings until the next snapshot is reconciled.
    // This lets an alarm armed for the next school start survive a weekend
    // or midnight rollover as long as its actual target has not changed.
    state.alarm = {
      active: false,
      ownerId: "",
      triggerId: "",
      startedAt: 0
    };

    return state;
  }

  function resolveSnapshot() {
    const now = new Date();
    const todayKey = dateKey(now);

    let state = loadState();

    if (state.dateKey !== todayKey) {
      state = saveState(
        resetForNewDate(
          state,
          todayKey
        ),
        {
          type: "new-day"
        }
      );
    }

    // Weekends count down to the next Monday school start.
    if (!isSchoolDay(now)) {
      return buildSchoolStartSnapshot(
        nextSchoolDate(now, false),
        state,
        now,
        "weekend"
      );
    }

    const scheduleKey =
      getScheduleKey(
        state,
        now
      );

    const schedule =
      DashboardData.getBellSchedule(
        scheduleKey
      );

    const schoolStartTime =
      getSchoolStartTime(
        scheduleKey
      );

    const todayStart =
      timeToday(
        schoolStartTime,
        now
      );

    // Before school, count down to the day's actual start time. Manual
    // schedule overrides still work here, including a manually chosen Late
    // Start or Minimum Day.
    if (now < todayStart) {
      return buildSchoolStartSnapshot(
        now,
        state,
        now,
        "beforeSchool"
      );
    }

    let entry = null;

    if (state.manualEntryName) {
      entry =
        schedule.find(
          item =>
            item.name ===
            state.manualEntryName
        ) || null;

      if (
        entry &&
        timeToday(
          entry.end,
          now
        ) <= now
      ) {
        entry = null;
      }
    }

    if (!entry) {
      // Auto Detect inserts a 4-minute passing period before every teaching
      // period after Period 1. Snack and Lunch keep their full scheduled time;
      // the passing countdown begins only after those breaks end.
      for (let index = 0; index < schedule.length; index += 1) {
        const candidate = schedule[index];
        const targetTime = timeToday(candidate.end, now);

        if (targetTime <= now) {
          continue;
        }

        if (isClassEntry(candidate) && index > 0) {
          const previousEntry = schedule[index - 1];
          const previousEnd = timeToday(previousEntry.end, now);
          const passingEnd = passingPeriodEnd(previousEntry, now);

          if (now >= previousEnd && now < passingEnd) {
            const targetKey = [
              "passing",
              todayKey,
              scheduleKey,
              previousEntry.name,
              candidate.name,
              passingEnd.getTime()
            ].join("|");

            const remainingSeconds = Math.max(
              0,
              Math.ceil((passingEnd.getTime() - now.getTime()) / 1000)
            );

            return {
              dateKey: todayKey,
              targetDateKey: todayKey,
              targetDayLabel: "Today",
              schoolDay: true,
              phase: "passing",
              countdownType: "passingPeriod",
              scheduleKey,
              scheduleMode: state.scheduleMode,
              scheduleLabel: scheduleDisplayName(scheduleKey),
              schedule,
              schoolStartTime,
              entry: null,
              nextEntry: clone(candidate),
              targetTime: passingEnd,
              targetKey,
              remainingSeconds,
              displayCountdown: formatCountdown(remainingSeconds),
              complete: false,
              manualEntry: false,
              minimumDayAuto:
                state.scheduleMode === "auto" &&
                scheduleKey === "minimum"
            };
          }
        }

        entry = candidate;
        break;
      }
    }

    if (entry) {
      const targetTime =
        timeToday(
          entry.end,
          now
        );

      const targetKey =
        [
          "bell",
          todayKey,
          scheduleKey,
          entry.name,
          entry.end
        ].join("|");

      const remainingSeconds =
        Math.max(
          0,
          Math.ceil(
            (
              targetTime.getTime() -
              now.getTime()
            ) / 1000
          )
        );

      return {
        dateKey: todayKey,
        targetDateKey: todayKey,
        targetDayLabel: "Today",
        schoolDay: true,
        phase: "duringSchool",
        countdownType: "bell",
        scheduleKey,
        scheduleMode:
          state.scheduleMode,
        scheduleLabel:
          scheduleDisplayName(
            scheduleKey
          ),
        schedule,
        schoolStartTime,
        entry: clone(entry),
        targetTime,
        targetKey,
        remainingSeconds,
        displayCountdown:
          formatCountdown(
            remainingSeconds
          ),
        complete: false,
        manualEntry:
          Boolean(
            state.manualEntryName
          ),
        minimumDayAuto:
          state.scheduleMode === "auto" &&
          scheduleKey === "minimum"
      };
    }

    // After the final bell, immediately roll the countdown forward to the
    // next Monday-Friday school start.
    return buildSchoolStartSnapshot(
      nextSchoolDate(now, false),
      state,
      now,
      "afterSchool"
    );
  }

  function targetTimeFromBellKey(key) {
    const parts = String(key || "").split("|");

    if (
      parts[0] !== "bell" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ||
      !/^\d{2}:\d{2}$/.test(parts[4] || "")
    ) {
      return null;
    }

    const [year, month, day] =
      parts[1].split("-").map(Number);

    const baseDate =
      new Date(year, month - 1, day);

    return timeToday(
      parts[4],
      baseDate
    );
  }

  function maybePlayFinalBell(
    state,
    nextTargetKey
  ) {
    const previousKey =
      state.targetKey;

    if (
      !previousKey ||
      previousKey === nextTargetKey ||
      state.finalBellFiredKey === previousKey ||
      !getPreferences().finalBellEnabled
    ) {
      return state;
    }

    // A school-start countdown transitioning into Period 1 should not play
    // the optional Final Bell sound. Only completed bell targets do that.
    const previousTargetTime =
      targetTimeFromBellKey(
        previousKey
      );

    if (
      !previousTargetTime ||
      previousTargetTime > new Date()
    ) {
      return state;
    }

    state.finalBellFiredKey =
      previousKey;

    saveState(
      state,
      {
        type: "final-bell-fired",
        targetKey:
          previousKey
      }
    );

    playSelectedSoundOnce();

    return state;
  }

  function reconcileTarget() {
    const snapshot =
      resolveSnapshot();

    let state =
      loadState();

    if (
      state.targetKey !==
      snapshot.targetKey
    ) {
      state =
        maybePlayFinalBell(
          state,
          snapshot.targetKey
        );
      stopLocalAlarmAudio();

      state.targetKey =
        snapshot.targetKey;

      state.warnings =
        [];

      state.alarm = {
        active: false,
        ownerId: "",
        triggerId: "",
        startedAt: 0
      };

      saveState(
        state,
        {
          type: "target-changed",
          targetKey:
            snapshot.targetKey
        }
      );
    }

    return snapshot;
  }

  function getSnapshot() {
    return reconcileTarget();
  }

  function setScheduleMode(mode) {
    const nextMode =
      validMode(mode);

    let state =
      loadState();

    state.dateKey =
      dateKey();

    state.scheduleMode =
      nextMode;

    state.manualEntryName =
      "";

    state.targetKey =
      "";

    state.warnings =
      [];

    state.alarm = {
      active: false,
      ownerId: "",
      triggerId: "",
      startedAt: 0
    };

    saveState(
      state,
      {
        type: "schedule-mode-changed",
        scheduleMode:
          nextMode
      }
    );

    return getSnapshot();
  }

  function setManualEntry(
    entryName
  ) {
    const snapshot =
      resolveSnapshot();

    const name =
      String(entryName || "");

    if (
      !snapshot.schedule.some(
        item =>
          item.name === name
      )
    ) {
      throw new Error(
        "That schedule entry does not exist."
      );
    }

    let state =
      loadState();

    state.manualEntryName =
      name;

    state.targetKey =
      "";

    state.warnings =
      [];

    state.alarm = {
      active: false,
      ownerId: "",
      triggerId: "",
      startedAt: 0
    };

    saveState(
      state,
      {
        type:
          "manual-entry-changed",
        entryName: name
      }
    );

    return getSnapshot();
  }

  function clearManualEntry() {
    let state =
      loadState();

    state.manualEntryName =
      "";

    state.targetKey =
      "";

    state.warnings =
      [];

    state.alarm = {
      active: false,
      ownerId: "",
      triggerId: "",
      startedAt: 0
    };

    saveState(
      state,
      {
        type:
          "manual-entry-cleared"
      }
    );

    return getSnapshot();
  }

  function getWarnings() {
    const snapshot =
      getSnapshot();

    return clone(
      loadState().warnings
        .filter(
          warning =>
            warning.targetKey ===
            snapshot.targetKey
        )
        .sort(
          (a, b) =>
            b.minutes -
            a.minutes
        )
    );
  }

  function armWarning(minutes) {
    const value =
      Math.floor(
        Number(minutes)
      );

    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > 180
    ) {
      throw new Error(
        "Enter a whole number from 1 to 180 minutes."
      );
    }

    const snapshot =
      getSnapshot();

    if (
      snapshot.complete ||
      !snapshot.targetKey
    ) {
      throw new Error(
        "There is no active countdown to arm."
      );
    }

    if (
      snapshot.remainingSeconds <=
      value * 60
    ) {
      throw new Error(
        `${value}-minute mark has already passed.`
      );
    }

    let state =
      loadState();

    state.warnings =
      state.warnings.filter(
        item =>
          !(
            item.targetKey ===
              snapshot.targetKey &&
            item.minutes ===
              value
          )
      );

    state.warnings.push({
      minutes: value,
      targetKey:
        snapshot.targetKey,
      status: "armed"
    });

    saveState(
      state,
      {
        type: "warning-armed",
        minutes: value
      }
    );

    return getWarnings();
  }

  function disarmWarning(minutes) {
    const value =
      Math.floor(
        Number(minutes)
      );

    const snapshot =
      getSnapshot();

    let state =
      loadState();

    state.warnings =
      state.warnings.filter(
        item =>
          !(
            item.targetKey ===
              snapshot.targetKey &&
            item.minutes ===
              value
          )
      );

    saveState(
      state,
      {
        type:
          "warning-disarmed",
        minutes: value
      }
    );

    return getWarnings();
  }

  function toggleWarning(minutes) {
    const value =
      Math.floor(
        Number(minutes)
      );

    const existing =
      getWarnings().find(
        item =>
          item.minutes ===
            value &&
          item.status ===
            "armed"
      );

    return existing
      ? disarmWarning(value)
      : armWarning(value);
  }

  function clearWarnings() {
    const snapshot =
      resolveSnapshot();

    stopAlarm();

    let state =
      loadState();

    state.warnings =
      state.warnings.filter(
        item =>
          item.targetKey !==
          snapshot.targetKey
      );

    saveState(
      state,
      {
        type:
          "warnings-cleared"
      }
    );

    return [];
  }

  async function enableAudio() {
    if (!audioContext) {
      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioCtx) {
        return false;
      }

      audioContext =
        new AudioCtx();
    }

    if (
      audioContext.state ===
      "suspended"
    ) {
      try {
        await audioContext.resume();
      } catch (error) {}
    }

    return (
      audioContext.state ===
      "running"
    );
  }

  function playTone(
    frequency,
    start,
    duration,
    volume = 0.5,
    type = "sine"
  ) {
    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    activeOscillators.add(
      oscillator
    );

    oscillator.addEventListener(
      "ended",
      () =>
        activeOscillators.delete(
          oscillator
        )
    );

    oscillator.connect(gain);
    gain.connect(
      audioContext.destination
    );

    oscillator.type =
      type;

    oscillator.frequency
      .setValueAtTime(
        frequency,
        start
      );

    gain.gain.setValueAtTime(
      0.0001,
      start
    );

    gain.gain
      .exponentialRampToValueAtTime(
        volume,
        start + 0.02
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        start + duration
      );

    oscillator.start(start);
    oscillator.stop(
      start + duration
    );
  }

  function stopActiveTones() {
    activeOscillators.forEach(
      oscillator => {
        try {
          oscillator.stop();
        } catch (error) {}
      }
    );

    activeOscillators.clear();
  }

  function playGoogleStyle(
    now
  ) {
    [
      0,
      0.23,
      0.46,
      0.86,
      1.09,
      1.32
    ].forEach(
      (offset, index) => {
        playTone(
          index % 3 === 2
            ? 790
            : 880,
          now + offset,
          0.16,
          0.42,
          "square"
        );
      }
    );
  }

  function playChime(now) {
    playTone(
      880,
      now,
      0.65,
      0.5,
      "sine"
    );
    playTone(
      1108,
      now,
      0.65,
      0.35,
      "sine"
    );
    playTone(
      880,
      now + 0.75,
      0.65,
      0.5,
      "sine"
    );
    playTone(
      1108,
      now + 0.75,
      0.65,
      0.35,
      "sine"
    );
  }

  function playSchoolBell(now) {
    playTone(
      740,
      now,
      0.85,
      0.6,
      "triangle"
    );
    playTone(
      1480,
      now,
      0.55,
      0.25,
      "sine"
    );
    playTone(
      740,
      now + 0.95,
      0.85,
      0.6,
      "triangle"
    );
    playTone(
      1480,
      now + 0.95,
      0.55,
      0.25,
      "sine"
    );
  }

  function playAlarmPattern(now) {
    for (
      let i = 0;
      i < 4;
      i += 1
    ) {
      playTone(
        i % 2 === 0
          ? 950
          : 720,
        now + i * 0.32,
        0.24,
        0.5,
        "square"
      );
    }
  }

  function playTripleBeep(now) {
    [
      0,
      0.34,
      0.68
    ].forEach(offset => {
      playTone(
        1000,
        now + offset,
        0.22,
        0.45,
        "sine"
      );
    });
  }

  async function playSelectedSoundOnce() {
    const ready =
      await enableAudio();

    if (!ready) {
      return false;
    }

    const now =
      audioContext.currentTime;

    const sound =
      getPreferences().alarmSound;

    if (sound === "schoolBell") {
      playSchoolBell(now);
    } else if (
      sound === "alarm"
    ) {
      playAlarmPattern(now);
    } else if (
      sound === "tripleBeep"
    ) {
      playTripleBeep(now);
    } else if (
      sound === "chime"
    ) {
      playChime(now);
    } else {
      playGoogleStyle(now);
    }

    return true;
  }

  function stopLocalAlarmAudio() {
    if (localAlarmInterval) {
      clearInterval(
        localAlarmInterval
      );
      localAlarmInterval =
        null;
    }

    if (localAlarmTimeout) {
      clearTimeout(
        localAlarmTimeout
      );
      localAlarmTimeout =
        null;
    }

    stopActiveTones();
  }

  async function startLocalAlarmAudio() {
    stopLocalAlarmAudio();

    await playSelectedSoundOnce();

    localAlarmInterval =
      setInterval(
        playSelectedSoundOnce,
        WARNING_REPEAT_MS
      );

    localAlarmTimeout =
      setTimeout(
        stopAlarm,
        WARNING_DURATION_MS
      );
  }

  function stopAlarm() {
    stopLocalAlarmAudio();

    let state =
      loadState();

    if (!state.alarm.active) {
      return;
    }

    state.alarm = {
      active: false,
      ownerId: "",
      triggerId: "",
      startedAt: 0
    };

    saveState(
      state,
      {
        type: "alarm-stopped"
      }
    );
  }

  async function claimAlarm(
    triggerId
  ) {
    let state =
      loadState();

    if (
      state.alarm.active &&
      state.alarm.triggerId ===
        triggerId
    ) {
      return;
    }

    state.alarm = {
      active: true,
      ownerId: INSTANCE_ID,
      triggerId,
      startedAt: Date.now()
    };

    saveState(
      state,
      {
        type: "alarm-started",
        triggerId
      }
    );

    const confirmed =
      loadState();

    if (
      confirmed.alarm.active &&
      confirmed.alarm.ownerId ===
        INSTANCE_ID &&
      confirmed.alarm.triggerId ===
        triggerId
    ) {
      await startLocalAlarmAudio();
    }
  }

  function fireDueWarnings() {
    const snapshot =
      getSnapshot();

    if (
      snapshot.complete ||
      snapshot.remainingSeconds <= 0
    ) {
      return;
    }

    let state =
      loadState();

    const due =
      state.warnings.filter(
        item =>
          item.targetKey ===
            snapshot.targetKey &&
          item.status ===
            "armed" &&
          snapshot.remainingSeconds <=
            item.minutes * 60
      );

    if (!due.length) {
      return;
    }

    const first =
      due.sort(
        (a, b) =>
          b.minutes -
          a.minutes
      )[0];

    state.warnings =
      state.warnings.map(
        item =>
          item.targetKey ===
              first.targetKey &&
          item.minutes ===
              first.minutes
            ? {
                ...item,
                status: "fired"
              }
            : item
      );

    saveState(
      state,
      {
        type: "warning-fired",
        minutes:
          first.minutes,
        targetKey:
          first.targetKey
      }
    );

    claimAlarm(
      `${first.targetKey}|${first.minutes}`
    );
  }

  function injectMiniStyles() {
    if (
      document.getElementById(
        "teacherDashboardBellStyles"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "teacherDashboardBellStyles";

    style.textContent = `
      .td-bell-mini {
        position: relative;
        width: 100%;
        max-width: 245px;
        font-family: Arial, Helvetica, sans-serif;
        color: #202124;
      }

      .td-bell-summary {
        width: 100%;
        min-height: 0 !important;
        border: 0 !important;
        border-radius: 14px !important;
        background: #fff !important;
        color: #202124 !important;
        box-shadow: 0 2px 8px rgba(0,0,0,.08);
        padding: 10px 14px !important;
        cursor: pointer;
        text-align: center;
      }

      .td-bell-summary:hover {
        background: #f8f9fa !important;
      }

      .td-bell-label {
        display: block;
        color: #5f6368;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .45px;
      }

      .td-bell-time {
        display: block;
        margin: 3px 0;
        font-size: 34px;
        line-height: 1;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }

      .td-bell-end {
        display: block;
        min-height: 14px;
        color: #5f6368;
        font-size: 11px;
      }

      .td-bell-chevron {
        display: inline-block;
        margin-left: 4px;
        color: #1a73e8;
        font-size: 10px;
      }

      .td-bell-panel {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 12000;
        display: none;
        width: min(330px, calc(100vw - 28px));
        padding: 14px;
        border: 1px solid #dadce0;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,.16);
        text-align: left;
      }

      .td-bell-mini.open .td-bell-panel {
        display: block;
      }

      .td-bell-panel-label {
        display: block;
        margin: 0 0 6px;
        color: #5f6368;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .5px;
      }

      .td-bell-select,
      .td-bell-custom-input {
        min-height: 38px !important;
        border: 1px solid #dadce0 !important;
        border-radius: 8px !important;
        background: #fff !important;
        color: #202124 !important;
        padding: 7px 9px !important;
        font: inherit !important;
      }

      .td-bell-select {
        width: 100%;
      }

      .td-bell-warning-row {
        display: grid;
        grid-template-columns: repeat(4,1fr);
        gap: 6px;
        margin-top: 10px;
      }

      .td-bell-warning {
        min-height: 36px !important;
        border: 1px solid #dadce0 !important;
        border-radius: 8px !important;
        background: #fff !important;
        color: #202124 !important;
        padding: 7px 5px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
      }

      .td-bell-warning.armed {
        border-color: #188038 !important;
        background: #e6f4ea !important;
        color: #137333 !important;
      }

      .td-bell-warning.fired {
        background: #f1f3f4 !important;
        color: #5f6368 !important;
      }

      .td-bell-custom {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 7px;
        margin-top: 8px;
      }

      .td-bell-custom-input {
        width: 80px;
      }

      .td-bell-custom-button,
      .td-bell-open-full,
      .td-bell-stop {
        min-height: 38px !important;
        border: 0 !important;
        border-radius: 8px !important;
        padding: 8px 10px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
      }

      .td-bell-custom-button {
        background: #e8f0fe !important;
        color: #174ea6 !important;
      }

      .td-bell-custom-button.armed {
        background: #188038 !important;
        color: #fff !important;
      }

      .td-bell-open-full {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-top: 10px;
        background: #1a73e8 !important;
        color: #fff !important;
        text-decoration: none;
      }

      .td-bell-armed-list {
        margin-top: 9px;
        color: #5f6368;
        font-size: 11px;
        line-height: 1.45;
      }

      .td-bell-message {
        min-height: 16px;
        margin-top: 8px;
        color: #b3261e;
        font-size: 11px;
        font-weight: 700;
      }

      .td-bell-stop {
        display: none;
        width: 100%;
        margin-top: 8px;
        background: #d93025 !important;
        color: #fff !important;
      }

      .td-bell-stop.visible {
        display: block;
      }

      .td-bell-mini.compact {
        max-width: 225px;
      }

      .td-bell-mini.compact .td-bell-summary {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 44px !important;
        padding: 8px 12px !important;
        border: 1px solid #dadce0 !important;
        border-radius: 999px !important;
        white-space: nowrap;
      }

      .td-bell-mini.compact .td-bell-summary::before {
        content: "🔔";
        font-size: 14px;
      }

      .td-bell-mini.compact .td-bell-label {
        display: inline;
        max-width: 105px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        text-transform: none;
        letter-spacing: 0;
      }

      .td-bell-mini.compact .td-bell-time {
        display: inline;
        margin: 0;
        font-size: 17px;
      }

      .td-bell-mini.compact .td-bell-end {
        display: none;
      }

      .td-bell-mini.compact .td-bell-chevron {
        margin-left: 0;
      }

      @media (max-width: 700px) {
        .td-bell-mini {
          max-width: 260px;
          margin: 0 auto;
        }

        .td-bell-panel {
          right: 50%;
          transform: translateX(50%);
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function miniMarkup() {
    const prefs =
      getPreferences();

    return `
      <button class="td-bell-summary" type="button" aria-expanded="false">
        <span class="td-bell-label">Loading Bell…</span>
        <span class="td-bell-time">--:--</span>
        <span class="td-bell-end"></span>
        <span class="td-bell-chevron">▼</span>
      </button>

      <div class="td-bell-panel">
        <label class="td-bell-panel-label">Bell Schedule</label>
        <select class="td-bell-select">
          <option value="auto">Auto Schedule</option>
          <option value="regular">Regular</option>
          <option value="lateStart">Late Start</option>
          <option value="minimum">Minimum Day</option>
        </select>

        <div class="td-bell-warning-row">
          ${[20,15,10,5].map(value =>
            `<button type="button" class="td-bell-warning" data-minutes="${value}">${value} min</button>`
          ).join("")}
        </div>

        <div class="td-bell-custom">
          <input
            class="td-bell-custom-input"
            type="number"
            min="1"
            max="180"
            step="1"
            value="${prefs.customWarningMinutes}"
            aria-label="Custom warning minutes">
          <button type="button" class="td-bell-custom-button">Arm Custom</button>
        </div>

        <div class="td-bell-armed-list"></div>
        <div class="td-bell-message"></div>

        <button type="button" class="td-bell-stop">⏹ Stop Alarm</button>

        <a class="td-bell-open-full" href="bell-countdown.html">
          Open Full Bell Countdown
        </a>
      </div>
    `;
  }

  function mountMiniControl(
    target,
    options = {}
  ) {
    const host =
      typeof target === "string"
        ? document.querySelector(
            target
          )
        : target;

    if (!host) {
      return null;
    }

    if (
      host.dataset.bellMounted ===
      "true"
    ) {
      return host._bellController || null;
    }

    injectMiniStyles();

    host.dataset.bellMounted =
      "true";

    const root =
      document.createElement(
        "div"
      );

    root.className =
      "td-bell-mini";

    if (
      options.compact === true ||
      host.hasAttribute(
        "data-bell-compact"
      )
    ) {
      root.classList.add(
        "compact"
      );
    }

    root.innerHTML =
      miniMarkup();

    host.replaceChildren(root);

    const summary =
      root.querySelector(
        ".td-bell-summary"
      );

    const panel =
      root.querySelector(
        ".td-bell-panel"
      );

    const label =
      root.querySelector(
        ".td-bell-label"
      );

    const time =
      root.querySelector(
        ".td-bell-time"
      );

    const end =
      root.querySelector(
        ".td-bell-end"
      );

    const select =
      root.querySelector(
        ".td-bell-select"
      );

    const warningButtons =
      [
        ...root.querySelectorAll(
          ".td-bell-warning"
        )
      ];

    const customInput =
      root.querySelector(
        ".td-bell-custom-input"
      );

    const customButton =
      root.querySelector(
        ".td-bell-custom-button"
      );

    const armedList =
      root.querySelector(
        ".td-bell-armed-list"
      );

    const message =
      root.querySelector(
        ".td-bell-message"
      );

    const stopButton =
      root.querySelector(
        ".td-bell-stop"
      );

    summary.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        root.classList.toggle(
          "open"
        );

        summary.setAttribute(
          "aria-expanded",
          String(
            root.classList.contains(
              "open"
            )
          )
        );
      }
    );

    panel.addEventListener(
      "click",
      event =>
        event.stopPropagation()
    );

    select.addEventListener(
      "change",
      () => {
        setScheduleMode(
          select.value
        );
        message.textContent = "";
        render();
      }
    );

    warningButtons.forEach(
      button => {
        button.addEventListener(
          "click",
          async () => {
            try {
              await enableAudio();
              toggleWarning(
                Number(
                  button.dataset.minutes
                )
              );
              message.textContent = "";
            } catch (error) {
              message.textContent =
                error.message;
            }

            render();
          }
        );
      }
    );

    customButton.addEventListener(
      "click",
      async () => {
        try {
          await enableAudio();

          const minutes =
            Math.floor(
              Number(
                customInput.value
              )
            );

          setPreferences({
            customWarningMinutes:
              minutes
          });

          toggleWarning(
            minutes
          );

          message.textContent = "";
        } catch (error) {
          message.textContent =
            error.message;
        }

        render();
      }
    );

    customInput.addEventListener(
      "input",
      render
    );

    stopButton.addEventListener(
      "click",
      event => {
        event.stopPropagation();
        stopAlarm();
        message.textContent =
          "Alarm stopped.";
        render();
      }
    );

    if (
      options.hideOpenFull ===
      true
    ) {
      root.querySelector(
        ".td-bell-open-full"
      ).style.display =
        "none";
    }

    function render() {
      const snapshot =
        getSnapshot();

      const state =
        loadState();

      const warnings =
        getWarnings();

      if (snapshot.countdownType === "schoolStart") {
        label.textContent =
          "School begins in";
        time.textContent =
          snapshot.displayCountdown;
        end.textContent =
          `${snapshot.targetDayLabel} • ${snapshot.scheduleLabel} • Starts ${formatClockTime(
            snapshot.targetTime
          )}`;
      } else if (snapshot.countdownType === "passingPeriod") {
        label.textContent =
          "Passing Period";
        time.textContent =
          snapshot.displayCountdown;
        end.textContent =
          `Ends ${formatClockTime(
            snapshot.targetTime
          )}`;
      } else {
        label.textContent =
          snapshot.entry.name;
        time.textContent =
          snapshot.displayCountdown;
        end.textContent =
          `Ends ${formatClockTime(
            snapshot.targetTime
          )}`;
      }

      select.value =
        snapshot.targetDateKey === snapshot.dateKey
          ? state.scheduleMode
          : "auto";

      warningButtons.forEach(
        button => {
          const minutes =
            Number(
              button.dataset.minutes
            );

          const warning =
            warnings.find(
              item =>
                item.minutes ===
                minutes
            );

          button.classList.toggle(
            "armed",
            warning?.status ===
              "armed"
          );

          button.classList.toggle(
            "fired",
            warning?.status ===
              "fired"
          );

          button.textContent =
            warning?.status ===
              "armed"
              ? `✓ ${minutes} min`
              : `${minutes} min`;
        }
      );

      const customMinutes =
        Math.floor(
          Number(
            customInput.value
          )
        );

      const customWarning =
        warnings.find(
          item =>
            item.minutes ===
              customMinutes
        );

      const customIsArmed =
        customWarning?.status ===
          "armed";

      customButton.classList.toggle(
        "armed",
        customIsArmed
      );

      customButton.textContent =
        customIsArmed
          ? `✓ ${customMinutes} min Armed`
          : "Arm Custom";

      const armed =
        warnings.filter(
          item =>
            item.status ===
            "armed"
        );

      const warningContext =
        snapshot.countdownType === "schoolStart"
          ? " before school"
          : snapshot.countdownType === "passingPeriod"
            ? " before passing ends"
            : "";

      armedList.innerHTML =
        armed.length
          ? armed
              .map(
                item =>
                  `${item.minutes}-minute warning${warningContext} armed.`
              )
              .join("<br>")
          : "";

      stopButton.classList.toggle(
        "visible",
        state.alarm.active
      );
    }

    const controller = {
      root,
      render,
      destroy() {
        root.remove();
      }
    };

    host._bellController =
      controller;

    render();

    return controller;
  }

  function renderAllMiniControls() {
    document
      .querySelectorAll(
        "[data-bell-mini]"
      )
      .forEach(host => {
        const controller =
          host._bellController ||
          mountMiniControl(host);

        controller?.render();
      });
  }

  function autoMount() {
    document
      .querySelectorAll(
        "[data-bell-mini]"
      )
      .forEach(host =>
        mountMiniControl(host)
      );
  }

  function handleUserInteraction() {
    // Any normal interaction on a utility page also unlocks browser audio
    // so an armed warning can still sound after navigating between apps.
    enableAudio();

    if (
      loadState().alarm.active
    ) {
      stopAlarm();
    }
  }

  function heartbeat() {
    const state =
      loadState();

    if (
      state.alarm.active &&
      state.alarm.ownerId !==
        INSTANCE_ID
    ) {
      stopLocalAlarmAudio();
    }

    syncCurrentClassFromBell();
    fireDueWarnings();
    renderAllMiniControls();
  }

  window.addEventListener(
    "storage",
    event => {
      if (
        event.key ===
          STATE_KEY ||
        event.key ===
          DashboardData.storageKey ||
        event.key ===
          PREFS_KEY
      ) {
        const state =
          loadState();

        if (
          !state.alarm.active ||
          state.alarm.ownerId !==
            INSTANCE_ID
        ) {
          stopLocalAlarmAudio();
        }

        renderAllMiniControls();

        window.dispatchEvent(
          new CustomEvent(
            CHANGE_EVENT,
            {
              detail: {
                type:
                  "external-change",
                state:
                  clone(state)
              }
            }
          )
        );
      }
    }
  );

  window.addEventListener(
    DashboardData.changeEvent,
    () => {
      renderAllMiniControls();
    }
  );

  document.addEventListener(
    "pointerdown",
    handleUserInteraction,
    true
  );

  document.addEventListener(
    "keydown",
    handleUserInteraction,
    true
  );

  document.addEventListener(
    "click",
    event => {
      document
        .querySelectorAll(
          ".td-bell-mini.open"
        )
        .forEach(root => {
          if (
            !root.contains(
              event.target
            )
          ) {
            root.classList.remove(
              "open"
            );

            root
              .querySelector(
                ".td-bell-summary"
              )
              ?.setAttribute(
                "aria-expanded",
                "false"
              );
          }
        });
    }
  );

  window.BellService =
    Object.freeze({
      stateKey:
        STATE_KEY,
      changeEvent:
        CHANGE_EVENT,

      getSnapshot,
      getAutoScheduleKey,
      getAutomaticClassId,
      syncCurrentClassFromBell,
      isSchoolDay,
      getWarnings,
      getPreferences,
      setPreferences,
      isAlarmActive: () =>
        loadState().alarm.active,

      setScheduleMode,
      setManualEntry,
      clearManualEntry,

      armWarning,
      disarmWarning,
      toggleWarning,
      clearWarnings,

      stopAlarm,
      enableAudio,
      playSelectedSoundOnce,

      formatCountdown,
      formatClockTime,
      scheduleDisplayName,

      mountMiniControl,
      renderAllMiniControls
    });

  // On page load, class-based utilities should open to the actual active
  // teaching period whenever the bell schedule can determine one.
  syncCurrentClassFromBell({ force: true });

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      autoMount
    );
  } else {
    autoMount();
  }

  setInterval(
    heartbeat,
    250
  );
})();

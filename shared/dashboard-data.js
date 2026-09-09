(() => {
  "use strict";

  const STORAGE_KEY = "teacherDashboard.sharedData.v1";
  const CHANGE_EVENT = "teacher-dashboard-data-changed";
  const LEGACY_TRACKER_KEY = "teacherDashboard_shared_v1";
  const LEGACY_MIGRATION_KEY = "teacherDashboard.participationLegacyMigration.v1";

  const PARTICIPATION_TERMS = [
    { id: "q1", label: "Quarter 1" },
    { id: "q2", label: "Quarter 2" },
    { id: "q3", label: "Quarter 3" },
    { id: "q4", label: "Quarter 4" },
    { id: "fall", label: "Fall Semester" },
    { id: "spring", label: "Spring Semester" }
  ];

  const DEFAULT_BELL_SCHEDULES = {
      regular: [
        { name: "Period 1", end: "09:04" },
        { name: "Period 2", end: "09:55" },
        { name: "Snack", end: "10:09" },
        { name: "Period 3", end: "11:00" },
        { name: "Period 4", end: "11:51" },
        { name: "Period 5", end: "12:42" },
        { name: "Lunch", end: "13:13" },
        { name: "Period 6", end: "14:04" },
        { name: "Period 7", end: "14:55" }
      ],
      lateStart: [
        { name: "Period 1", end: "09:47" },
        { name: "Period 2", end: "10:31" },
        { name: "Snack", end: "10:45" },
        { name: "Period 3", end: "11:29" },
        { name: "Period 4", end: "12:13" },
        { name: "Period 5", end: "12:57" },
        { name: "Lunch", end: "13:27" },
        { name: "Period 6", end: "14:11" },
        { name: "Period 7", end: "14:55" }
      ],
      minimum: [
        { name: "Period 1", end: "08:46" },
        { name: "Period 2", end: "09:21" },
        { name: "Period 3", end: "09:56" },
        { name: "Period 4", end: "10:31" },
        { name: "Snack", end: "10:55" },
        { name: "Period 5", end: "11:30" },
        { name: "Period 6", end: "12:05" },
        { name: "Period 7", end: "12:40" }
      ]
    };
  
  const DEFAULT_SCHOOL_START_TIMES = Object.freeze({
    regular: "08:10",
    lateStart: "09:02",
    minimum: "08:10"
  });

  const SCHOOL_YEAR_BACKUP_KEY =
      "teacherDashboard.schoolYearResetBackup.v1";

  const SCHOOL_YEAR_APP_KEYS = Object.freeze({
    scoreboard: "bjhScoreboard_v1",
    studentPicker: "studentNamePicker_v1",
    participationUI: "participationTracker.ui.v2",
    bellState: "teacherDashboard.bellState.v1"
  });

  const AGENDA_STORAGE_PREFIX =
    "bjhAgenda_v1_";


  function createDefaultClasses() {
    const classes = {};

    for (let i = 1; i <= 7; i += 1) {
      classes[String(i)] = {
        id: String(i),
        name: `Period ${i}`,
        active: true,
        students: []
      };
    }

    return classes;
  }

  function createDefaultParticipationTerm(definition) {
    const scores = {};

    for (let i = 1; i <= 7; i += 1) {
      scores[String(i)] = {};
    }

    return {
      id: definition.id,
      label: definition.label,
      goal: 5,
      scores
    };
  }

  function createDefaultParticipation() {
    const terms = {};

    PARTICIPATION_TERMS.forEach(definition => {
      terms[definition.id] = createDefaultParticipationTerm(definition);
    });

    return {
      activeTermId: "q1",
      terms
    };
  }


  function createDefaultCalendar() {
    return {
      minimumDayDates: []
    };
  }

  function normalizeDateKey(value) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";

    const [year, month, day] = text.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return "";
    }

    return text;
  }

  function normalizeMinimumDayDates(values) {
    if (!Array.isArray(values)) return [];

    return [...new Set(
      values
        .map(normalizeDateKey)
        .filter(Boolean)
    )].sort();
  }

  function normalizeBellSchedules(raw) {
    const incoming =
      raw && typeof raw === "object"
        ? raw
        : {};

    const result = {};

    ["regular", "lateStart", "minimum"].forEach(key => {
      const source =
        Array.isArray(incoming[key])
          ? incoming[key]
          : DEFAULT_BELL_SCHEDULES[key];

      const cleaned = source
        .map(item => ({
          name: String(item?.name ?? "").trim(),
          end: String(item?.end ?? "").trim()
        }))
        .filter(item =>
          item.name &&
          /^\d{2}:\d{2}$/.test(item.end)
        );

      result[key] =
        cleaned.length
          ? cleaned
          : clone(DEFAULT_BELL_SCHEDULES[key]);
    });

    return result;
  }

  function normalizeSchoolStartTimes(raw) {
    const incoming =
      raw && typeof raw === "object"
        ? raw
        : {};

    const result = {};

    ["regular", "lateStart", "minimum"].forEach(key => {
      const candidate = String(
        incoming[key] ?? DEFAULT_SCHOOL_START_TIMES[key]
      ).trim();

      result[key] = /^\d{2}:\d{2}$/.test(candidate)
        ? candidate
        : DEFAULT_SCHOOL_START_TIMES[key];
    });

    return result;
  }

  function createDefaultData() {
    return {
      version: 4,
      classes: createDefaultClasses(),
      currentClassId: "1",
      participation: createDefaultParticipation(),
      calendar: createDefaultCalendar(),
      bellSchedules: clone(DEFAULT_BELL_SCHEDULES),
      schoolStartTimes: clone(DEFAULT_SCHOOL_START_TIMES)
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStudentName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function participationNameKey(value) {
    return normalizeStudentName(value).toLocaleLowerCase();
  }

  function normalizeStudents(students) {
    if (!Array.isArray(students)) return [];

    const seen = new Set();
    const cleaned = [];

    for (const item of students) {
      const name = normalizeStudentName(item);
      if (!name) continue;

      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      cleaned.push(name);
    }

    return cleaned;
  }

  function clampGoal(value) {
    return Math.max(1, Math.min(20, Math.floor(Number(value) || 5)));
  }

  function clampPoints(value) {
    return Math.max(0, Math.min(999, Math.floor(Number(value) || 0)));
  }

  function normalizeParticipation(raw) {
    const defaults = createDefaultParticipation();
    const incoming = raw && typeof raw === "object" ? raw : {};
    const activeCandidate = String(
      incoming.activeTermId ?? incoming.activeTerm ?? defaults.activeTermId
    );

    const participation = {
      activeTermId: PARTICIPATION_TERMS.some(term => term.id === activeCandidate)
        ? activeCandidate
        : defaults.activeTermId,
      terms: {}
    };

    PARTICIPATION_TERMS.forEach(definition => {
      const incomingTerm = incoming.terms?.[definition.id] ?? {};
      const normalizedTerm = createDefaultParticipationTerm(definition);

      normalizedTerm.label =
        String(incomingTerm.label ?? definition.label).trim() || definition.label;
      normalizedTerm.goal = clampGoal(incomingTerm.goal);

      for (let i = 1; i <= 7; i += 1) {
        const classId = String(i);
        const incomingScores =
          incomingTerm.scores?.[classId] ?? incomingTerm.periods?.[classId] ?? {};

        if (!incomingScores || typeof incomingScores !== "object") continue;

        Object.entries(incomingScores).forEach(([rawKey, rawRecord]) => {
          let name = "";
          let points = 0;
          let updatedAt = "";

          if (rawRecord && typeof rawRecord === "object") {
            name = normalizeStudentName(rawRecord.name ?? "");
            points = clampPoints(rawRecord.points);
            updatedAt = String(rawRecord.updatedAt ?? "");
          } else {
            points = clampPoints(rawRecord);
          }

          if (!name && rawKey && !/^student[-_]/i.test(rawKey)) {
            name = normalizeStudentName(rawKey);
          }

          if (!name) return;

          const key = participationNameKey(name);
          normalizedTerm.scores[classId][key] = {
            name,
            points,
            updatedAt
          };
        });
      }

      participation.terms[definition.id] = normalizedTerm;
    });

    return participation;
  }

  function normalizeData(raw) {
    const defaults = createDefaultData();

    if (!raw || typeof raw !== "object") {
      return defaults;
    }

    const data = {
      version: 4,
      classes: {},
      currentClassId: String(raw.currentClassId ?? defaults.currentClassId),
      participation: normalizeParticipation(raw.participation),
      calendar: {
        minimumDayDates: normalizeMinimumDayDates(
          raw.calendar?.minimumDayDates ?? raw.minimumDayDates ?? []
        )
      },
      bellSchedules: normalizeBellSchedules(raw.bellSchedules),
      schoolStartTimes: normalizeSchoolStartTimes(
        raw.schoolStartTimes ?? raw.bellStartTimes
      )
    };

    for (let i = 1; i <= 7; i += 1) {
      const id = String(i);
      const incoming = raw.classes?.[id] ?? {};

      data.classes[id] = {
        id,
        name: String(incoming.name ?? `Period ${i}`).trim() || `Period ${i}`,
        active: incoming.active !== false,
        students: normalizeStudents(incoming.students)
      };
    }

    if (!data.classes[data.currentClassId] || !data.classes[data.currentClassId].active) {
      const firstActive = Object.values(data.classes).find(item => item.active);
      data.currentClassId = firstActive?.id ?? "1";
    }

    return data;
  }

  function hasAnyParticipationScores(data) {
    return PARTICIPATION_TERMS.some(definition =>
      Object.values(data.participation.terms[definition.id].scores).some(classScores =>
        Object.values(classScores).some(record => clampPoints(record?.points) > 0)
      )
    );
  }

  function migrateLegacyTrackerData(data) {
    if (localStorage.getItem(LEGACY_MIGRATION_KEY) === "true") {
      return { data, changed: false };
    }

    let legacy;

    try {
      const raw = localStorage.getItem(LEGACY_TRACKER_KEY);
      legacy = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("Legacy Participation Tracker data could not be read.", error);
      localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
      return { data, changed: false };
    }

    if (!legacy || typeof legacy !== "object") {
      localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
      return { data, changed: false };
    }

    let changed = false;
    const officialHadScores = hasAnyParticipationScores(data);

    for (let i = 1; i <= 7; i += 1) {
      const classId = String(i);
      const legacyRoster = Array.isArray(legacy.rosters?.[classId])
        ? legacy.rosters[classId]
        : [];

      if (data.classes[classId].students.length === 0 && legacyRoster.length > 0) {
        data.classes[classId].students = normalizeStudents(
          legacyRoster.map(student =>
            student && typeof student === "object" ? student.name : student
          )
        );
        changed = true;
      }
    }

    const legacyActive = String(legacy.participation?.activeTerm ?? "");

    if (
      !officialHadScores &&
      PARTICIPATION_TERMS.some(term => term.id === legacyActive)
    ) {
      data.participation.activeTermId = legacyActive;
      changed = true;
    }

    PARTICIPATION_TERMS.forEach(definition => {
      const legacyTerm = legacy.participation?.terms?.[definition.id];

      if (!legacyTerm || typeof legacyTerm !== "object") return;

      if (!officialHadScores && Number.isFinite(Number(legacyTerm.goal))) {
        data.participation.terms[definition.id].goal = clampGoal(legacyTerm.goal);
        changed = true;
      }

      for (let i = 1; i <= 7; i += 1) {
        const classId = String(i);
        const legacyRoster = Array.isArray(legacy.rosters?.[classId])
          ? legacy.rosters[classId]
          : [];
        const namesById = new Map();

        legacyRoster.forEach(student => {
          if (!student || typeof student !== "object") return;

          const id = String(student.id ?? "");
          const name = normalizeStudentName(student.name);

          if (id && name) namesById.set(id, name);
        });

        const legacyScores = legacyTerm.periods?.[classId];

        if (!legacyScores || typeof legacyScores !== "object") continue;

        Object.entries(legacyScores).forEach(([studentId, rawRecord]) => {
          const name = namesById.get(String(studentId));

          if (!name) return;

          const points = clampPoints(
            rawRecord && typeof rawRecord === "object"
              ? rawRecord.points
              : rawRecord
          );

          if (points <= 0) return;

          const key = participationNameKey(name);

          const officialRecord =
            data.participation.terms[definition.id].scores[classId][key];

          if (!officialRecord || clampPoints(officialRecord.points) === 0) {
            data.participation.terms[definition.id].scores[classId][key] = {
              name,
              points,
              updatedAt:
                rawRecord && typeof rawRecord === "object"
                  ? String(rawRecord.updatedAt ?? "")
                  : ""
            };

            changed = true;
          }
        });
      }
    });

    localStorage.setItem(LEGACY_MIGRATION_KEY, "true");

    return { data, changed };
  }

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      let data = saved
        ? normalizeData(JSON.parse(saved))
        : createDefaultData();

      const migration = migrateLegacyTrackerData(data);

      data = normalizeData(migration.data);

      if (!saved || migration.changed) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(data)
        );
      }

      return clone(data);

    } catch (error) {

      console.warn(
        "Teacher Dashboard shared data could not be loaded.",
        error
      );

      return createDefaultData();
    }
  }

  function save(data, detail = {}) {
    const normalized = normalizeData(data);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(normalized)
      );
    } catch (error) {
      console.error(
        "Teacher Dashboard shared data could not be saved.",
        error
      );

      throw error;
    }

    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, {
        detail: {
          data: clone(normalized),
          ...detail
        }
      })
    );

    return clone(normalized);
  }

  function getClasses(options = {}) {
    const { activeOnly = false } = options;
    const classes = Object.values(load().classes);

    return clone(
      activeOnly
        ? classes.filter(item => item.active)
        : classes
    );
  }

  function getClass(classId) {
    const id = String(classId);

    return clone(
      load().classes[id] ?? null
    );
  }

  function updateClass(classId, updates = {}) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "name")) {
      const name = String(updates.name ?? "").trim();

      data.classes[id].name =
        name || `Period ${id}`;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "active")) {
      data.classes[id].active =
        Boolean(updates.active);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "students")) {
      data.classes[id].students =
        normalizeStudents(updates.students);
    }

    return save(data, {
      type: "class-updated",
      classId: id
    });
  }

  function setClassActive(classId, active) {
    return updateClass(classId, { active });
  }

  function getRoster(classId) {
    return getClass(classId)?.students ?? [];
  }

  function saveRoster(classId, students) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    data.classes[id].students =
      normalizeStudents(students);

    return save(data, {
      type: "roster-updated",
      classId: id
    });
  }

  function getCurrentClassId() {
    return load().currentClassId;
  }

  function getCurrentClass() {
    const data = load();

    return clone(
      data.classes[data.currentClassId] ?? null
    );
  }

  function setCurrentClass(classId) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    if (!data.classes[id].active) {
      throw new Error(
        `Class ${id} is hidden and cannot be the current class.`
      );
    }

    data.currentClassId = id;

    return save(data, {
      type: "current-class-changed",
      classId: id
    });
  }

  function getParticipationTerms() {
    const data = load();

    return PARTICIPATION_TERMS.map(definition => ({
      id: definition.id,
      label: data.participation.terms[definition.id].label,
      goal: data.participation.terms[definition.id].goal
    }));
  }

  function getActiveParticipationTermId() {
    return load().participation.activeTermId;
  }

  function setActiveParticipationTerm(termId) {
    const id = String(termId);
    const data = load();

    if (!data.participation.terms[id]) {
      throw new Error(
        `Unknown participation term: ${id}`
      );
    }

    data.participation.activeTermId = id;

    return save(data, {
      type: "participation-term-changed",
      termId: id
    });
  }

  function getParticipationGoal(
    termId = getActiveParticipationTermId()
  ) {
    const id = String(termId);
    const data = load();

    return data.participation.terms[id]?.goal ?? 5;
  }

  function setParticipationGoal(termId, goal) {
    const id = String(termId);
    const data = load();

    if (!data.participation.terms[id]) {
      throw new Error(
        `Unknown participation term: ${id}`
      );
    }

    data.participation.terms[id].goal =
      clampGoal(goal);

    return save(data, {
      type: "participation-goal-changed",
      termId: id,
      goal: data.participation.terms[id].goal
    });
  }

  function getParticipationPoints(
    classId,
    studentName,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const nameKey =
      participationNameKey(studentName);

    if (!nameKey) return 0;

    const data = load();

    return clampPoints(
      data.participation
        .terms[termKey]
        ?.scores?.[classKey]
        ?.[nameKey]
        ?.points
    );
  }

  function setParticipationPoints(
    classId,
    studentName,
    points,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const name = normalizeStudentName(studentName);
    const nameKey = participationNameKey(name);
    const data = load();

    if (!data.classes[classKey]) {
      throw new Error(
        `Unknown class id: ${classKey}`
      );
    }

    if (!data.participation.terms[termKey]) {
      throw new Error(
        `Unknown participation term: ${termKey}`
      );
    }

    if (!nameKey) {
      throw new Error(
        "Student name is required."
      );
    }

    const nextPoints =
      clampPoints(points);

    const classScores =
      data.participation
        .terms[termKey]
        .scores[classKey];

    if (nextPoints === 0) {
      delete classScores[nameKey];
    } else {
      classScores[nameKey] = {
        name,
        points: nextPoints,
        updatedAt: new Date().toISOString()
      };
    }

    save(data, {
      type: "participation-points-changed",
      classId: classKey,
      termId: termKey,
      studentName: name,
      points: nextPoints
    });

    return nextPoints;
  }

  function adjustParticipationPoints(
    classId,
    studentName,
    delta = 1,
    termId = getActiveParticipationTermId()
  ) {
    const previous =
      getParticipationPoints(
        classId,
        studentName,
        termId
      );

    return setParticipationPoints(
      classId,
      studentName,
      previous + Number(delta || 0),
      termId
    );
  }

  function getParticipationForClass(
    classId,
    termId = getActiveParticipationTermId()
  ) {
    const id = String(classId);
    const termKey = String(termId);
    const data = load();

    const roster =
      data.classes[id]?.students ?? [];

    const term =
      data.participation.terms[termKey];

    if (!term) {
      throw new Error(
        `Unknown participation term: ${termKey}`
      );
    }

    return roster.map(name => ({
      name,

      points: clampPoints(
        term.scores[id]
          ?.[participationNameKey(name)]
          ?.points
      ),

      goal: term.goal,

      complete:
        clampPoints(
          term.scores[id]
            ?.[participationNameKey(name)]
            ?.points
        ) >= term.goal
    }));
  }


  function getBellSchedules() {
    return clone(load().bellSchedules);
  }

  function getBellSchedule(scheduleKey) {
    const key = String(scheduleKey);
    const schedules = load().bellSchedules;

    return clone(
      schedules[key] ?? schedules.regular
    );
  }

  function setBellSchedules(schedules) {
    const data = load();
    data.bellSchedules = normalizeBellSchedules(schedules);

    return save(data, {
      type: "bell-schedules-changed"
    });
  }

  function getSchoolStartTimes() {
    return clone(
      load().schoolStartTimes
    );
  }

  function getSchoolStartTime(scheduleKey) {
    const key = String(scheduleKey);
    const times = load().schoolStartTimes;

    return times[key] ?? times.regular;
  }

  function setSchoolStartTimes(startTimes) {
    const data = load();
    data.schoolStartTimes = normalizeSchoolStartTimes(startTimes);

    return save(data, {
      type: "school-start-times-changed"
    });
  }

  function getMinimumDayDates() {
    return clone(
      load().calendar.minimumDayDates
    );
  }

  function setMinimumDayDates(dateKeys) {
    const data = load();

    data.calendar.minimumDayDates =
      normalizeMinimumDayDates(dateKeys);

    return save(data, {
      type: "minimum-day-dates-changed",
      minimumDayDates:
        clone(data.calendar.minimumDayDates)
    });
  }

  function addMinimumDayDate(dateKey) {
    const normalized =
      normalizeDateKey(dateKey);

    if (!normalized) {
      throw new Error(
        "Choose a valid minimum-day date."
      );
    }

    const dates =
      getMinimumDayDates();

    if (!dates.includes(normalized)) {
      dates.push(normalized);
    }

    return setMinimumDayDates(dates);
  }

  function removeMinimumDayDate(dateKey) {
    const normalized =
      normalizeDateKey(dateKey);

    if (!normalized) {
      return load();
    }

    return setMinimumDayDates(
      getMinimumDayDates()
        .filter(item => item !== normalized)
    );
  }

  function isMinimumDayDate(dateOrKey = new Date()) {
    let key = "";

    if (dateOrKey instanceof Date) {
      const year = dateOrKey.getFullYear();
      const month =
        String(dateOrKey.getMonth() + 1)
          .padStart(2, "0");
      const day =
        String(dateOrKey.getDate())
          .padStart(2, "0");

      key = `${year}-${month}-${day}`;
    } else {
      key = normalizeDateKey(dateOrKey);
    }

    return (
      Boolean(key) &&
      getMinimumDayDates().includes(key)
    );
  }

  function getRawStorageValue(key) {
    return localStorage.getItem(key);
  }

  function restoreRawStorageValue(key, value) {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }

  function getStorageValuesByPrefix(prefix) {
    const values = {};

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      values[key] = localStorage.getItem(key);
    }

    return values;
  }

  function removeStorageByPrefix(prefix) {
    const keys = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }

    keys.forEach(key => localStorage.removeItem(key));
  }

  function restoreStorageValuesByPrefix(prefix, values) {
    removeStorageByPrefix(prefix);

    if (!values || typeof values !== "object") return;

    Object.entries(values).forEach(([key, value]) => {
      if (!key.startsWith(prefix)) return;
      restoreRawStorageValue(key, value);
    });
  }

  function resetStudentPickerSchoolYearState(rawText) {
    if (!rawText) return null;

    try {
      const parsed = JSON.parse(rawText);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const next = clone(parsed);

      next.currentPeriod = "1";
      next.visiblePeriods = [
        "1", "2", "3", "4", "5", "6", "7"
      ];

      if (!next.pickerConfig || typeof next.pickerConfig !== "object") {
        next.pickerConfig = {
          strategy: "random",
          target: "below-goal"
        };
      }

      next.periods = next.periods && typeof next.periods === "object"
        ? next.periods
        : {};

      for (let i = 1; i <= 7; i += 1) {
        const id = String(i);
        const previous =
          next.periods[id] && typeof next.periods[id] === "object"
            ? next.periods[id]
            : {};

        next.periods[id] = {
          ...previous,
          masterRoster: [],
          pool: [],
          history: [],
          groups: [],
          groupConfig:
            previous.groupConfig && typeof previous.groupConfig === "object"
              ? previous.groupConfig
              : {
                  method: "size",
                  value: 4
                }
        };
      }

      return JSON.stringify(next);
    } catch (error) {
      console.warn(
        "Student Picker school-year data could not be reset cleanly.",
        error
      );
      return null;
    }
  }

  function resetParticipationUIState(rawText) {
    if (!rawText) return null;

    try {
      const parsed = JSON.parse(rawText);

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return JSON.stringify({
        ...parsed,
        undoStack: []
      });
    } catch (error) {
      console.warn(
        "Participation Tracker UI state could not be reset cleanly.",
        error
      );
      return null;
    }
  }

  function createSchoolYearBackup(sharedData) {
    const appStorage = {};

    Object.entries(SCHOOL_YEAR_APP_KEYS).forEach(([name, key]) => {
      appStorage[name] = getRawStorageValue(key);
    });

    return {
      version: 3,
      createdAt: new Date().toISOString(),
      sharedData: clone(sharedData),
      appStorage,
      agendaStorage: getStorageValuesByPrefix(AGENDA_STORAGE_PREFIX)
    };
  }

  function newSchoolYearReset() {
    const before = load();
    const backup = createSchoolYearBackup(before);

    try {
      localStorage.setItem(
        SCHOOL_YEAR_BACKUP_KEY,
        JSON.stringify(backup)
      );
    } catch (error) {
      console.error(
        "The pre-reset school-year backup could not be saved.",
        error
      );
      throw new Error(
        "Reset canceled because the pre-reset backup could not be saved."
      );
    }

    const next = createDefaultData();

    // School-wide bell timing is configuration, so it survives the reset.
    next.bellSchedules =
      clone(before.bellSchedules);
    next.schoolStartTimes =
      clone(before.schoolStartTimes);

    // Scoreboard championship/results data belongs to the old school year.
    localStorage.removeItem(
      SCHOOL_YEAR_APP_KEYS.scoreboard
    );

    // Clear old rosters, picker pools/history/groups while preserving picker
    // style/target choices and each period's preferred group configuration.
    const resetPicker =
      resetStudentPickerSchoolYearState(
        backup.appStorage.studentPicker
      );

    if (resetPicker === null) {
      localStorage.removeItem(
        SCHOOL_YEAR_APP_KEYS.studentPicker
      );
    } else {
      localStorage.setItem(
        SCHOOL_YEAR_APP_KEYS.studentPicker,
        resetPicker
      );
    }

    // Participation scores are cleared in shared data. The Tracker's undo
    // history is also cleared so last year's students cannot be restored.
    const resetParticipationUI =
      resetParticipationUIState(
        backup.appStorage.participationUI
      );

    if (resetParticipationUI === null) {
      localStorage.removeItem(
        SCHOOL_YEAR_APP_KEYS.participationUI
      );
    } else {
      localStorage.setItem(
        SCHOOL_YEAR_APP_KEYS.participationUI,
        resetParticipationUI
      );
    }

    // Agenda entries belong to the old school year. They are included in the
    // pre-reset backup so Undo Last School Year Reset can restore them.
    removeStorageByPrefix(
      AGENDA_STORAGE_PREFIX
    );

    // Armed warnings/current bell target are session state, not preferences.
    localStorage.removeItem(
      SCHOOL_YEAR_APP_KEYS.bellState
    );

    // Prevent the very old Participation Tracker storage format from
    // being migrated back into the freshly reset dashboard.
    localStorage.setItem(
      LEGACY_MIGRATION_KEY,
      "true"
    );

    return save(next, {
      type: "new-school-year-reset",
      backedUpApps: [
        "shared-dashboard-data",
        "scoreboard",
        "student-picker",
        "participation-tracker",
        "agenda",
        "bell-session"
      ]
    });
  }

  function canUndoNewSchoolYearReset() {
    return Boolean(
      localStorage.getItem(
        SCHOOL_YEAR_BACKUP_KEY
      )
    );
  }

  function undoNewSchoolYearReset() {
    const raw =
      localStorage.getItem(
        SCHOOL_YEAR_BACKUP_KEY
      );

    if (!raw) {
      throw new Error(
        "No school-year reset backup is available."
      );
    }

    const parsed = JSON.parse(raw);

    // Version 3 backs up the complete school-year state across apps,
    // including all date-based Agenda records.
    if (
      parsed &&
      parsed.version === 3 &&
      parsed.sharedData &&
      parsed.appStorage &&
      typeof parsed.appStorage === "object"
    ) {
      Object.entries(SCHOOL_YEAR_APP_KEYS).forEach(([name, key]) => {
        restoreRawStorageValue(
          key,
          Object.prototype.hasOwnProperty.call(
            parsed.appStorage,
            name
          )
            ? parsed.appStorage[name]
            : null
        );
      });

      restoreStorageValuesByPrefix(
        AGENDA_STORAGE_PREFIX,
        parsed.agendaStorage
      );

      const restored = normalizeData(parsed.sharedData);

      const result = save(restored, {
        type: "new-school-year-reset-undone",
        restoredApps: [
          "shared-dashboard-data",
          "scoreboard",
          "student-picker",
          "participation-tracker",
          "agenda",
          "bell-session"
        ]
      });

      localStorage.removeItem(
        SCHOOL_YEAR_BACKUP_KEY
      );

      return result;
    }

    // Version 2 backs up the complete school-year state across apps.
    if (
      parsed &&
      parsed.version === 2 &&
      parsed.sharedData &&
      parsed.appStorage &&
      typeof parsed.appStorage === "object"
    ) {
      Object.entries(SCHOOL_YEAR_APP_KEYS).forEach(([name, key]) => {
        restoreRawStorageValue(
          key,
          Object.prototype.hasOwnProperty.call(
            parsed.appStorage,
            name
          )
            ? parsed.appStorage[name]
            : null
        );
      });

      const restored =
        normalizeData(
          parsed.sharedData
        );

      const result =
        save(restored, {
          type: "new-school-year-reset-undone",
          restoredApps: [
            "shared-dashboard-data",
            "scoreboard",
            "student-picker",
            "participation-tracker",
            "bell-session"
          ]
        });

      localStorage.removeItem(
        SCHOOL_YEAR_BACKUP_KEY
      );

      return result;
    }

    // Backward compatibility for the first reset-backup format, which stored
    // only DashboardData.
    const restored =
      normalizeData(parsed);

    const result =
      save(restored, {
        type: "new-school-year-reset-undone"
      });

    localStorage.removeItem(
      SCHOOL_YEAR_BACKUP_KEY
    );

    return result;
  }

  function resetSharedData() {
    const defaults =
      createDefaultData();

    return save(defaults, {
      type: "reset"
    });
  }

  function exportSharedData() {
    return JSON.stringify(
      load(),
      null,
      2
    );
  }

  function importSharedData(jsonText) {
    const parsed =
      JSON.parse(String(jsonText));

    return save(parsed, {
      type: "import"
    });
  }

  window.addEventListener(
    "storage",
    event => {
      if (event.key !== STORAGE_KEY) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent(
          CHANGE_EVENT,
          {
            detail: {
              type: "external-storage-change",
              data: load()
            }
          }
        )
      );
    }
  );

  window.DashboardData =
    Object.freeze({
      storageKey: STORAGE_KEY,
      changeEvent: CHANGE_EVENT,
      participationTerms:
        clone(PARTICIPATION_TERMS),

      load,
      save,

      getClasses,
      getClass,
      updateClass,
      setClassActive,

      getRoster,
      saveRoster,

      getCurrentClassId,
      getCurrentClass,
      setCurrentClass,

      getParticipationTerms,
      getActiveParticipationTermId,
      setActiveParticipationTerm,
      getParticipationGoal,
      setParticipationGoal,
      getParticipationPoints,
      setParticipationPoints,
      adjustParticipationPoints,
      getParticipationForClass,

      getBellSchedules,
      getBellSchedule,
      setBellSchedules,
      getSchoolStartTimes,
      getSchoolStartTime,
      setSchoolStartTimes,

      getMinimumDayDates,
      setMinimumDayDates,
      addMinimumDayDate,
      removeMinimumDayDate,
      isMinimumDayDate,

      newSchoolYearReset,
      canUndoNewSchoolYearReset,
      undoNewSchoolYearReset,

      resetSharedData,
      exportSharedData,
      importSharedData
    });
})();

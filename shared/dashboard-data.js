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
    reminders: "teacherDashboard.classReminders.v1",
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
        rosterSource: "manual",
        students: [],
        studentRecords: []
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

  function createDefaultClassroom() {
    const mappings = {};

    for (let i = 1; i <= 7; i += 1) {
      mappings[String(i)] = {
        courseId: "",
        courseName: "",
        section: "",
        lastImportedAt: "",
        lastRosterChange: {
          added: [],
          removed: [],
          renamed: [],
          moved: [],
          initialImport: false,
          at: ""
        },
        students: []
      };
    }

    return { mappings };
  }



  function createDefaultParticipationInstructions(termLabel) {
    return `This assignment tracks your ${termLabel} participation credit.\n\nYou earn participation points by contributing to class discussions, volunteering answers, asking relevant questions, and participating appropriately in class activities. Your goal is to earn enough participation points to receive full credit by the end of the grading period.\n\nYour score may be updated periodically as you earn additional participation points. If your current score is low, you still have time to improve it by volunteering and participating more often in class.\n\nNo written work or attachment is required for this assignment. Please open the assignment and click Turn In once so your participation grade can be synced and updated through Google Classroom.`;
  }

  function createDefaultParticipationGradeSync() {
    const terms = {};

    PARTICIPATION_TERMS.forEach(definition => {
      terms[definition.id] = {
        title: `Participation — ${definition.label}`,
        instructions: createDefaultParticipationInstructions(definition.label),
        assignmentPoints: 20,
        roundWhole: true,
        publishAssignments: false,
        topicName: "",
        dueDate: "",
        dueTime: "23:59",
        assignments: {}
      };
    });

    return { terms };
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
      version: 11,
      classes: createDefaultClasses(),
      currentClassId: "1",
      participation: createDefaultParticipation(),
      classroom: createDefaultClassroom(),
      participationGradeSync: createDefaultParticipationGradeSync(),
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

  function localStudentId(classId, name) {
    const normalized = participationNameKey(name);
    return normalized ? `local:${String(classId)}:${encodeURIComponent(normalized)}` : "";
  }

  function googleStudentId(googleId) {
    const id = String(googleId ?? "").trim();
    return id ? `google:${id}` : "";
  }

  function normalizeStudentRecord(classId, student) {
    if (!student) return null;

    if (typeof student === "string") {
      const name = normalizeStudentName(student);
      if (!name) return null;
      return {
        id: localStudentId(classId, name),
        name,
        source: "local",
        googleId: "",
        courseId: ""
      };
    }

    if (typeof student !== "object") return null;

    const name = normalizeStudentName(student.name ?? student.profile?.name?.fullName ?? "");
    if (!name) return null;

    const source = String(student.source ?? "").trim();
    const rawId = String(student.id ?? "").trim();
    const rawGoogleId = String(student.googleId ?? student.userId ?? "").trim();
    const isGoogle =
      source === "googleClassroom" ||
      rawGoogleId ||
      rawId.startsWith("google:");

    if (isGoogle) {
      const gid = rawGoogleId || (rawId.startsWith("google:") ? rawId.slice(7) : rawId);
      if (!gid) return null;
      return {
        id: googleStudentId(gid),
        name,
        source: "googleClassroom",
        googleId: gid,
        courseId: String(student.courseId ?? "").trim()
      };
    }

    const localId = rawId.startsWith("local:") ? rawId : localStudentId(classId, name);
    return {
      id: localId,
      name,
      source: "local",
      googleId: "",
      courseId: ""
    };
  }

  function normalizeStudentRecords(classId, records, fallbackNames = [], classroomStudents = []) {
    const source =
      Array.isArray(records) && records.length
        ? records
        : Array.isArray(classroomStudents) && classroomStudents.length
          ? classroomStudents.map(student => ({
              id: student.id,
              googleId: student.id,
              name: student.name,
              source: "googleClassroom",
              courseId: student.courseId
            }))
          : fallbackNames;

    const seen = new Set();
    const cleaned = [];

    for (const item of source || []) {
      const record = normalizeStudentRecord(classId, item);
      if (!record || !record.id || seen.has(record.id)) continue;
      seen.add(record.id);
      cleaned.push(record);
    }

    return cleaned;
  }

  function resolveStudentFromData(data, classId, studentRef) {
    const classKey = String(classId);
    const records = data?.classes?.[classKey]?.studentRecords ?? [];

    let candidateId = "";
    let candidateName = "";

    if (studentRef && typeof studentRef === "object") {
      candidateId = String(studentRef.id ?? studentRef.studentId ?? studentRef.googleId ?? "").trim();
      candidateName = normalizeStudentName(studentRef.name ?? "");
    } else {
      const text = String(studentRef ?? "").trim();
      candidateId = text;
      candidateName = normalizeStudentName(text);
    }

    if (candidateId) {
      const exact = records.find(record =>
        record.id === candidateId ||
        record.googleId === candidateId ||
        record.id === googleStudentId(candidateId)
      );
      if (exact) return exact;

      if (candidateId.startsWith("google:")) {
        return {
          id: candidateId,
          name: candidateName || candidateId,
          source: "googleClassroom",
          googleId: candidateId.slice(7),
          courseId: ""
        };
      }

      if (candidateId.startsWith("local:")) {
        return {
          id: candidateId,
          name: candidateName || candidateId,
          source: "local",
          googleId: "",
          courseId: ""
        };
      }
    }

    if (candidateName) {
      const matches = records.filter(record =>
        participationNameKey(record.name) === participationNameKey(candidateName)
      );
      if (matches.length) return matches[0];

      return {
        id: localStudentId(classKey, candidateName),
        name: candidateName,
        source: "local",
        googleId: "",
        courseId: ""
      };
    }

    return null;
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

  function normalizeParticipation(raw, data = null) {
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
          let storedStudentId = "";

          if (rawRecord && typeof rawRecord === "object") {
            name = normalizeStudentName(rawRecord.name ?? "");
            points = clampPoints(rawRecord.points);
            updatedAt = String(rawRecord.updatedAt ?? "");
            storedStudentId = String(rawRecord.studentId ?? "").trim();
          } else {
            points = clampPoints(rawRecord);
          }

          const rawLooksStable = rawKey.startsWith("google:") || rawKey.startsWith("local:");
          if (!name && rawKey && !rawLooksStable && !/^student[-_]/i.test(rawKey)) {
            name = normalizeStudentName(rawKey);
          }

          let student = null;
          if (data) {
            if (storedStudentId) student = resolveStudentFromData(data, classId, { id: storedStudentId, name });
            if (!student && rawLooksStable) student = resolveStudentFromData(data, classId, { id: rawKey, name });
            if (!student && name) student = resolveStudentFromData(data, classId, name);
          }

          const studentId =
            student?.id ||
            storedStudentId ||
            (rawLooksStable ? rawKey : localStudentId(classId, name));

          const finalName = student?.name || name;
          if (!studentId || !finalName) return;

          const existing = normalizedTerm.scores[classId][studentId];
          if (!existing || points >= clampPoints(existing.points)) {
            normalizedTerm.scores[classId][studentId] = {
              studentId,
              name: finalName,
              points,
              updatedAt
            };
          }
        });
      }

      participation.terms[definition.id] = normalizedTerm;
    });

    return participation;
  }

  function normalizeClassroomStudent(student, fallbackCourseId = "") {
    if (!student || typeof student !== "object") return null;

    const id = String(student.id ?? student.userId ?? "").trim();
    const name = normalizeStudentName(student.name ?? student.profile?.name?.fullName ?? "");
    const courseId = String(student.courseId ?? fallbackCourseId ?? "").trim();

    if (!id || !name) return null;

    return {
      id,
      name,
      source: "googleClassroom",
      courseId
    };
  }

  function normalizeClassroom(raw) {
    const defaults = createDefaultClassroom();
    const incoming = raw && typeof raw === "object" ? raw : {};
    const incomingMappings = incoming.mappings && typeof incoming.mappings === "object"
      ? incoming.mappings
      : {};

    const classroom = { mappings: {} };

    for (let i = 1; i <= 7; i += 1) {
      const classId = String(i);
      const source = incomingMappings[classId] && typeof incomingMappings[classId] === "object"
        ? incomingMappings[classId]
        : defaults.mappings[classId];
      const courseId = String(source.courseId ?? "").trim();
      const seenIds = new Set();
      const students = [];

      if (Array.isArray(source.students)) {
        source.students.forEach(student => {
          const normalized = normalizeClassroomStudent(student, courseId);
          if (!normalized || seenIds.has(normalized.id)) return;
          seenIds.add(normalized.id);
          students.push(normalized);
        });
      }

      const rawRosterChange = source.lastRosterChange && typeof source.lastRosterChange === "object"
        ? source.lastRosterChange
        : {};
      const normalizeRosterChangeStudent = item => {
        if (!item || typeof item !== "object") return null;
        const id = String(item.id ?? "").trim();
        const name = normalizeStudentName(item.name ?? "");
        return id && name ? { id, name } : null;
      };
      const normalizeRename = item => {
        if (!item || typeof item !== "object") return null;
        const id = String(item.id ?? "").trim();
        const from = normalizeStudentName(item.from ?? "");
        const to = normalizeStudentName(item.to ?? "");
        return id && from && to ? { id, from, to } : null;
      };
      const normalizeMove = item => {
        if (!item || typeof item !== "object") return null;
        const id = String(item.id ?? "").trim();
        const name = normalizeStudentName(item.name ?? item.toName ?? item.fromName ?? "");
        const fromClassId = String(item.fromClassId ?? "").trim();
        const toClassId = String(item.toClassId ?? "").trim();
        const termsMoved = Math.max(0, Math.floor(Number(item.termsMoved) || 0));
        return id && name && fromClassId && toClassId
          ? { id, name, fromClassId, toClassId, termsMoved }
          : null;
      };

      classroom.mappings[classId] = {
        courseId,
        courseName: String(source.courseName ?? "").trim(),
        section: String(source.section ?? "").trim(),
        lastImportedAt: String(source.lastImportedAt ?? "").trim(),
        lastRosterChange: {
          added: Array.isArray(rawRosterChange.added) ? rawRosterChange.added.map(normalizeRosterChangeStudent).filter(Boolean) : [],
          removed: Array.isArray(rawRosterChange.removed) ? rawRosterChange.removed.map(normalizeRosterChangeStudent).filter(Boolean) : [],
          renamed: Array.isArray(rawRosterChange.renamed) ? rawRosterChange.renamed.map(normalizeRename).filter(Boolean) : [],
          moved: Array.isArray(rawRosterChange.moved) ? rawRosterChange.moved.map(normalizeMove).filter(Boolean) : [],
          initialImport: rawRosterChange.initialImport === true,
          at: String(rawRosterChange.at ?? "").trim()
        },
        students
      };
    }

    return classroom;
  }

  function normalizeParticipationGradeAssignment(raw) {
    if (!raw || typeof raw !== "object") return null;

    const courseId = String(raw.courseId ?? "").trim();
    const courseWorkId = String(raw.courseWorkId ?? raw.id ?? "").trim();
    if (!courseId || !courseWorkId) return null;

    return {
      courseId,
      courseWorkId,
      title: String(raw.title ?? "").trim(),
      maxPoints: Math.max(1, Math.floor(Number(raw.maxPoints) || 20)),
      alternateLink: String(raw.alternateLink ?? "").trim(),
      createdAt: String(raw.createdAt ?? raw.creationTime ?? "").trim(),
      lastSyncedAt: String(raw.lastSyncedAt ?? "").trim(),
      state: ["DRAFT", "PUBLISHED"].includes(String(raw.state ?? "").toUpperCase())
        ? String(raw.state).toUpperCase()
        : "DRAFT",
      topicId: String(raw.topicId ?? "").trim(),
      topicName: String(raw.topicName ?? "").trim(),
      dueDate: normalizeDateKey(raw.dueDate ?? ""),
      dueTime: /^\d{2}:\d{2}$/.test(String(raw.dueTime ?? "").trim())
        ? String(raw.dueTime).trim()
        : "",
      lastSyncSummary: {
        syncedCount: Math.max(0, Math.floor(Number(raw.lastSyncSummary?.syncedCount) || 0)),
        missingSubmissionCount: Math.max(0, Math.floor(Number(raw.lastSyncSummary?.missingSubmissionCount) || 0)),
        failedCount: Math.max(0, Math.floor(Number(raw.lastSyncSummary?.failedCount) || 0)),
        at: String(raw.lastSyncSummary?.at ?? raw.lastSyncedAt ?? "").trim()
      }
    };
  }

  function normalizeParticipationGradeSync(raw) {
    const defaults = createDefaultParticipationGradeSync();
    const incoming = raw && typeof raw === "object" ? raw : {};
    const result = { terms: {} };

    PARTICIPATION_TERMS.forEach(definition => {
      const source = incoming.terms?.[definition.id] && typeof incoming.terms[definition.id] === "object"
        ? incoming.terms[definition.id]
        : {};
      const fallback = defaults.terms[definition.id];
      const assignments = {};

      for (let i = 1; i <= 7; i += 1) {
        const classId = String(i);
        const assignment = normalizeParticipationGradeAssignment(source.assignments?.[classId]);
        if (assignment) assignments[classId] = assignment;
      }

      result.terms[definition.id] = {
        title: String(source.title ?? fallback.title).trim() || fallback.title,
        instructions: String(source.instructions ?? fallback.instructions).trim() || fallback.instructions,
        assignmentPoints: Math.max(1, Math.min(1000, Math.floor(Number(source.assignmentPoints) || fallback.assignmentPoints))),
        roundWhole: source.roundWhole !== false,
        publishAssignments: source.publishAssignments === true,
        topicName: String(source.topicName ?? fallback.topicName ?? "").trim(),
        dueDate: normalizeDateKey(source.dueDate ?? fallback.dueDate ?? ""),
        dueTime: /^\d{2}:\d{2}$/.test(String(source.dueTime ?? fallback.dueTime ?? "23:59").trim())
          ? String(source.dueTime ?? fallback.dueTime ?? "23:59").trim()
          : "23:59",
        assignments
      };
    });

    return result;
  }

  function normalizeData(raw) {
    const defaults = createDefaultData();

    if (!raw || typeof raw !== "object") {
      return defaults;
    }

    const classroom = normalizeClassroom(raw.classroom);

    const data = {
      version: 11,
      classes: {},
      currentClassId: String(raw.currentClassId ?? defaults.currentClassId),
      participation: createDefaultParticipation(),
      classroom,
      participationGradeSync: normalizeParticipationGradeSync(raw.participationGradeSync),
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
      const savedSource = String(incoming.rosterSource ?? "").trim();
      const mapping = classroom.mappings[id] ?? {};
      const inferredSource = ["manual", "googleClassroom"].includes(savedSource)
        ? savedSource
        : (mapping.courseId && (mapping.lastImportedAt || mapping.students?.length))
          ? "googleClassroom"
          : "manual";
      const studentRecords = normalizeStudentRecords(
        id,
        incoming.studentRecords,
        Array.isArray(incoming.students) ? incoming.students : [],
        inferredSource === "googleClassroom" ? (mapping.students ?? []) : []
      );

      data.classes[id] = {
        id,
        name: String(incoming.name ?? `Period ${i}`).trim() || `Period ${i}`,
        active: incoming.active !== false,
        rosterSource: inferredSource,
        students: normalizeStudents(studentRecords.map(student => student.name)),
        studentRecords
      };
    }

    data.participation = normalizeParticipation(raw.participation, data);

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

  function applyManualRosterToData(data, classId, students) {
    const id = String(classId);
    const names = normalizeStudents(students);
    const existing = data.classes[id]?.studentRecords ?? [];
    const used = new Set();
    const records = names.map(name => {
      const match = existing.find(record =>
        !used.has(record.id) &&
        participationNameKey(record.name) === participationNameKey(name)
      );

      if (match) {
        used.add(match.id);
        return { ...match, name };
      }

      return normalizeStudentRecord(id, name);
    }).filter(Boolean);

    data.classes[id].studentRecords = records;
    data.classes[id].students = normalizeStudents(records.map(record => record.name));
  }

  function reconcileParticipationToCurrentRoster(data, classId) {
    const id = String(classId);
    const currentStudents = data.classes[id]?.studentRecords ?? [];

    PARTICIPATION_TERMS.forEach(definition => {
      const scores = data.participation.terms?.[definition.id]?.scores?.[id];
      if (!scores) return;

      currentStudents.forEach(student => {
        if (scores[student.id]) {
          scores[student.id].name = student.name;
          scores[student.id].studentId = student.id;
          return;
        }

        const nameKey = participationNameKey(student.name);
        const legacyEntry = Object.entries(scores).find(([key, record]) =>
          key !== student.id &&
          participationNameKey(record?.name ?? "") === nameKey
        );

        if (!legacyEntry) return;
        const [legacyKey, legacyRecord] = legacyEntry;
        scores[student.id] = {
          studentId: student.id,
          name: student.name,
          points: clampPoints(legacyRecord?.points),
          updatedAt: String(legacyRecord?.updatedAt ?? "")
        };
        delete scores[legacyKey];
      });
    });
  }


  function classHasParticipationForGoogleStudent(data, classId, googleId) {
    const stableId = googleStudentId(googleId);
    if (!stableId) return false;

    return PARTICIPATION_TERMS.some(definition => {
      const record = data.participation.terms?.[definition.id]?.scores?.[String(classId)]?.[stableId];
      return Boolean(record);
    });
  }

  function findLikelyTransferSource(data, toClassId, googleId) {
    const targetId = String(toClassId);
    const gid = String(googleId ?? "").trim();
    if (!gid) return "";

    // Best signal: another roster was just refreshed and recorded this student
    // as removed. This handles "old period refreshed first".
    const recentRemoval = Object.entries(data.classroom.mappings || {})
      .filter(([classId]) => classId !== targetId)
      .map(([classId, mapping]) => ({ classId, mapping }))
      .filter(({ mapping }) => Array.isArray(mapping?.lastRosterChange?.removed) &&
        mapping.lastRosterChange.removed.some(student => String(student.id) === gid))
      .sort((a, b) => String(b.mapping.lastRosterChange?.at || "").localeCompare(String(a.mapping.lastRosterChange?.at || "")))[0];

    if (recentRemoval) return recentRemoval.classId;

    // Next-best signal: participation history already exists for this stable
    // Google student ID in another period. This handles "new period refreshed first".
    const withHistory = Object.keys(data.classes || {}).find(classId =>
      classId !== targetId && classHasParticipationForGoogleStudent(data, classId, gid)
    );
    if (withHistory) return withHistory;

    return "";
  }

  function findLikelyTransferDestination(data, fromClassId, googleId) {
    const sourceId = String(fromClassId);
    const gid = String(googleId ?? "").trim();
    if (!gid) return "";

    // A refreshed destination already containing this Google ID is a strong
    // signal that the student moved there.
    return Object.entries(data.classroom.mappings || {})
      .find(([classId, mapping]) =>
        classId !== sourceId &&
        data.classes?.[classId]?.rosterSource === "googleClassroom" &&
        Array.isArray(mapping?.students) &&
        mapping.students.some(student => String(student.id) === gid)
      )?.[0] || "";
  }

  function transferParticipationHistory(data, fromClassId, toClassId, googleId, displayName) {
    const fromId = String(fromClassId);
    const toId = String(toClassId);
    const stableId = googleStudentId(googleId);
    const name = normalizeStudentName(displayName);
    let termsMoved = 0;

    if (!stableId || !data.classes?.[fromId] || !data.classes?.[toId] || fromId === toId) {
      return 0;
    }

    PARTICIPATION_TERMS.forEach(definition => {
      const term = data.participation.terms?.[definition.id];
      if (!term) return;

      const sourceScores = term.scores?.[fromId];
      const destinationScores = term.scores?.[toId];
      const sourceRecord = sourceScores?.[stableId];
      if (!sourceRecord || !destinationScores) return;

      const destinationRecord = destinationScores[stableId];
      const sourcePoints = clampPoints(sourceRecord.points);
      const destinationPoints = clampPoints(destinationRecord?.points);
      const combinedPoints = sourcePoints + destinationPoints;

      if (combinedPoints > 0) {
        destinationScores[stableId] = {
          studentId: stableId,
          name: name || normalizeStudentName(destinationRecord?.name ?? sourceRecord.name),
          points: combinedPoints,
          updatedAt: new Date().toISOString()
        };
      } else {
        delete destinationScores[stableId];
      }

      delete sourceScores[stableId];
      termsMoved += 1;
    });

    return termsMoved;
  }

  function replaceRecentRemovalWithMove(data, move) {
    const sourceMapping = data.classroom.mappings?.[String(move.fromClassId)];
    const change = sourceMapping?.lastRosterChange;
    if (!change || !Array.isArray(change.removed)) return;

    const hadRemoval = change.removed.some(student => String(student.id) === String(move.id));
    if (!hadRemoval) return;

    change.removed = change.removed.filter(student => String(student.id) !== String(move.id));
    change.moved = Array.isArray(change.moved) ? change.moved : [];

    if (!change.moved.some(item =>
      String(item.id) === String(move.id) &&
      String(item.fromClassId) === String(move.fromClassId) &&
      String(item.toClassId) === String(move.toClassId)
    )) {
      change.moved.push({ ...move });
    }
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

    if (Object.prototype.hasOwnProperty.call(updates, "rosterSource")) {
      const source = String(updates.rosterSource ?? "manual");
      if (!["manual", "googleClassroom"].includes(source)) {
        throw new Error(`Unknown roster source: ${source}`);
      }
      data.classes[id].rosterSource = source;

      // Switching back to Classroom immediately restores the last imported
      // Classroom roster, if one is already available. A fresh Refresh Roster
      // can then update it from Google.
      if (source === "googleClassroom") {
        const mapping = data.classroom.mappings[id];
        if (mapping?.courseId && Array.isArray(mapping.students) && mapping.students.length) {
          const now = new Date().toISOString();
          data.classes[id].studentRecords = mapping.students.map(student => ({
            id: googleStudentId(student.id),
            name: normalizeStudentName(student.name),
            source: "googleClassroom",
            googleId: String(student.id ?? "").trim(),
            courseId: String(mapping.courseId ?? "").trim(),
            createdAt: now
          })).filter(student => student.id && student.name);
          data.classes[id].students = normalizeStudents(
            data.classes[id].studentRecords.map(student => student.name)
          );
          reconcileParticipationToCurrentRoster(data, id);
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "students")) {
      applyManualRosterToData(data, id, updates.students);
      reconcileParticipationToCurrentRoster(data, id);
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

  function getRosterSource(classId) {
    return getClass(classId)?.rosterSource ?? "manual";
  }

  function setRosterSource(classId, source) {
    return updateClass(classId, { rosterSource: source });
  }

  function getStudents(classId) {
    const id = String(classId);
    return clone(load().classes[id]?.studentRecords ?? []);
  }

  function getStudent(classId, studentRef) {
    const id = String(classId);
    const data = load();
    return clone(resolveStudentFromData(data, id, studentRef));
  }

  function saveRoster(classId, students) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    data.classes[id].rosterSource = "manual";
    applyManualRosterToData(data, id, students);
    reconcileParticipationToCurrentRoster(data, id);

    return save(data, {
      type: "roster-updated",
      classId: id
    });
  }

  function getClassroomMappings() {
    return clone(load().classroom.mappings);
  }

  function getClassroomMapping(classId) {
    const id = String(classId);
    return clone(load().classroom.mappings[id] ?? null);
  }

  function setClassroomMapping(classId, course = null) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    const previous = data.classroom.mappings[id] ?? createDefaultClassroom().mappings[id];
    const courseId = String(course?.id ?? course?.courseId ?? "").trim();

    if (!courseId) {
      data.classroom.mappings[id] = {
        courseId: "",
        courseName: "",
        section: "",
        lastImportedAt: "",
        lastRosterChange: {
          added: [],
          removed: [],
          renamed: [],
          moved: [],
          initialImport: false,
          at: ""
        },
        students: []
      };
    } else {
      const sameCourse = previous.courseId === courseId;
      if (!sameCourse && data.classes[id].rosterSource === "googleClassroom") {
        // Do not leave the previous Classroom's students visible while a new
        // course is waiting for its first roster refresh. Participation history
        // remains stored separately and will reconcile when the new roster loads.
        data.classes[id].studentRecords = [];
        data.classes[id].students = [];
      }
      data.classroom.mappings[id] = {
        courseId,
        courseName: String(course?.name ?? course?.courseName ?? previous.courseName ?? "").trim(),
        section: String(course?.section ?? previous.section ?? "").trim(),
        lastImportedAt: sameCourse ? previous.lastImportedAt : "",
        lastRosterChange: sameCourse
          ? previous.lastRosterChange || { added: [], removed: [], renamed: [], moved: [], initialImport: false, at: "" }
          : { added: [], removed: [], renamed: [], moved: [], initialImport: false, at: "" },
        students: sameCourse ? previous.students : []
      };
    }

    return save(data, {
      type: "classroom-mapping-changed",
      classId: id,
      courseId
    });
  }

  function getClassroomStudents(classId) {
    return getClassroomMapping(classId)?.students ?? [];
  }

  function saveClassroomRoster(classId, course, students) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    const courseId = String(course?.id ?? course?.courseId ?? "").trim();
    if (!courseId) {
      throw new Error("Google Classroom course ID is required.");
    }

    const seenIds = new Set();
    const normalizedStudents = [];

    (Array.isArray(students) ? students : []).forEach(student => {
      const normalized = normalizeClassroomStudent(student, courseId);
      if (!normalized || seenIds.has(normalized.id)) return;
      seenIds.add(normalized.id);
      normalizedStudents.push(normalized);
    });

    const previousMapping = data.classroom.mappings[id] || createDefaultClassroom().mappings[id];
    const previousStudents = previousMapping.courseId === courseId && Array.isArray(previousMapping.students)
      ? previousMapping.students
      : [];
    const previousById = new Map(previousStudents.map(student => [student.id, student]));
    const nextById = new Map(normalizedStudents.map(student => [student.id, student]));

    let added = normalizedStudents
      .filter(student => !previousById.has(student.id))
      .map(student => ({ id: student.id, name: student.name }));
    let removed = previousStudents
      .filter(student => !nextById.has(student.id))
      .map(student => ({ id: student.id, name: student.name }));
    const renamed = normalizedStudents
      .filter(student => {
        const previous = previousById.get(student.id);
        return previous && normalizeStudentName(previous.name) !== normalizeStudentName(student.name);
      })
      .map(student => ({
        id: student.id,
        from: normalizeStudentName(previousById.get(student.id)?.name),
        to: student.name
      }));

    const moved = [];
    const movedIds = new Set();

    // If a student appears in this newly refreshed roster after having
    // participation history (or a recent removal) in another Classroom-backed
    // period, treat the change as a period transfer and move every term's
    // participation record to the new class.
    added.forEach(student => {
      const fromClassId = findLikelyTransferSource(data, id, student.id);
      if (!fromClassId) return;

      const termsMoved = transferParticipationHistory(
        data,
        fromClassId,
        id,
        student.id,
        student.name
      );

      const move = {
        id: student.id,
        name: student.name,
        fromClassId,
        toClassId: id,
        termsMoved
      };
      moved.push(move);
      movedIds.add(student.id);
      replaceRecentRemovalWithMove(data, move);
    });

    // If this refreshed roster removes a student who is already present in a
    // different refreshed Classroom period, recognize the move from the other
    // direction. This handles refresh order either way.
    removed.forEach(student => {
      if (movedIds.has(student.id)) return;
      const toClassId = findLikelyTransferDestination(data, id, student.id);
      if (!toClassId) return;

      const destinationStudent = data.classroom.mappings?.[toClassId]?.students
        ?.find(item => String(item.id) === String(student.id));
      const displayName = normalizeStudentName(destinationStudent?.name ?? student.name);
      const termsMoved = transferParticipationHistory(
        data,
        id,
        toClassId,
        student.id,
        displayName
      );

      moved.push({
        id: student.id,
        name: displayName,
        fromClassId: id,
        toClassId,
        termsMoved
      });
      movedIds.add(student.id);
    });

    added = added.filter(student => !movedIds.has(student.id));
    removed = removed.filter(student => !movedIds.has(student.id));

    const now = new Date().toISOString();
    const initialImport = previousMapping.courseId !== courseId || !previousMapping.lastImportedAt;
    data.classes[id].rosterSource = "googleClassroom";
    data.classroom.mappings[id] = {
      courseId,
      courseName: String(course?.name ?? course?.courseName ?? "").trim(),
      section: String(course?.section ?? "").trim(),
      lastImportedAt: now,
      lastRosterChange: { added, removed, renamed, moved, initialImport, at: now },
      students: normalizedStudents
    };

    // Preserve stable IDs in the shared student-record layer while updating display names.
    const existingById = new Map((data.classes[id].studentRecords || []).map(student => [student.id, student]));
    data.classes[id].studentRecords = normalizedStudents.map(student => {
      const stableId = `google:${student.id}`;
      const previous = existingById.get(stableId);
      return {
        id: stableId,
        name: student.name,
        source: "googleClassroom",
        googleId: student.id,
        courseId,
        createdAt: previous?.createdAt || now
      };
    });
    data.classes[id].students = normalizeStudents(normalizedStudents.map(student => student.name));

    const saved = save(data, {
      type: "classroom-roster-imported",
      classId: id,
      courseId,
      studentCount: normalizedStudents.length,
      rosterChanges: {
        addedCount: added.length,
        removedCount: removed.length,
        renamedCount: renamed.length,
        movedCount: moved.length
      }
    });

    return {
      data: saved,
      changes: clone(data.classroom.mappings[id].lastRosterChange)
    };
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
    studentRef,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();
    const student = resolveStudentFromData(data, classKey, studentRef);

    if (!student?.id) return 0;

    return clampPoints(
      data.participation
        .terms[termKey]
        ?.scores?.[classKey]
        ?.[student.id]
        ?.points
    );
  }

  function setParticipationPoints(
    classId,
    studentRef,
    points,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();

    if (!data.classes[classKey]) {
      throw new Error(`Unknown class id: ${classKey}`);
    }

    if (!data.participation.terms[termKey]) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    const student = resolveStudentFromData(data, classKey, studentRef);
    if (!student?.id || !student?.name) {
      throw new Error("Student identity is required.");
    }

    const nextPoints = clampPoints(points);
    const classScores = data.participation.terms[termKey].scores[classKey];

    if (nextPoints === 0) {
      delete classScores[student.id];
    } else {
      classScores[student.id] = {
        studentId: student.id,
        name: student.name,
        points: nextPoints,
        updatedAt: new Date().toISOString()
      };
    }

    save(data, {
      type: "participation-points-changed",
      classId: classKey,
      termId: termKey,
      studentId: student.id,
      studentName: student.name,
      points: nextPoints
    });

    return nextPoints;
  }

  function adjustParticipationPoints(
    classId,
    studentRef,
    delta = 1,
    termId = getActiveParticipationTermId()
  ) {
    const previous = getParticipationPoints(classId, studentRef, termId);
    return setParticipationPoints(
      classId,
      studentRef,
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
    const roster = data.classes[id]?.studentRecords ?? [];
    const term = data.participation.terms[termKey];

    if (!term) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    return roster.map(student => {
      const points = clampPoints(term.scores[id]?.[student.id]?.points);
      return {
        id: student.id,
        name: student.name,
        source: student.source,
        googleId: student.googleId || "",
        courseId: student.courseId || "",
        points,
        goal: term.goal,
        complete: points >= term.goal
      };
    });
  }


  function getParticipationGradeSync(
    termId = getActiveParticipationTermId()
  ) {
    const termKey = String(termId);
    const data = load();
    const settings = data.participationGradeSync?.terms?.[termKey];

    if (!settings) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    return clone(settings);
  }

  function setParticipationGradeSyncSettings(termId, updates = {}) {
    const termKey = String(termId);
    const data = load();
    const settings = data.participationGradeSync?.terms?.[termKey];

    if (!settings) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "title")) {
      const title = String(updates.title ?? "").trim();
      if (!title) throw new Error("Participation assignment title is required.");
      settings.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "instructions")) {
      const instructions = String(updates.instructions ?? "").trim();
      if (!instructions) throw new Error("Participation assignment instructions are required.");
      if (instructions.length > 30000) {
        throw new Error("Participation assignment instructions are too long.");
      }
      settings.instructions = instructions;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "assignmentPoints")) {
      const points = Math.floor(Number(updates.assignmentPoints) || 0);
      if (points < 1 || points > 1000) {
        throw new Error("Classroom assignment points must be between 1 and 1000.");
      }
      settings.assignmentPoints = points;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "roundWhole")) {
      settings.roundWhole = Boolean(updates.roundWhole);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "publishAssignments")) {
      settings.publishAssignments = Boolean(updates.publishAssignments);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "topicName")) {
      settings.topicName = String(updates.topicName ?? "").trim();
    }

    if (Object.prototype.hasOwnProperty.call(updates, "dueDate")) {
      const rawDate = String(updates.dueDate ?? "").trim();
      if (rawDate && !normalizeDateKey(rawDate)) {
        throw new Error("Choose a valid Classroom due date.");
      }
      settings.dueDate = normalizeDateKey(rawDate);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "dueTime")) {
      const rawTime = String(updates.dueTime ?? "").trim();
      if (rawTime && !/^\d{2}:\d{2}$/.test(rawTime)) {
        throw new Error("Choose a valid Classroom due time.");
      }
      settings.dueTime = rawTime || "23:59";
    }

    if (settings.dueDate && !settings.dueTime) {
      throw new Error("Choose a due time when a due date is set.");
    }

    return save(data, {
      type: "participation-grade-sync-settings-changed",
      termId: termKey
    });
  }

  function getParticipationGradeAssignment(
    classId,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();
    const assignment = data.participationGradeSync?.terms?.[termKey]?.assignments?.[classKey] ?? null;
    return clone(assignment);
  }

  function setParticipationGradeAssignment(
    classId,
    assignment,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();

    if (!data.classes[classKey]) {
      throw new Error(`Unknown class id: ${classKey}`);
    }

    const termSettings = data.participationGradeSync?.terms?.[termKey];
    if (!termSettings) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    const normalized = normalizeParticipationGradeAssignment(assignment);
    if (!normalized) {
      delete termSettings.assignments[classKey];
    } else {
      const previous = termSettings.assignments[classKey];
      termSettings.assignments[classKey] = {
        ...normalized,
        lastSyncedAt: normalized.lastSyncedAt || previous?.lastSyncedAt || "",
        lastSyncSummary: normalized.lastSyncSummary?.at
          ? normalized.lastSyncSummary
          : previous?.lastSyncSummary || normalized.lastSyncSummary
      };
    }

    return save(data, {
      type: "participation-grade-assignment-changed",
      classId: classKey,
      termId: termKey,
      courseWorkId: normalized?.courseWorkId || ""
    });
  }

  function markParticipationGradeSynced(
    classId,
    termId = getActiveParticipationTermId(),
    summaryOrSyncedAt = new Date().toISOString()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();
    const assignment = data.participationGradeSync?.terms?.[termKey]?.assignments?.[classKey];

    if (!assignment) {
      throw new Error("Create the participation Classroom assignment before syncing grades.");
    }

    const isSummary = summaryOrSyncedAt && typeof summaryOrSyncedAt === "object";
    const syncedAt = isSummary
      ? String(summaryOrSyncedAt.at || new Date().toISOString())
      : String(summaryOrSyncedAt || new Date().toISOString());

    assignment.lastSyncedAt = syncedAt;
    assignment.lastSyncSummary = {
      syncedCount: isSummary ? Math.max(0, Math.floor(Number(summaryOrSyncedAt.syncedCount) || 0)) : 0,
      missingSubmissionCount: isSummary ? Math.max(0, Math.floor(Number(summaryOrSyncedAt.missingSubmissionCount) || 0)) : 0,
      failedCount: isSummary ? Math.max(0, Math.floor(Number(summaryOrSyncedAt.failedCount) || 0)) : 0,
      at: syncedAt
    };

    return save(data, {
      type: "participation-grades-synced",
      classId: classKey,
      termId: termKey,
      syncedAt,
      syncSummary: clone(assignment.lastSyncSummary)
    });
  }

  function calculateParticipationClassroomGrade(
    points,
    goal,
    assignmentPoints,
    roundWhole = true
  ) {
    const earned = Math.max(0, Number(points) || 0);
    const target = Math.max(1, Number(goal) || 1);
    const maximum = Math.max(1, Number(assignmentPoints) || 1);
    const scaled = Math.min(earned / target, 1) * maximum;
    const grade = roundWhole ? Math.round(scaled) : Math.round(scaled * 100) / 100;
    return Math.min(maximum, Math.max(0, grade));
  }

  function getParticipationGradePreview(
    classId,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const data = load();
    const term = data.participation.terms[termKey];
    const settings = data.participationGradeSync?.terms?.[termKey];
    const roster = data.classes[classKey]?.studentRecords ?? [];

    if (!term || !settings) {
      throw new Error(`Unknown participation term: ${termKey}`);
    }

    return roster.map(student => {
      const participationPoints = clampPoints(term.scores[classKey]?.[student.id]?.points);
      return {
        id: student.id,
        name: student.name,
        googleId: student.googleId || "",
        source: student.source || "local",
        participationPoints,
        participationGoal: term.goal,
        classroomGrade: calculateParticipationClassroomGrade(
          participationPoints,
          term.goal,
          settings.assignmentPoints,
          settings.roundWhole
        ),
        assignmentPoints: settings.assignmentPoints,
        eligible: Boolean(student.googleId)
      };
    });
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

    // Class reminders belong to the current roster/school year.
    localStorage.removeItem(
      SCHOOL_YEAR_APP_KEYS.reminders
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
        "class-reminders",
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
          "class-reminders",
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
      getRosterSource,
      setRosterSource,
      getStudents,
      getStudent,
      saveRoster,

      getClassroomMappings,
      getClassroomMapping,
      setClassroomMapping,
      getClassroomStudents,
      saveClassroomRoster,

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

      getParticipationGradeSync,
      setParticipationGradeSyncSettings,
      getParticipationGradeAssignment,
      setParticipationGradeAssignment,
      markParticipationGradeSynced,
      calculateParticipationClassroomGrade,
      getParticipationGradePreview,

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

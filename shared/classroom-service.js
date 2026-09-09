(() => {
  "use strict";

  const CLIENT_ID_KEY = "teacherDashboard.classroomOAuthClientId.v1";
  // v2 intentionally forces a fresh consent prompt because Milestone 3 adds
  // the Classroom coursework/grade-management scope.
  const CONSENT_KEY = "teacherDashboard.classroomConsentGranted.v2";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const CLASSROOM_API = "https://classroom.googleapis.com/v1";
  const SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students"
  ].join(" ");

  let accessToken = "";
  let expiresAt = 0;
  let gisLoadPromise = null;

  function normalizeClientId(value) {
    return String(value ?? "").trim();
  }

  function getClientId() {
    return normalizeClientId(localStorage.getItem(CLIENT_ID_KEY));
  }

  function setClientId(value) {
    const clientId = normalizeClientId(value);
    const previousClientId = getClientId();

    if (!clientId) {
      localStorage.removeItem(CLIENT_ID_KEY);
      clearSession();
      return "";
    }

    if (!/\.apps\.googleusercontent\.com$/i.test(clientId)) {
      throw new Error("Enter a valid Google OAuth Web Client ID ending in .apps.googleusercontent.com.");
    }

    localStorage.setItem(CLIENT_ID_KEY, clientId);
    if (previousClientId && previousClientId !== clientId) {
      localStorage.removeItem(CONSENT_KEY);
    }
    clearSession();
    return clientId;
  }

  function clearSession() {
    accessToken = "";
    expiresAt = 0;
  }

  function isConnected() {
    return Boolean(accessToken && Date.now() < expiresAt - 60_000);
  }

  function ensureGoogleIdentityLibrary() {
    if (window.google?.accounts?.oauth2) {
      return Promise.resolve();
    }

    if (gisLoadPromise) return gisLoadPromise;

    gisLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SRC}"]`);

      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Google Identity Services could not be loaded.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Identity Services could not be loaded."));
      document.head.appendChild(script);
    });

    return gisLoadPromise;
  }

  async function connect(options = {}) {
    const clientId = getClientId();

    if (!clientId) {
      throw new Error("Save your Google OAuth Web Client ID first.");
    }

    if (isConnected() && !options.force) {
      return { connected: true };
    }

    await ensureGoogleIdentityLibrary();

    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: response => {
          if (response?.error) {
            clearSession();
            reject(new Error(response.error_description || response.error || "Google Classroom authorization failed."));
            return;
          }

          accessToken = String(response?.access_token ?? "");
          const expiresIn = Math.max(60, Number(response?.expires_in) || 3600);
          expiresAt = Date.now() + expiresIn * 1000;

          if (!accessToken) {
            reject(new Error("Google did not return an access token."));
            return;
          }

          localStorage.setItem(CONSENT_KEY, "true");
          resolve({ connected: true, expiresAt });
        },
        error_callback: error => {
          clearSession();
          reject(new Error(error?.message || error?.type || "Google Classroom authorization was canceled."));
        }
      });

      const hasGrantedConsent = localStorage.getItem(CONSENT_KEY) === "true";
      tokenClient.requestAccessToken({
        prompt: hasGrantedConsent ? "" : "consent"
      });
    });
  }

  async function apiRequest(path, options = {}) {
    if (!isConnected()) {
      throw new Error("Connect Google Classroom before using Classroom data.");
    }

    const method = String(options.method || "GET").toUpperCase();
    const params = options.params && typeof options.params === "object" ? options.params : {};
    const url = new URL(`${CLASSROOM_API}${path}`);

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    const fetchOptions = { method, headers };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 401) {
      clearSession();
      throw new Error("Your Google Classroom session expired. Connect Classroom again.");
    }

    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      body = null;
    }

    if (!response.ok) {
      const message = body?.error?.message || `Google Classroom request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      error.details = body?.error || null;
      throw error;
    }

    return body || {};
  }

  async function apiFetch(path, params = {}) {
    return apiRequest(path, { method: "GET", params });
  }

  async function listCourses() {
    const courses = [];
    let pageToken = "";

    do {
      const page = await apiFetch("/courses", {
        teacherId: "me",
        courseStates: "ACTIVE",
        pageSize: 100,
        pageToken
      });

      for (const course of page.courses || []) {
        courses.push({
          id: String(course.id ?? ""),
          name: String(course.name ?? "").trim() || "Untitled Classroom",
          section: String(course.section ?? "").trim()
        });
      }

      pageToken = String(page.nextPageToken ?? "");
    } while (pageToken);

    return courses
      .filter(course => course.id)
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        return byName || a.section.localeCompare(b.section, undefined, { numeric: true, sensitivity: "base" });
      });
  }

  async function listStudents(courseId) {
    const id = String(courseId ?? "").trim();
    if (!id) throw new Error("A Google Classroom course ID is required.");

    const students = [];
    let pageToken = "";

    do {
      const page = await apiFetch(`/courses/${encodeURIComponent(id)}/students`, {
        pageSize: 100,
        pageToken
      });

      for (const student of page.students || []) {
        const studentId = String(student.userId ?? student.profile?.id ?? "").trim();
        const name = String(student.profile?.name?.fullName ?? "").trim().replace(/\s+/g, " ");

        if (!studentId || !name) continue;

        students.push({
          id: studentId,
          name,
          source: "googleClassroom",
          courseId: id
        });
      }

      pageToken = String(page.nextPageToken ?? "");
    } while (pageToken);

    const seen = new Set();
    return students.filter(student => {
      if (seen.has(student.id)) return false;
      seen.add(student.id);
      return true;
    });
  }

  async function createCourseWork(courseId, options = {}) {
    const id = String(courseId ?? "").trim();
    if (!id) throw new Error("A Google Classroom course ID is required.");

    const title = String(options.title ?? "").trim();
    const maxPoints = Math.max(1, Math.floor(Number(options.maxPoints) || 0));

    if (!title) throw new Error("An assignment title is required.");
    if (!maxPoints) throw new Error("Assignment points must be at least 1.");

    const requestedState = String(options.state ?? "DRAFT").toUpperCase();
    const state = requestedState === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

    return apiRequest(`/courses/${encodeURIComponent(id)}/courseWork`, {
      method: "POST",
      body: {
        title,
        description: String(options.description ?? "").trim(),
        workType: "ASSIGNMENT",
        state,
        maxPoints
      }
    });
  }

  async function getCourseWork(courseId, courseWorkId) {
    const course = String(courseId ?? "").trim();
    const work = String(courseWorkId ?? "").trim();
    if (!course || !work) throw new Error("Course and assignment IDs are required.");

    return apiFetch(`/courses/${encodeURIComponent(course)}/courseWork/${encodeURIComponent(work)}`);
  }

  async function updateCourseWork(courseId, courseWorkId, updates = {}) {
    const course = String(courseId ?? "").trim();
    const work = String(courseWorkId ?? "").trim();
    if (!course || !work) throw new Error("Course and assignment IDs are required.");

    const body = {};
    const mask = [];

    if (Object.prototype.hasOwnProperty.call(updates, "title")) {
      body.title = String(updates.title ?? "").trim();
      if (!body.title) throw new Error("An assignment title is required.");
      mask.push("title");
    }

    if (Object.prototype.hasOwnProperty.call(updates, "maxPoints")) {
      body.maxPoints = Math.max(1, Math.floor(Number(updates.maxPoints) || 0));
      if (!body.maxPoints) throw new Error("Assignment points must be at least 1.");
      mask.push("maxPoints");
    }

    if (Object.prototype.hasOwnProperty.call(updates, "state")) {
      const requestedState = String(updates.state ?? "").toUpperCase();
      if (!["DRAFT", "PUBLISHED"].includes(requestedState)) {
        throw new Error("Assignment state must be DRAFT or PUBLISHED.");
      }
      body.state = requestedState;
      mask.push("state");
    }

    if (!mask.length) return getCourseWork(course, work);

    return apiRequest(`/courses/${encodeURIComponent(course)}/courseWork/${encodeURIComponent(work)}`, {
      method: "PATCH",
      params: { updateMask: mask.join(",") },
      body
    });
  }

  async function listStudentSubmissions(courseId, courseWorkId) {
    const course = String(courseId ?? "").trim();
    const work = String(courseWorkId ?? "").trim();
    if (!course || !work) throw new Error("Course and assignment IDs are required.");

    const submissions = [];
    let pageToken = "";

    do {
      const page = await apiFetch(
        `/courses/${encodeURIComponent(course)}/courseWork/${encodeURIComponent(work)}/studentSubmissions`,
        { pageSize: 100, pageToken }
      );

      for (const submission of page.studentSubmissions || []) {
        const id = String(submission.id ?? "").trim();
        const userId = String(submission.userId ?? "").trim();
        if (!id || !userId) continue;
        submissions.push({
          id,
          userId,
          draftGrade: Number.isFinite(Number(submission.draftGrade)) ? Number(submission.draftGrade) : null,
          assignedGrade: Number.isFinite(Number(submission.assignedGrade)) ? Number(submission.assignedGrade) : null,
          state: String(submission.state ?? "")
        });
      }

      pageToken = String(page.nextPageToken ?? "");
    } while (pageToken);

    return submissions;
  }

  async function setDraftGrade(courseId, courseWorkId, submissionId, grade) {
    const course = String(courseId ?? "").trim();
    const work = String(courseWorkId ?? "").trim();
    const submission = String(submissionId ?? "").trim();
    const numericGrade = Number(grade);

    if (!course || !work || !submission) {
      throw new Error("Course, assignment, and submission IDs are required.");
    }
    if (!Number.isFinite(numericGrade) || numericGrade < 0) {
      throw new Error("Draft grade must be a non-negative number.");
    }

    return apiRequest(
      `/courses/${encodeURIComponent(course)}/courseWork/${encodeURIComponent(work)}/studentSubmissions/${encodeURIComponent(submission)}`,
      {
        method: "PATCH",
        params: { updateMask: "draftGrade" },
        body: { draftGrade: numericGrade }
      }
    );
  }

  window.ClassroomService = Object.freeze({
    scopes: SCOPES,
    getClientId,
    setClientId,
    clearSession,
    isConnected,
    connect,
    listCourses,
    listStudents,
    createCourseWork,
    getCourseWork,
    updateCourseWork,
    listStudentSubmissions,
    setDraftGrade
  });
})();

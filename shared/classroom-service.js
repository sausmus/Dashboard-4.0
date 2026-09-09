(() => {
  "use strict";

  const CLIENT_ID_KEY = "teacherDashboard.classroomOAuthClientId.v1";
  const CONSENT_KEY = "teacherDashboard.classroomConsentGranted.v1";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const CLASSROOM_API = "https://classroom.googleapis.com/v1";
  const SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly"
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

  async function apiFetch(path, params = {}) {
    if (!isConnected()) {
      throw new Error("Connect Google Classroom before loading Classroom data.");
    }

    const url = new URL(`${CLASSROOM_API}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

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
      const message =
        body?.error?.message ||
        `Google Classroom request failed (${response.status}).`;
      throw new Error(message);
    }

    return body || {};
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

  window.ClassroomService = Object.freeze({
    scopes: SCOPES,
    getClientId,
    setClientId,
    clearSession,
    isConnected,
    connect,
    listCourses,
    listStudents
  });
})();

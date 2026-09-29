(function (global) {
  "use strict";

  const BACKUP_FORMAT = "teacher-dashboard-localstorage-backup";
  const BACKUP_VERSION = 1;

  function getStorage() {
    return global.localStorage;
  }

  function collectEntries() {
    const storage = getStorage();
    const entries = {};
    const keys = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }

    keys.sort().forEach(key => {
      const value = storage.getItem(key);
      if (value !== null) entries[key] = value;
    });

    return entries;
  }

  function createSnapshot() {
    const entries = collectEntries();
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      origin: global.location && global.location.origin ? global.location.origin : "",
      entryCount: Object.keys(entries).length,
      entries
    };
  }

  function byteSize(snapshot) {
    return new Blob([JSON.stringify(snapshot)]).size;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function fileTimestamp(date = new Date()) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + "_" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
  }

  function downloadSnapshot(snapshot, options = {}) {
    const prefix = String(options.prefix || "teacher-dashboard-backup").replace(/[^a-z0-9-_]+/gi, "-");
    const filename = `${prefix}-${fileTimestamp()}.json`;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("This file is not a Teacher Dashboard backup.");
    }
    if (snapshot.format !== BACKUP_FORMAT) {
      throw new Error("This file is not a Teacher Dashboard device-data backup.");
    }
    if (snapshot.version !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${snapshot.version}.`);
    }
    if (!snapshot.entries || typeof snapshot.entries !== "object" || Array.isArray(snapshot.entries)) {
      throw new Error("The backup does not contain a valid localStorage snapshot.");
    }

    const entries = {};
    Object.entries(snapshot.entries).forEach(([key, value]) => {
      if (!key) throw new Error("The backup contains an invalid empty storage key.");
      if (typeof value !== "string") {
        throw new Error(`The backup value for ${key} is invalid.`);
      }
      entries[key] = value;
    });

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: typeof snapshot.createdAt === "string" ? snapshot.createdAt : "",
      origin: typeof snapshot.origin === "string" ? snapshot.origin : "",
      entryCount: Object.keys(entries).length,
      entries
    };
  }

  async function readBackupFile(file) {
    if (!file) throw new Error("Choose a backup file first.");
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("The selected file is not valid JSON.");
    }
    return validateSnapshot(parsed);
  }

  function restoreSnapshot(snapshot) {
    const validated = validateSnapshot(snapshot);
    const storage = getStorage();
    const previousValues = new Map();
    const changedKeys = [];

    Object.keys(validated.entries).forEach(key => {
      previousValues.set(key, storage.getItem(key));
    });

    try {
      Object.entries(validated.entries).forEach(([key, value]) => {
        storage.setItem(key, value);
        changedKeys.push(key);
      });
    } catch (error) {
      for (let index = changedKeys.length - 1; index >= 0; index -= 1) {
        const key = changedKeys[index];
        const previousValue = previousValues.get(key);
        if (previousValue === null) storage.removeItem(key);
        else storage.setItem(key, previousValue);
      }
      throw new Error(`Restore could not be completed, so the Dashboard rolled back to the data that was on this device before the restore. ${error && error.message ? error.message : ""}`.trim());
    }

    return {
      restoredKeys: Object.keys(validated.entries).length,
      preservedKeys: Math.max(0, storage.length - Object.keys(validated.entries).length)
    };
  }

  function getDeviceSummary() {
    const snapshot = createSnapshot();
    return {
      entryCount: snapshot.entryCount,
      bytes: byteSize(snapshot)
    };
  }

  global.DashboardBackup = Object.freeze({
    BACKUP_FORMAT,
    BACKUP_VERSION,
    createSnapshot,
    downloadSnapshot,
    getDeviceSummary,
    readBackupFile,
    restoreSnapshot,
    validateSnapshot,
    byteSize
  });
})(window);

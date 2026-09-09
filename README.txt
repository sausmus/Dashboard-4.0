Teacher Dashboard 4.0 — Google Classroom Roster Sync (Milestone 1)

BASE
- Built directly from the attached local-only Dashboard 2.0 codebase.
- No Dashboard 3.0 code was used.
- No Google Drive API, Drive folder, cloud-sync layer, or migration layer is included.

WHAT THIS MILESTONE ADDS
- Google Classroom connection inside Dashboard Settings.
- Mapping from each Dashboard Period/Class to an active Google Classroom course.
- Import All Mapped Rosters.
- Refresh Roster for an individual mapped class.
- Google Classroom student IDs retained alongside student names.
- Last-import timestamp and imported student count for each mapped class.
- Existing Student Picker and Participation Tracker remain compatible because
  imported Classroom names are also written into the existing master roster.

FILES CHANGED / ADDED
- settings.html
- shared/dashboard-data.js
- shared/classroom-service.js   (new)
- GOOGLE-CLASSROOM-SETUP.txt    (new)

IMPORTANT
Google Classroom OAuth is separate from Dashboard cloud sync. The Classroom
access token exists only in the current Settings page session. Course mappings,
imported roster metadata, and the existing Dashboard data use the browser
storage already present in Dashboard 2.0.

NEXT DEVELOPMENT MILESTONE
Once course mapping and roster imports are verified with real Classroom data,
Student Picker and Participation Tracker can be upgraded to use the stable
Google student IDs natively. That is the prerequisite for reliable future
Participation -> Google Classroom grade syncing.

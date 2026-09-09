Dashboard 2.0 — Automatic Current Period Update

Replace these files in your Dashboard 2.0 GitHub repository:

  agenda.html
  scoreboard.html
  settings.html
  shared/bell-service.js

No changes are required to index.html, bell-countdown.html, student-picker.html,
participation-tracker.html, or shared/dashboard-data.js for this update.

WHAT CHANGED
- Class-based utilities now automatically follow the active teaching period
  from the shared bell schedule when a utility opens and when the bell period
  changes.
- Hidden periods/preps do not become the active class.
- Snack, Lunch, weekends, and other non-class bell entries leave the last
  active/manual class in place.
- Manual class selections inside a utility are respected until the real bell
  target changes.
- Bell Countdown manual period targeting does not force the student/class apps
  to jump; automatic class selection follows the actual clock.
- Dashboard Settings no longer shows a Current Class control. The shared
  currentClassId remains internal as the fallback/last-used class state.

After replacing the files, commit the changes and allow GitHub Pages to rebuild.

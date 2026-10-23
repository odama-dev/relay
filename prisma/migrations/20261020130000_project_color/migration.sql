-- A project's colour on the calendars (PM dashboard, Designer & Dev). Null:
-- picked from the project's id. No new table, so no new policy: the column
-- is written through projects_update (app.can_edit_project — the PM on
-- their projects, Sales, C-Level).
ALTER TABLE "projects" ADD COLUMN "calendar_color" "hr_event_color";

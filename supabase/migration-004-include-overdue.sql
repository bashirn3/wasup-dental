-- Per-garage control over whether the outbound agent also messages customers
-- whose MOT is already overdue (past their due date). Defaults to true so
-- existing garages keep their current behaviour (overdue customers are chased).
--
-- Safe to run multiple times.

alter table tenant_settings
  add column if not exists include_overdue boolean not null default true;

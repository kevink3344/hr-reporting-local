-- =====================================================================
-- HR Reporting — Feature Flags  [MySQL / MariaDB]
-- ---------------------------------------------------------------------
-- Admin-controlled feature toggles. Keys are lowercase snake_case.
-- The "future_positions" flag gates the Future Positions feature.
-- Mirrors docs/data/turso/feature-flags.sql for the production DB.
-- =====================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  feature_key    VARCHAR(64) PRIMARY KEY,
  enabled        TINYINT(1) NOT NULL DEFAULT 0,
  updated_by     VARCHAR(64) NULL,
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3)
);

INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('future_positions', 0);
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('ai_assistant', 0);
-- Sub-feature of future_positions: employee auto-lookup. Ships OFF so enabling
-- the Future Positions beta does not implicitly enable lookup.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('employee_auto_lookup', 0);
-- Style Configuration: admin-authored CSS styles staff can apply. Ships OFF.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('style_configuration', 0);
-- KPI Dashboard: an OPT-OUT flag. Ships ON because the dashboard is
-- already live; GET /api/feature-flags also reports 1 when this row is absent,
-- so an unseeded database never hides the page. Set to 0 to hide the nav link.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('kpi_dashboard', 1);
-- System-wide messages (Splash / Banner announcements): a second OPT-OUT flag.
-- The manager is already in use, so it ships ON, and an absent row also reads
-- as 1. Set to 0 to hide the manager and stop showing published messages.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('system_messages', 1);
-- System Information: an OPT-IN admin diagnostic that compares the nightly
-- loader log with the live row counts. Ships OFF because it is a beta; an
-- absent row reads as 0. Reachable only from the Features page.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('system_info', 0);
-- Advanced Search: an OPT-IN structured position search. Ships OFF until an
-- admin turns it on, so an absent row reads as 0 and the nav entry stays
-- hidden. Turning it off hides the page without removing the routes.
INSERT IGNORE INTO feature_flags (feature_key, enabled) VALUES ('advanced_search', 0);

/**
 * apply-style-themes-mysql.mts
 *
 * Creates the `style_themes` table (Style Configuration) in the live MySQL
 * `reporting` database and seeds the `style_configuration` feature flag.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE.
 * Run: npx tsx scripts/apply-style-themes-mysql.mts
 */
import { query, getPool } from '../src/db.js';

const CREATE_STYLE_THEMES = `
CREATE TABLE IF NOT EXISTS style_themes (
  id               VARCHAR(64) PRIMARY KEY,
  name             VARCHAR(128) NOT NULL,
  description      VARCHAR(255) NULL,
  main_font        VARCHAR(255) NOT NULL,
  mono_font        VARCHAR(255) NOT NULL,
  primary_color    VARCHAR(32) NOT NULL,
  accent_color     VARCHAR(32) NOT NULL,
  background_color VARCHAR(32) NOT NULL,
  text_color       VARCHAR(32) NOT NULL,
  is_default       TINYINT(1) NOT NULL DEFAULT 0,
  created_by       VARCHAR(64) NULL,
  created_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL
)`;

async function main(): Promise<void> {
  console.log('Creating style_themes table...');
  await query(CREATE_STYLE_THEMES);
  console.log('  ok');

  console.log('Seeding style_configuration feature flag (off by default)...');
  await query(
    `INSERT INTO feature_flags (feature_key, enabled) VALUES ('style_configuration', 0)
     ON DUPLICATE KEY UPDATE feature_key = feature_key`
  );
  console.log('  ok');

  const flags = await query<{ feature_key: string; enabled: number }>(
    "SELECT feature_key, enabled FROM feature_flags WHERE feature_key IN ('style_configuration','future_positions','ai_assistant','employee_auto_lookup')"
  );
  console.log('Feature flags:', flags);

  const tables = await query<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'style_themes'"
  );
  console.log('style_themes exists:', tables[0]?.c === 1);

  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

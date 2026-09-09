import { query } from '../src/db.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Seed the MySQL `users` table from docs/data/users.json (idempotent via
// INSERT ... ON DUPLICATE KEY UPDATE). Connects as the app user (kkey2), which
// the DBA has now granted INSERT/UPDATE/DELETE on `reporting`.`users`.
//
// Run after the DBA grants write access:
//   npx tsx scripts/seed-mysql-users.mts

type SeedUser = {
  id: string;
  username: string;
  wakeId: string;
  employeeNumber: string;
  displayName: string;
  email: string;
  roles: string[];
  schoolIds: string[];
  canViewAllSchools: boolean;
};

async function main() {
  const users = JSON.parse(
    await readFile(resolve(process.cwd(), 'docs', 'data', 'users.json'), 'utf8')
  ) as SeedUser[];

  console.log(`Seeding ${users.length} users into reporting.users ...`);

  for (const u of users) {
    await query(
      `INSERT INTO users
         (id, username, wake_id, employee_number, display_name, email, roles, school_ids, can_view_all_schools)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         wake_id = VALUES(wake_id),
         employee_number = VALUES(employee_number),
         display_name = VALUES(display_name),
         email = VALUES(email),
         roles = VALUES(roles),
         school_ids = VALUES(school_ids),
         can_view_all_schools = VALUES(can_view_all_schools)`,
      [
        u.id,
        u.username,
        u.wakeId,
        u.employeeNumber,
        u.displayName,
        u.email,
        u.roles.join(','),
        u.schoolIds.join(','),
        u.canViewAllSchools ? 1 : 0
      ]
    );
    console.log(`  seeded ${u.id} (${u.username})`);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT id, username, wake_id, employee_number, display_name, roles, school_ids, can_view_all_schools
     FROM users ORDER BY id`
  );
  console.log('\n=== reporting.users now contains ===');
  for (const r of rows) console.log(JSON.stringify(r));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

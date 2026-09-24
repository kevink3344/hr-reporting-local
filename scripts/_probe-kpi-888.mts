import { query } from '../src/db.js';

const rows = await query<{ pos_number: string; pos_name: string; organization: string; pos_ending: string }>(
  `SELECT pos_number, pos_name, organization, pos_ending
     FROM position_info
    WHERE pos_number LIKE '888%'
      AND organization = 'Athens High School - 318'
    LIMIT 12`
);
console.log('888% rows at Athens:');
console.table(rows);

const [c] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM position_info WHERE pos_number LIKE '888%'`);
console.log('888% rows district-wide:', c?.n);

process.exit(0);

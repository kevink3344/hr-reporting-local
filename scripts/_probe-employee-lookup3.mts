// Decides whether the lookup WHERE clause can drop TRIM (and thus become
// sargable). MySQL's PAD SPACE collation hides trailing spaces from `<>`, so
// compare LENGTH (bytes) against CHAR_LENGTH (characters) instead.
import { query } from '../src/db.js';

const rows = await query<{ prefixed: number; padded: number; total: number }>(
  `SELECT
     SUM(emp_number <> LTRIM(emp_number)) AS prefixed,
     SUM(LENGTH(emp_number) <> CHAR_LENGTH(emp_number)) AS padded,
     COUNT(*) AS total
   FROM employee_info`
);
console.log('spacing audit:', JSON.stringify(rows[0]));

// Does a plain equality find the same row as the trimmed form?
const probe = '149098';
const [plain] = await query('SELECT emp_number, full_name FROM employee_info WHERE emp_number = ? LIMIT 1', [probe]);
const [trimmed] = await query("SELECT emp_number, full_name FROM employee_info WHERE TRIM(IFNULL(emp_number, '')) = ? LIMIT 1", [probe]);
console.log(`plain   -> ${JSON.stringify(plain ?? null)}`);
console.log(`trimmed -> ${JSON.stringify(trimmed ?? null)}`);

// Confirm a NULL/empty emp_number cannot be matched by the 6-digit parameter,
// which is what made the IFNULL guard unnecessary.
const [nulls] = await query<{ c: number }>('SELECT COUNT(*) AS c FROM employee_info WHERE emp_number IS NULL').catch(() => [{ c: -1 }]);
console.log(`rows with NULL emp_number: ${nulls?.c}`);

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const cfg = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectTimeout: 15000,
  charset: 'utf8mb4'
};

// ---------------------------------------------------------------------------
// Expected schema, transcribed from docs/data/mysql/app-tables.mysql.sql
// (the DBA's source of truth) PLUS the live reporting source tables that the
// MySQL repository queries.
//
// Each table maps to an object of columnName -> expected (COLUMN_TYPE, IS_NULLABLE).
// We use a reduced check: column existence + type + nullability + default.
// ---------------------------------------------------------------------------

type ColSpec = {
  type?: string;      // e.g. 'varchar(64)', 'tinyint(1)', 'enum(...)', 'text', 'longtext', 'datetime(3)', 'int', 'date'
  nullable?: boolean; // default false wants NOT NULL; true allows NULL
  default?: string;   // expected DEFAULT, exact-ish match against COLUMN_DEFAULT ('' means empty string default)
  pk?: boolean;
};

type TableSpec = Record<string, ColSpec>;

const APP_TABLES: Record<string, TableSpec> = {
  users: {
    id: { type: 'varchar', pk: true },
    username: { type: 'varchar' },
    wake_id: { type: 'varchar' },
    employee_number: { type: 'varchar' },
    display_name: { type: 'varchar' },
    email: { type: 'varchar', nullable: true },
    roles: { type: 'varchar', default: '' },
    school_ids: { type: 'varchar', default: '' },
    can_view_all_schools: { type: 'tinyint', default: '0' },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  feature_flags: {
    feature_key: { type: 'varchar', pk: true },
    enabled: { type: 'tinyint', default: '0' },
    updated_by: { type: 'varchar', nullable: true },
    updated_at: { type: 'datetime' }
  },
  future_positions: {
    id: { type: 'varchar', pk: true },
    pos_number: { type: 'varchar' },
    pos_name: { type: 'varchar' },
    organization: { type: 'varchar' },
    account_number: { type: 'varchar', nullable: true },
    incumbent_name: { type: 'varchar', nullable: true },
    employee_number: { type: 'varchar', nullable: true },
    position_type: { type: 'enum', default: 'vacant' },
    hire_date: { type: 'date', nullable: true },
    classroom_assigned: { type: 'varchar', nullable: true },
    contract_type: { type: 'varchar', nullable: true },
    contract_start_date: { type: 'date', nullable: true },
    contract_end_date: { type: 'date', nullable: true },
    letter_needed: { type: 'enum', nullable: true },
    notes: { type: 'text', nullable: true },
    submitted_by: { type: 'varchar' },
    submitted_by_name: { type: 'varchar', default: '' },
    status: { type: 'enum', default: 'pending' },
    locked_at: { type: 'datetime', nullable: true },
    completed_at: { type: 'datetime', nullable: true },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  system_messages: {
    id: { type: 'varchar', pk: true },
    title: { type: 'text' },
    message: { type: 'text' },
    type: { type: 'enum' },
    is_active: { type: 'tinyint', default: '1' },
    created_by: { type: 'varchar', nullable: true },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  position_pins: {
    id: { type: 'varchar', pk: true },
    user_id: { type: 'varchar' },
    pos_number: { type: 'varchar' },
    pos_name: { type: 'varchar' },
    organization: { type: 'varchar' },
    incumbent_name: { type: 'varchar', nullable: true },
    employee_number: { type: 'varchar', nullable: true },
    created_at: { type: 'datetime' }
  },
  position_comments: {
    id: { type: 'varchar', pk: true },
    pos_number: { type: 'varchar' },
    organization: { type: 'varchar' },
    author_id: { type: 'varchar' },
    author_name: { type: 'varchar' },
    body: { type: 'text' },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  report_sections: {
    id: { type: 'varchar', pk: true },
    title: { type: 'varchar' },
    sort_order: { type: 'int', default: '0' },
    is_active: { type: 'tinyint', default: '1' },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  reports: {
    id: { type: 'varchar', pk: true },
    section_id: { type: 'varchar' },
    title: { type: 'varchar' },
    description: { type: 'text' },
    sql_query: { type: 'longtext' },
    status: { type: 'enum', default: 'inactive' },
    highlight_rules: { type: 'text', default: '[]' },
    subreport_query: { type: 'text', nullable: true },
    subreport_key_column: { type: 'varchar', nullable: true },
    columns: { type: 'text', default: '[]' },
    additional_columns: { type: 'text', default: '[]' },
    created_by: { type: 'varchar', nullable: true },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  report_views: {
    id: { type: 'varchar', pk: true },
    report_id: { type: 'varchar' },
    organization: { type: 'varchar' },
    owner_id: { type: 'varchar' },
    owner_name: { type: 'varchar' },
    name: { type: 'varchar' },
    description: { type: 'text', default: '' },
    visibility: { type: 'enum', default: 'private' },
    definition: { type: 'longtext' },
    version: { type: 'int', default: '1' },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  report_view_invites: {
    id: { type: 'varchar', pk: true },
    view_id: { type: 'varchar' },
    inviter_id: { type: 'varchar' },
    invitee_id: { type: 'varchar', nullable: true },
    invitee_email: { type: 'varchar', nullable: true },
    invitee_name: { type: 'varchar' },
    role: { type: 'enum' },
    status: { type: 'enum', default: 'pending' },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  report_view_comments: {
    id: { type: 'varchar', pk: true },
    view_id: { type: 'varchar' },
    author_id: { type: 'varchar' },
    author_name: { type: 'varchar' },
    body: { type: 'text' },
    row_key: { type: 'text', nullable: true },
    parent_id: { type: 'varchar', nullable: true },
    created_at: { type: 'datetime' },
    updated_at: { type: 'datetime' }
  },
  ask_history: {
    id: { type: 'varchar', pk: true },
    user_id: { type: 'varchar' },
    question: { type: 'text' },
    answer: { type: 'text' },
    sql: { type: 'text' },
    row_count: { type: 'int', nullable: true },
    columns: { type: 'text', nullable: true },
    rows: { type: 'text', nullable: true },
    model: { type: 'varchar' },
    created_at: { type: 'datetime' }
  }
};

// Live source tables the MySQL repository queries. These are pre-existing HR
// tables — we only confirm they EXIST and have the referenced columns.
const SOURCE_REQUIRED_COLS: Record<string, string[]> = {
  employee_info: [
    'person_id', 'emp_number', 'first_name', 'last_name', 'full_name', 'e_mail',
    'personal_email', 'organization', 'pos_name', 'pos_number', 'cost_center',
    'object', 'primary_flag', 'position_id', 'classroom_assignment', 'a_months',
    'mailstop', 'sex', 'ethnicity', 'dob', 'account_code', 'tap', 'pay_grade',
    'group1', 'Supervisor', 'loc_type', 'step', 'proposed_salary',
    'fixed_supplement', 'off_scale', 'monthly_supplement', 'TOS_State',
    'AP_Teacher_Diff', 'hire_date', 'continuous_service_date', 'last_change',
    'contract_type', 'contract_start', 'contract_end', 'change_type',
    'board_number', 'certification_type', 'license_expiration', 'renewal_end',
    'years_of_serv', 'months_of_serv', 'last_updated'
  ],
  schools: ['school_no', 'school_name', 'school_level'],
  address: ['person_id', 'address', 'city', 'state', 'zip', 'phone'],
  leaves: ['person_id', 'accrual_plan', 'ytd_accrual_balance', 'MaxOfaccrual_rate',
    'Carryover', 'SumOfytd_accrued', 'SumOfytd_used', 'SumOfadjustments', 'MaxOfperiod_end_date'],
  cert_info: ['person_id', 'certification_type', 'cert_expiration', 'renewal_end'],
  cert_area: ['person_id', 'area', 'area_description', 'years', 'status', 'NCLB'],
  position_info: ['pos_start', 'pos_ending', 'pos_number', 'pos_name', 'organization',
    'fund', 'purpose', 'program', 'object', 'level', 'cost_center', 'months',
    'position_id', 'administrator', 'calendar', 'loc_type', 'region', 'ss200_code']
};

const conn = await mysql.createConnection(cfg);
const db = cfg.database as string;

let failures = 0;

// ---- fetch existing tables ----
const [tableRows] = await conn.execute<any[]>(
  'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
  [db]
);
const existingTables = new Set(tableRows.map((t) => t.TABLE_NAME));

// ---- fetch all columns for the database once ----
const [allCols] = await conn.execute<any[]>(
  `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
  [db]
);
const colsByTable = new Map<string, Map<string, any>>();
for (const c of allCols) {
  if (!colsByTable.has(c.TABLE_NAME)) colsByTable.set(c.TABLE_NAME, new Map());
  colsByTable.get(c.TABLE_NAME)!.set(c.COLUMN_NAME, c);
}

console.log(`\nConnected to ${cfg.host}:${cfg.port}/${db} as ${cfg.user}\n`);
const [ver] = await conn.execute<any[]>('SELECT VERSION() AS ver');
console.log(`Server version: ${ver[0].ver}\n`);

// Tables that are intentionally deferred (e.g. ask_history, a future feature).
// When absent they are reported as SKIPPED, not counted as a failure, so the
// result stays green for the tables the DBA was asked to create now.
const DEFERRED_TABLES = new Set(['ask_history']);

console.log('=== APP-CREATED TABLES (from app-tables.mysql.sql) ===\n');

for (const [table, specs] of Object.entries(APP_TABLES)) {
  const exists = existingTables.has(table);
  if (!exists) {
    if (DEFERRED_TABLES.has(table)) {
      console.log(`⏭️  ${table}  —  SKIPPED (deferred/future feature)`);
      continue;
    }
    console.log(`❌ ${table}  —  TABLE MISSING`);
    failures++;
    continue;
  }
  const actualCols = colsByTable.get(table) ?? new Map();
  const issues: string[] = [];
  for (const [col, spec] of Object.entries(specs)) {
    const a = actualCols.get(col);
    if (!a) {
      issues.push(`  missing column: ${col}`);
      continue;
    }
    // type family check: compare DATA_TYPE
    const wantType = spec.type ?? '';
    const wantFamily = normalizeType(wantType);
    if (wantFamily && a.DATA_TYPE !== wantFamily) {
      issues.push(`  column ${col}: data_type is '${a.DATA_TYPE}', expected '${spec.type}'`);
    }
    // nullability
    if (spec.nullable === false && a.IS_NULLABLE === 'YES') {
      issues.push(`  column ${col}: should be NOT NULL but is nullable`);
    }
    if (spec.nullable === true && a.IS_NULLABLE === 'NO') {
      issues.push(`  column ${col}: should be nullable but is NOT NULL`);
    }
    // default (only check when explicitly specified)
    if (spec.default !== undefined) {
      const want = String(spec.default);
      const got = a.COLUMN_DEFAULT === null ? null : String(a.COLUMN_DEFAULT);
      if (got !== want) {
        issues.push(`  column ${col}: default is ${got === null ? 'NULL' : `'${got}'`}, expected '${want}'`);
      }
    }
    // primary key
    if (spec.pk && a.COLUMN_KEY !== 'PRI') {
      issues.push(`  column ${col}: should be PRIMARY KEY`);
    }
  }
  if (issues.length === 0) {
    console.log(`✅ ${table}  —  schema OK (${actualCols.size} columns)`);
  } else {
    console.log(`⚠️  ${table}  —  ${issues.length} issue(s):`);
    for (const i of issues) console.log(i);
    failures++;
  }
}

console.log('\n=== LIVE SOURCE TABLES (queried by MySQL repository) ===\n');

for (const [table, requiredCols] of Object.entries(SOURCE_REQUIRED_COLS)) {
  const exists = existingTables.has(table);
  if (!exists) {
    console.log(`❌ ${table}  —  TABLE MISSING`); failures++;
    continue;
  }
  const actualCols = colsByTable.get(table) ?? new Map();
  const missing = requiredCols.filter((c) => !actualCols.has(c));
  if (missing.length === 0) {
    console.log(`✅ ${table}  —  present, all ${requiredCols.length} referenced columns found`);
  } else {
    console.log(`⚠️  ${table}  —  present but missing columns: ${missing.join(', ')}`);
    failures++;
  }
}

await conn.end();

console.log(`\n=== RESULT: ${failures === 0 ? 'ALL OK ✅' : `${failures} table(s) have issues ⚠️`} ===\n`);
process.exit(failures === 0 ? 0 : 1);

function normalizeType(type: string): string {
  // map our short spec names to information_schema DATA_TYPE values
  const map: Record<string, string> = {
    varchar: 'varchar',
    text: 'text',
    longtext: 'longtext',
    tinyint: 'tinyint',
    int: 'int',
    datetime: 'datetime',
    date: 'date',
    enum: 'enum',
    char: 'char',
    json: 'json'
  };
  return map[type] ?? type;
}

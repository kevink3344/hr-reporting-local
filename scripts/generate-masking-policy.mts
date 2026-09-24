// Generates `docs/data/masking-policy.json` — the single auditable artifact that
// describes every masking rule and the (before -> after) chart-of-accounts map.
//
// Why a generator instead of a hand-written file: the account-segment map must
// cover EXACTLY the values present in the demo scope. Transcribing 118 codes by
// hand invites a miss, and a missed segment leaks a real account code. Reading
// `information_schema`-backed DISTINCT queries makes the map provably complete.
//
// Two invariants the assignment must hold:
//   1. INJECTIVE — every real value gets a distinct pseudonym, or two different
//      accounts collapse into one and grouping breaks.
//   2. DISJOINT — no pseudonym may equal any real value in the same segment, so
//      masked data can never be mistaken for (or accidentally match) real data.
//
// No timestamp is written, so regenerating against unchanged source data yields
// a byte-identical file and the ETL manifest's policy hash stays stable.
import { appendFileSync, writeFileSync } from 'node:fs';
import { queryWithDeadline } from '../src/db.js';

const OUT = '_generate-masking-policy.out.txt';
const TARGET = 'docs/data/masking-policy.json';

writeFileSync(OUT, '', 'utf8');
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n', 'utf8');
};

const ORGS = [
  'Broughton High School - 348',
  'Neuse River Middle School - 410',
  'Beaverdam Elementary School - 332',
];

// ---------------------------------------------------------------------------
// deterministic PRNG — seeded so the assignment is reproducible
// ---------------------------------------------------------------------------
function seedFrom(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// segment metadata
// ---------------------------------------------------------------------------
type SegmentSpec = {
  width: number;
  keep: boolean;
  // Junk / non-account values that must round-trip unchanged. `0000` in `level`
  // is not a real level — remapping it to a plausible code would present a data
  // quality defect as valid data, and it leaks nothing either way.
  identity?: string[];
  sources: Array<[string, string]>;
};

const SEGMENTS: Record<string, SegmentSpec> = {
  fund: {
    width: 2,
    keep: false,
    sources: [['position_info', 'fund'], ['employee_info', 'fund']],
  },
  purpose: {
    width: 4,
    keep: false,
    sources: [['position_info', 'purpose']],
  },
  program: {
    width: 3,
    keep: false,
    sources: [['position_info', 'program']],
  },
  object: {
    width: 3,
    keep: false,
    sources: [['position_info', 'object'], ['employee_info', 'object']],
  },
  level: {
    width: 4,
    keep: false,
    identity: ['0000'],
    sources: [['position_info', 'level']],
  },
  // cost_center is the school number, which is public (`schools.school_no`).
  // Masking it would destroy school attribution for no privacy gain.
  cost_center: {
    width: 4,
    keep: true,
    sources: [['position_info', 'cost_center'], ['employee_info', 'cost_center']],
  },
};

// The positional order inside `employee_info.account_code`.
const ACCOUNT_CODE_ORDER = ['fund', 'purpose', 'program', 'object', 'level', 'cost_center'];

// ---------------------------------------------------------------------------
// column rules — anything not listed is kept verbatim
// ---------------------------------------------------------------------------
const COLUMN_RULES: Record<string, Record<string, string>> = {
  employee_info: {
    // Full SSNs are present at 100 % here, so this is load-bearing, not cosmetic.
    socsec: 'null',
    SSN: 'null',
    dob: 'null',
    proposed_salary: 'band:5000',
    fixed_supplement: 'band:100',
    supp_rate: 'band:100',
    monthly_supplement: 'band:100',
    TOS_State: 'band:100',
    e_mail: 'email',
    personal_email: 'null',
    account_code: 'account-code',
    fund: 'segment:fund',
    object: 'segment:object',
    full_name: 'fake-full-name',
    first_name: 'fake-first-name',
    middle_name: 'fake-middle-name',
    last_name: 'fake-last-name',
    // Explicit keeps — these are deliberate, not oversights.
    person_id: 'keep',
    emp_number: 'keep',
    pos_name: 'keep',
    cost_center: 'keep',
    organization: 'keep',
    pos_number: 'keep',
    pay_grade: 'keep',
    step: 'keep',
    ethnicity: 'keep',
    sex: 'keep',
  },
  position_info: {
    fund: 'segment:fund',
    purpose: 'segment:purpose',
    program: 'segment:program',
    object: 'segment:object',
    level: 'segment:level',
    cost_center: 'keep',
    // Job titles are NOT person data. Faking them would destroy every
    // seat-level report, so they are explicitly kept.
    pos_name: 'keep',
    pos_number: 'keep',
    organization: 'keep',
  },
  address: {
    address: 'null',
    city: 'null',
    state: 'null',
    zip: 'null',
    phone: 'null',
    ss_mobile: 'null',
    ss_home: 'null',
    ss_work: 'null',
    ss_work_mobile: 'null',
    person_id: 'keep',
  },
  cert_info: { socsec: 'null', person_id: 'keep' },
  cert_area: { socsec: 'null', person_id: 'keep' },
  education_info: {
    socsec: 'null',
    // `school` is the degree-granting INSTITUTION (a university), not a K-12
    // school. Institution names are identifying when combined with a degree
    // year, so they get synthetic replacements.
    school: 'fake-institution',
    state: 'null',
    person_id: 'keep',
  },
  resignations: {
    DOB: 'null',
    address: 'null',
    city: 'null',
    state: 'null',
    zip: 'null',
    phone: 'null',
    full_name: 'fake-full-name',
    first_name: 'fake-first-name',
    middle_name: 'fake-middle-name',
    last_name: 'fake-last-name',
    fund: 'segment:fund',
    purp: 'segment:purpose',
    prc: 'segment:program',
    obj: 'segment:object',
    lvl: 'segment:level',
    cstc: 'segment:cost_center',
    person_id: 'keep',
    emp_number: 'keep',
    organization: 'keep',
  },
  leaves: { full_name: 'fake-full-name', person_id: 'keep' },
  assignment: { full_name: 'fake-full-name', personal_email: 'null', person_id: 'keep' },
  schools: {
    // School names/addresses are public district information and `school_name`
    // is the join key to `organization`, so the table is kept verbatim.
    school_name: 'keep',
    school_no: 'keep',
  },
};

// ---------------------------------------------------------------------------
// synthetic identity pools
//
// These live in the artifact rather than in code so the whole masking decision
// is reviewable in one file. 64 x 64 first/last combinations comfortably cover
// the 373 people in scope, which lets the ETL assign a UNIQUE pseudo-name per
// person instead of relying on hash luck — duplicate names in a demo read as a
// bug.
// ---------------------------------------------------------------------------
const FAKE_NAMES = {
  version: 1,
  first: [
    'Avery', 'Blake', 'Cameron', 'Dakota', 'Elliot', 'Finley', 'Gray', 'Harper',
    'Indigo', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Nova', 'Oakley', 'Parker',
    'Quinn', 'Reese', 'Sage', 'Taylor', 'Umber', 'Vale', 'Wren', 'Xen',
    'Yuki', 'Zephyr', 'Adrian', 'Briar', 'Casey', 'Devon', 'Emerson', 'Frankie',
    'Gale', 'Hayden', 'Ira', 'Jules', 'Kendall', 'Lane', 'Marlowe', 'Nico',
    'Ollie', 'Phoenix', 'Quincy', 'River', 'Skyler', 'Tatum', 'Ursa', 'Vesper',
    'Waverly', 'Xander', 'Yarden', 'Zion', 'Arden', 'Bay', 'Cielo', 'Dune',
    'Ede', 'Fern', 'Glenn', 'Hollis', 'Isolde', 'Juniper', 'Kira', 'Linden',
  ],
  last: [
    'Ashford', 'Bellamy', 'Carlisle', 'Danforth', 'Easton', 'Fairweather', 'Glenmore', 'Halloway',
    'Ingram', 'Jasper', 'Kingsley', 'Lockhart', 'Marlowe', 'Northcott', 'Oberon', 'Pemberton',
    'Quillen', 'Radcliffe', 'Sinclair', 'Thorne', 'Underhill', 'Vance', 'Westbrook', 'Yarrow',
    'Aldridge', 'Brightwater', 'Cavanaugh', 'Delacroix', 'Ellsworth', 'Fenwick', 'Gainsborough', 'Hawthorne',
    'Irving', 'Kensington', 'Larkspur', 'Merriweather', 'Norrington', 'Osgood', 'Prescott', 'Ravenscroft',
    'Sedgewick', 'Tremaine', 'Ulverston', 'Winslow', 'Ambrose', 'Blackwood', 'Cresswell', 'Dunmore',
    'Everly', 'Fitzgerald', 'Grayling', 'Hensley', 'Islington', 'Kestrel', 'Lomond', 'Marchetti',
    'Newbury', 'Overton', 'Penrose', 'Rothwell', 'Stanhope', 'Thistlewood', 'Vaughn', 'Whitmore',
  ],
  middleInitials: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'W'],
  institutions: [
    'Bay State University', 'Cedar Ridge University', 'Clearwater College', 'Copper Valley University',
    'Eastfield State University', 'Fairmont College', 'Foxglove University', 'Gravel Run College',
    'Harborview University', 'Hickory Ridge College', 'Ironwood State University', 'Juniper College',
    'Kestrel Point University', 'Lakeshore State College', 'Meadowbrook University', 'Millbrook College',
    'Northgate University', 'Oakhaven College', 'Pinehurst State University', 'Quarry Hill College',
    'Redstone University', 'Riverbend College', 'Sandhill State University', 'Silver Creek College',
    'Stonebridge University', 'Sunfield College', 'Thornbury University', 'Timberline College',
    'Union Grove University', 'Vineyard College', 'Wexford State University', 'Whitestone College',
    'Willowmere University', 'Windrow College', 'Yellowstone State College', 'Ashgrove University',
    'Birchwood College', 'Cottonwood State University', 'Driftwood College', 'Elmsworth University',
  ],
  // Values in `education_info.school` that are NOT institutions. Remapping these
  // to a university name would turn a real reporting category into false data.
  sentinelInstitutions: ['Out of Country'],
};

// ---------------------------------------------------------------------------
// sync plan — which tables, and how each is scoped
// ---------------------------------------------------------------------------
const SYNC_TABLES: Record<string, { scope: 'organization' | 'closure' | 'schools'; include?: boolean; note?: string }> = {
  schools: { scope: 'schools', note: 'filtered to the demo orgs so the selector lists only orgs that have data' },
  employee_info: { scope: 'organization', note: 'also supplies the person_id closure set' },
  position_info: { scope: 'organization' },
  resignations: {
    scope: 'organization',
    note: 'MUST be organization, never closure — closure returns 2 of 28, silently losing 26 rows',
  },
  address: { scope: 'closure' },
  cert_info: { scope: 'closure' },
  cert_area: { scope: 'closure' },
  leaves: { scope: 'closure' },
  assignment: { scope: 'closure' },
  education_info: { scope: 'closure' },
  mentor: { scope: 'closure', include: false, note: 'excluded by decision: stale 2019 BT-mentoring cohort, no reporting value' },
};

// ---------------------------------------------------------------------------
// read the real distinct values
// ---------------------------------------------------------------------------
log(`generate-masking-policy at ${new Date().toISOString()}`);
log(`scope: ${ORGS.length} orgs\n`);

const segments: Record<string, { width: number; keep: boolean; identity: string[]; values: Record<string, string> }> = {};

for (const [seg, spec] of Object.entries(SEGMENTS)) {
  const real = new Set<string>();
  for (const [table, column] of spec.sources) {
    const rows = await queryWithDeadline<{ v: unknown }>(
      `SELECT DISTINCT \`${column}\` AS v FROM \`${table}\` WHERE organization IN (?,?,?)`,
      ORGS,
      120_000
    );
    for (const r of rows) {
      const v = r.v === null || r.v === undefined ? '' : String(r.v).trim();
      if (v !== '') real.add(v);
    }
  }

  const identity = (spec.identity ?? []).filter((v) => real.has(v));
  const maskable = [...real].filter((v) => !identity.includes(v)).sort();

  const values: Record<string, string> = {};
  if (spec.keep) {
    for (const v of real) values[v] = v;
    log(`  ${seg.padEnd(12)} keep — ${real.size} value(s) round-trip unchanged: ${[...real].sort().join(', ')}`);
  } else {
    // Candidate pool: every zero-padded number of the right width, minus the
    // real values (DISJOINT) and minus the junk values.
    const max = Math.min(10 ** spec.width - 1, 9999);
    const pool: string[] = [];
    for (let i = 1; i <= max; i++) pool.push(String(i).padStart(spec.width, '0'));
    const rand = mulberry32(seedFrom(`mask:${seg}:v1`));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
    }
    const candidates = pool.filter((p) => !real.has(p) && !identity.includes(p));

    if (candidates.length < maskable.length) {
      throw new Error(`${seg}: pool exhausted (${candidates.length} candidates for ${maskable.length} values)`);
    }
    // Zip sorted real values against a shuffled pool -> non-sequential mapping.
    maskable.forEach((v, i) => {
      values[v] = candidates[i] as string;
    });
    for (const v of identity) values[v] = v;

    // Assert the two invariants before writing anything.
    const outSet = new Set(Object.values(values));
    if (outSet.size !== Object.keys(values).length) throw new Error(`${seg}: mapping is not injective`);
    for (const v of Object.keys(values)) {
      if (!spec.keep && !identity.includes(v) && real.has(values[v] as string)) {
        throw new Error(`${seg}: pseudonym "${values[v]}" collides with a real value`);
      }
    }
    if (maskable.some((v) => (values[v] as string).length !== spec.width)) {
      throw new Error(`${seg}: width not preserved`);
    }

    log(
      `  ${seg.padEnd(12)} ${String(maskable.length).padStart(2)} mapped (width ${spec.width})` +
        (identity.length ? ` + ${identity.length} junk kept (${identity.join(', ')})` : '') +
        `   e.g. ${maskable[0]} -> ${values[maskable[0]]}`
    );
  }
  segments[seg] = { width: spec.width, keep: spec.keep, identity, values };
}

const totalMapped = Object.values(segments).reduce(
  (n, s) => n + (s.keep ? 0 : Object.keys(s.values).length - s.identity.length),
  0
);
const totalEntries = Object.values(segments).reduce((n, s) => n + Object.keys(s.values).length, 0);
log(`\n  ${totalEntries} map entries total, ${totalMapped} actively remapped\n`);

const policy = {
  version: 1,
  description:
    'Masking policy for the cloud (Turso) demo copy. Generated by scripts/generate-masking-policy.mts — ' +
    'edit that script (not this file) to change the rules, then regenerate.',
  source: { database: 'reporting', orgs: ORGS },
  accountCodeOrder: ACCOUNT_CODE_ORDER,
  segments,
  fakeNames: FAKE_NAMES,
  sync: { orgs: ORGS, tables: SYNC_TABLES },
  tables: COLUMN_RULES,
};

writeFileSync(TARGET, JSON.stringify(policy, null, 2) + '\n', 'utf8');
log(`wrote ${TARGET}`);
log('\nDONE');
process.exit(0);

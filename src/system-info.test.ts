import { describe, expect, it } from 'vitest';
import {
  REFRESHED_TABLES,
  baselineFor,
  buildSystemInfo,
  localDateOf,
  parseSnapshot,
  recordReading,
  sortReadings,
  stripImplausibleCounts,
  tablesFromReadings,
  type SnapshotReading
} from './system-info.js';

function reading(takenAt: string, counts: Record<string, number>, checksums: Record<string, number> = {}): SnapshotReading {
  return { takenAt, source: 'mysql', counts, checksums, dataAsOf: null };
}

describe('snapshot parsing', () => {
  it('rejects text that is not JSON', () => {
    const result = parseSnapshot('<html>not json</html>');
    expect(result.data.readings).toEqual([]);
    expect(result.error).toBe('the snapshot file is not valid JSON');
  });

  it('rejects JSON that is not an object', () => {
    const result = parseSnapshot('[1, 2, 3]');
    expect(result.data.readings).toEqual([]);
    expect(result.error).toBe('the snapshot file is not a JSON object');
  });

  it('rejects an object with no readings array', () => {
    const result = parseSnapshot('{"version":1}');
    expect(result.data.readings).toEqual([]);
    expect(result.error).toBe('the snapshot file has no "readings" array');
  });

  it('keeps only readings that carry a timestamp', () => {
    const result = parseSnapshot(JSON.stringify({
      version: 1,
      readings: [
        { takenAt: '2026-09-10T12:00:00.000Z', source: 'mysql', counts: { employee_info: 22000 } },
        { source: 'mysql', counts: { leaves: 1 } },
        'nonsense',
        null
      ]
    }));
    expect(result.error).toBeNull();
    expect(result.data.readings).toHaveLength(1);
    expect(result.data.readings[0]?.counts).toEqual({ employee_info: 22000 });
  });

  it('drops entries a table could not be named after, and unreadable counts', () => {
    const result = parseSnapshot(JSON.stringify({
      version: 1,
      readings: [{
        takenAt: '2026-09-10T12:00:00.000Z',
        source: 'mysql',
        counts: { employee_info: 22000, 'bad-name; DROP TABLE': 5, leaves: 'nope' },
        checksums: { employee_info: 42 }
      }]
    }));
    const stored = result.data.readings[0];
    expect(stored?.counts).toEqual({ employee_info: 22000 });
    expect(stored?.checksums).toEqual({ employee_info: 42 });
    // Absent checksums must read back as an empty map, not undefined, so the
    // comparison can tell "no fingerprint" from "fingerprint differs".
    expect(parseSnapshot('{"readings":[{"takenAt":"2026-09-10T12:00:00Z","counts":{}}]}')
      .data.readings[0]?.checksums).toEqual({});
  });

  it('defaults the version and sorts newest first', () => {
    const result = parseSnapshot(JSON.stringify({
      readings: [
        { takenAt: '2026-09-08T12:00:00.000Z', counts: {} },
        { takenAt: 'not a date', counts: {} },
        { takenAt: '2026-09-10T12:00:00.000Z', counts: {} }
      ]
    }));
    expect(result.data.version).toBe(1);
    expect(result.data.readings.map((r) => r.takenAt)).toEqual([
      '2026-09-10T12:00:00.000Z',
      '2026-09-08T12:00:00.000Z',
      'not a date'
    ]);
  });

  it('never lets an unparseable stamp sort ahead of a real one', () => {
    const sorted = sortReadings([reading('rubbish', {}), reading('2020-01-01T00:00:00.000Z', {})]);
    expect(sorted[0]?.takenAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('localDateOf', () => {
  it('reads the local calendar day, not the UTC one', () => {
    const stamp = new Date(2026, 8, 10, 23, 30).toISOString();
    expect(localDateOf(stamp)).toBe('2026-09-10');
  });

  it('flags an unparseable stamp so it can never pass as today', () => {
    expect(localDateOf('nonsense')).toBe('invalid:nonsense');
    expect(localDateOf('nonsense')).not.toBe(localDateOf(new Date().toISOString()));
  });
});

describe('recordReading', () => {
  it('appends the first reading of the day', () => {
    const result = recordReading([], reading('2026-09-10T12:00:00.000Z', { employee_info: 1 }));
    expect(result.recorded).toBe(true);
    expect(result.readings).toHaveLength(1);
  });

  it('is a no-op on a second visit the same day', () => {
    const existing = [reading('2026-09-10T08:00:00.000Z', { employee_info: 1 })];
    const result = recordReading(existing, reading('2026-09-10T17:00:00.000Z', { employee_info: 2 }));
    expect(result.recorded).toBe(false);
    expect(result.readings).toEqual(existing);
  });

  it('appends once the day rolls over', () => {
    const existing = [reading('2026-09-10T08:00:00.000Z', { employee_info: 1 })];
    const result = recordReading(existing, reading('2026-09-11T08:00:00.000Z', { employee_info: 2 }));
    expect(result.recorded).toBe(true);
    expect(result.readings.map((r) => r.takenAt)).toEqual([
      '2026-09-11T08:00:00.000Z',
      '2026-09-10T08:00:00.000Z'
    ]);
  });

  it('keeps at most the requested number of readings', () => {
    let readings: SnapshotReading[] = [];
    for (let day = 1; day <= 5; day += 1) {
      readings = recordReading(readings, reading(`2026-09-0${day}T08:00:00.000Z`, { employee_info: day }), 3).readings;
    }
    expect(readings).toHaveLength(3);
    expect(readings[0]?.takenAt).toBe('2026-09-05T08:00:00.000Z');
  });
});

describe('baselineFor', () => {
  it('is null on the very first day', () => {
    expect(baselineFor([reading('2026-09-10T08:00:00.000Z', { employee_info: 1 })], '2026-09-10T18:00:00.000Z')).toBeNull();
    expect(baselineFor([], '2026-09-10T18:00:00.000Z')).toBeNull();
  });

  it('is the newest reading that is not from today', () => {
    const readings = [
      reading('2026-09-10T08:00:00.000Z', { employee_info: 3 }),
      reading('2026-09-09T08:00:00.000Z', { employee_info: 2 }),
      reading('2026-09-08T08:00:00.000Z', { employee_info: 1 })
    ];
    expect(baselineFor(readings, '2026-09-10T18:00:00.000Z')?.counts.employee_info).toBe(2);
  });
});

describe('stripImplausibleCounts', () => {
  it('drops a zero for a table the previous reading showed as populated', () => {
    // The real case: cert_info and education_info came back as 0 while a probe
    // sat waiting on a table lock, which would have recorded a fake −100%.
    const previous = reading('2026-09-09T08:00:00.000Z', { cert_info: 15729, education_info: 25952 });
    expect(stripImplausibleCounts({ cert_info: 0, education_info: 0, schools: 345 }, previous)).toEqual({ schools: 345 });
  });

  it('keeps a genuine drop and a genuinely empty table', () => {
    const previous = reading('2026-09-09T08:00:00.000Z', { employee_info: 22003, employee_info_future: 0 });
    // employee_info_future reads 0 in every reading, so its zero is a measurement.
    expect(stripImplausibleCounts({ employee_info: 21988, employee_info_future: 0 }, previous)).toEqual({
      employee_info: 21988,
      employee_info_future: 0
    });
  });

  it('keeps every zero when there is no previous reading to contradict', () => {
    expect(stripImplausibleCounts({ cert_info: 0 }, null)).toEqual({ cert_info: 0 });
  });

  it('leaves tables the previous reading never mentioned alone', () => {
    const previous = reading('2026-09-09T08:00:00.000Z', { cert_info: 15729 });
    expect(stripImplausibleCounts({ brand_new: 0 }, previous)).toEqual({ brand_new: 0 });
  });
});

describe('tablesFromReadings', () => {
  it('reports the known reporting tables even with no snapshot at all', () => {
    expect(tablesFromReadings([])).toEqual([...REFRESHED_TABLES]);
  });

  it('puts tables the snapshot mentions first, without duplicating the known ones', () => {
    const tables = tablesFromReadings([reading('2026-09-10T08:00:00.000Z', { zzz_extra: 1, employee_info: 2 })]);
    expect(tables[0]).toBe('zzz_extra');
    expect(tables[1]).toBe('employee_info');
    expect(tables.filter((table) => table === 'employee_info')).toHaveLength(1);
    expect(tables).toHaveLength(REFRESHED_TABLES.length + 1);
  });
});

describe('buildSystemInfo', () => {
  const base = {
    generatedAt: '2026-09-10T18:00:00.000Z',
    dataSource: 'mysql',
    snapshotFile: 'docs/data/daily-refresh/system-info-snapshot.json',
    dataAsOf: '2026-09-11 00:00:00'
  };

  it('reports deltas and percentages against the baseline', () => {
    const payload = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info: 22000, schools: 345 })],
      counts: { employee_info: 22088, schools: 345 }
    });
    const employee = payload.rows.find((row) => row.table === 'employee_info');
    expect(employee).toMatchObject({ baselineCount: 22000, liveCount: 22088, delta: 88, deltaPct: 0.4 });
    const schools = payload.rows.find((row) => row.table === 'schools');
    expect(schools).toMatchObject({ delta: 0 });
    expect(payload.baseline?.takenAt).toBe('2026-09-09T08:00:00.000Z');
    expect(payload.liveCountsAvailable).toBe(true);
  });

  it('distinguishes a same-count reload from a genuine addition', () => {
    const payload = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info: 22000 }, { employee_info: 111 })],
      counts: { employee_info: 22000 },
      checksums: { employee_info: 999 }
    });
    const employee = payload.rows.find((row) => row.table === 'employee_info');
    // Same number of rows, different rows: the case a count alone cannot see.
    expect(employee).toMatchObject({ delta: 0, contentChanged: true });
  });

  it('reports no content change when the fingerprint matches', () => {
    const payload = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info: 22000 }, { employee_info: 111 })],
      counts: { employee_info: 22000 },
      checksums: { employee_info: 111 }
    });
    expect(payload.rows.find((row) => row.table === 'employee_info')?.contentChanged).toBe(false);
  });

  it('leaves contentChanged null when either side has no fingerprint', () => {
    const noBaselineChecksum = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info: 22000 }, {})],
      counts: { employee_info: 22000 },
      checksums: { employee_info: 999 }
    });
    const noLiveChecksum = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info: 22000 }, { employee_info: 111 })],
      counts: { employee_info: 22000 },
      checksums: {}
    });
    for (const payload of [noBaselineChecksum, noLiveChecksum]) {
      expect(payload.rows.find((row) => row.table === 'employee_info')?.contentChanged).toBeNull();
    }
  });

  it('degrades to nulls instead of throwing when nothing could be measured', () => {
    const payload = buildSystemInfo({ ...base, readings: [], counts: {}, dataAsOf: null });
    expect(payload.rows).toHaveLength(REFRESHED_TABLES.length);
    expect(payload.liveCountsAvailable).toBe(false);
    expect(payload.baseline).toBeNull();
    for (const row of payload.rows) {
      expect(row).toMatchObject({ baselineCount: null, liveCount: null, delta: null, deltaPct: null, contentChanged: null });
    }
  });

  it('never reports a percentage against a zero baseline', () => {
    const payload = buildSystemInfo({
      ...base,
      readings: [reading('2026-09-09T08:00:00.000Z', { employee_info_future: 0 })],
      counts: { employee_info_future: 7 }
    });
    const row = payload.rows.find((entry) => entry.table === 'employee_info_future');
    expect(row).toMatchObject({ baselineCount: 0, liveCount: 7, delta: 7, deltaPct: null });
  });

  it('caps the history and surfaces the reported snapshot path and flags', () => {
    const readings = Array.from({ length: 14 }, (_value, index) =>
      reading(`2026-08-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`, { employee_info: index })
    );
    const payload = buildSystemInfo({
      ...base,
      snapshotError: 'the snapshot file is not valid JSON',
      recordedNow: true,
      readings,
      counts: {}
    });
    expect(payload.readings).toHaveLength(10);
    expect(payload.snapshotFile).toBe('docs/data/daily-refresh/system-info-snapshot.json');
    expect(payload.snapshotError).toBe('the snapshot file is not valid JSON');
    expect(payload.recordedNow).toBe(true);
    expect(payload.dataAsOf).toBe('2026-09-11 00:00:00');
  });
});

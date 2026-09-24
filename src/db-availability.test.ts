import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database reachability probe is the only thing this file needs to control.
// Everything else in `./db.js` is passed through unchanged so importing the
// MySQL repository set still works.
vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>();
  return { ...actual, isDbReady: () => Promise.resolve(false) };
});

const { createApp } = await import('./app.js');
const { mysqlRepositories } = await import('./repositories/mysql-repository.js');

// A DB-backed deployment cannot authenticate anyone while its database is
// unreachable: credentials are matched against the user directory, which lives
// in the database. Sign-in therefore has to be refused with an explicit,
// actionable code instead of a generic 500 from the pool's socket error — the
// client turns DB_UNAVAILABLE into "Database is currently unavailable."
describe('sign-in while the database is unreachable', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer(createApp(mysqlRepositories));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('reports the database as required but not ready', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      dataSource: 'mysql',
      dbRequired: true,
      dbReady: false
    });
  });

  it('refuses a sign-in with 503 DB_UNAVAILABLE', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wakeId: 'hr.admin', employeeId: '900003' })
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'DB_UNAVAILABLE' });
  });

  it('still validates the request body before consulting the database', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});

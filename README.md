# HR Reporting Node

Initial migration slice for the legacy HR Reporting application.

## Development

```powershell
npm install
npm run dev
```

The fixture-backed API is available at `http://localhost:3000`.

- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs.json`
- Health: `http://localhost:3000/api/health`

Current endpoints use the synthetic fixtures in `docs/data`. Authentication remains behind an adapter boundary until the existing identity provider details are confirmed.

## Validation

```powershell
npm run build
npm test
```

## Deployment

`npm run build` emits `dist/` (server) and `client/dist/` (SPA). A single Node
process serves both: `client/dist` must be a sibling of `dist/`, and the app
serves the SPA with an `/api` passthrough. Copy `docs/` too — it is not a build
artifact.

Environment variables are documented in `.env.example`. On a server, set them
through the deployment's secret manager or a service-level environment file
rather than a checked-in `.env`.

### System Information baseline

The admin-only System Information page (feature flag `system_info`, off by
default) records its own day-over-day baseline, because the reporting database
keeps no load history. The baseline is a JSON file written at runtime, ignored by
git:

| | |
|---|---|
| Default | `<app root>/docs/data/daily-refresh/system-info-snapshot.json` |
| Override | `SYSTEM_INFO_SNAPSHOT` |

On a server, point the override outside the checkout so a redeploy cannot reset
it, and make sure the service user can write there:

```bash
SYSTEM_INFO_SNAPSHOT=/var/lib/hr-reporting/system-info-snapshot.json
TZ=America/New_York
```

`TZ` matters: "one reading per day" follows the server's local day. On a box left
on UTC the day boundary lands at 8pm Eastern, so an admin opening the page at
7pm and again at 9pm records two readings in one evening and the "overnight" diff
becomes two hours wide. Set the zone so readings align with the 23:30 load.

Readings are only taken when an admin opens the page — there is no cron job.

If the file cannot be written the page still renders with live row counts and no
comparison; it never fails the request. See
[`docs/plans/system-info-baseline-storage.md`](docs/plans/system-info-baseline-storage.md)
for the full design, the deployment failure modes, and the path to moving this
into a database table.

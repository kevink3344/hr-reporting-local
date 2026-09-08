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

# Light Test Data

These files are small, synthetic fixtures for local API, React, authorization, lookup, and report-shape tests while database connection information is unavailable.

Files:

- `users.json`: synthetic identities and role/school scope; intentionally contains no passwords or password hashes.
- `schools.json`: school and department lookup records.
- `people.json`: employee/person lookup records modeled after the legacy `employee_info` and related lookup fields.
- `osha-reports.json`: representative OSHA report records for read/write and export tests.

Rules:

- Do not treat these files as a production seed or as a replacement for a sanitized database snapshot.
- Do not add real names, email addresses, employee numbers, SSNs, addresses, phone numbers, passwords, or connection details.
- Keep IDs and email domains synthetic (`example.test`).
- A future file-backed repository should load these fixtures only in development and test environments.
- When database adapters are implemented, tests should run against both these fixtures and an approved sanitized integration database.

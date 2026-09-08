# Database Connection Notes

## Status

Connection details are incomplete while staff provide the Oracle and MySQL connection information. Do not place passwords, private keys, tokens, or live connection strings in this repository. Store those through the deployment secret manager or local ignored environment files.

## Verified legacy MySQL information

Source: `hr-reporting-main/db_conn.php` and `hr-reporting-main/includes/db_conn.php`.

- Driver/API: PHP `mysqli`
- Host variable: `$conn_host`
- Username variable: `$conn_uname`
- Password variable: `$conn_pass`
- Configuration source: external `/var/www/config/hr/locale.php`
- Selected database: `reporting`
- Connection call: `mysqli_connect($conn_host, $conn_uname, $conn_pass)`
- TLS, port, charset, timeout, and pool settings: not present in the inspected files

Source: `hr-reporting-main/k_brown.sql`.

- Dump format: MySQL/MariaDB dump
- Recorded host: `zevenprod`
- Recorded database: `reporting`
- Recorded server version: MariaDB `5.5.64`
- Recorded dump client distribution: MariaDB `5.5.68`
- Dump timestamp: June 27, 2023

`zevenprod` is historical dump metadata, not confirmed as the current server. The dump also contains a real-looking employee record and must not be used as test seed data.

## Verified Oracle-related information

- The active reporting queries read Oracle-derived HR data from MySQL tables such as `employee_info` and `schools`.
- Legacy UI and comments refer to Oracle as the source or format for employee information.
- Files such as `oraIDfail.php` and `_vti_cnf/OracleConnect.inc` exist, but the inspected active Oracle-named files did not contain a usable Oracle host, service name, username, password, port, or connect call.
- Oracle driver, connection method, schema, service/SID, read/write ownership, and synchronization mechanism remain unknown.

## Information to obtain from staff

### MySQL

- Current hostname or IP
- Port
- Database name and environment names
- TLS requirements and certificate settings
- Read-only versus write-capable account requirements
- Charset/collation
- Network allowlists or VPN requirements
- Backup and refresh process for a sanitized test database

### Oracle

- Oracle version and driver requirement
- Host, port, service name or SID
- Schema/account names and read/write permissions
- TLS/wallet requirements
- Which tables or views are authoritative
- Whether Node will read Oracle directly or consume a synchronized MySQL projection
- Network allowlists, VPN requirements, and connection limits

## Temporary local testing strategy

Until real connection information is available, use the synthetic fixtures in [`docs/data`](../data/README.md). They are designed for API, React, authorization, lookup, and report-shape tests and do not require either database.

- Use a repository interface so file-backed repositories can be replaced by MySQL/Oracle adapters later.
- Keep fixture IDs and email domains clearly synthetic.
- Do not add passwords or password hashes to fixture files.
- Add integration tests against real databases only after staff provide sanitized, non-production credentials and an approved test environment.


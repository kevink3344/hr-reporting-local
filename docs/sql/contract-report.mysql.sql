-- Contract Report — MySQL — :organization bind required
-- Validates: { ok: true } via validateReportSql
SELECT DISTINCT
  IFNULL(ei.full_name, '') AS full_name,
  IFNULL(ei.emp_number, '') AS emp_number,
  ei.organization,
  IFNULL(ROUND(ei.tap * 100), '') AS tap,
  IFNULL(ei.classroom_assignment, '') AS classroom,
  ei.pos_number,
  ei.pos_name,
  IFNULL(ei.contract_id, '') AS contract_type,
  IFNULL(ei.tenure_desc, '') AS contract_desc,
  IFNULL(ei.tenure_code, '') AS contract_code,
  IFNULL(ei.contract_end, '') AS contract_end
FROM employee_info ei
WHERE ei.organization = :organization
  AND ei.contract_id IS NOT NULL
  AND ei.tap = 1
ORDER BY ei.full_name;

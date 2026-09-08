SELECT DISTINCT
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_end, '') AS contract_end,
  IFNULL(e.tap, '') AS tap,
  pi.pos_start,
  pi.pos_ending,
  pi.pos_number,
  COALESCE(pi.fund, '') || '-' || COALESCE(pi.purpose, '') || '-' || COALESCE(pi.program, '') || '-' || COALESCE(pi.object, '') || '-' || COALESCE(pi.level, '') || '-' || COALESCE(pi.cost_center, '') AS account_number,
  c.certification_type,
  c.cert_expiration,
  pi.pos_name,
  IFNULL(e.classroom_assignment, '') AS classroom,
  pi.months AS months_available,
  IFNULL(e.a_months, 0) AS months_used,
  IFNULL(e.mailstop, '') AS mailstop,
  pi.organization,
  e.Last_PersonNum_In_Position,
  e.Last_PersonNAME_In_Position,
  e.Result_Type
FROM position_info pi
LEFT JOIN (
  SELECT full_name, ei.emp_number, ei.tap, ei.classroom_assignment, ei.a_months, ei.tenure_code, ei.contract_id, ei.contract_end, ei.pos_number, ei.mailstop, ei.person_id, ei.Last_PersonNum_In_Position, ei.Last_PersonNAME_In_Position, ei.Result_Type
  FROM employee_info_future ei
) e ON IFNULL(pi.pos_number, 0) = IFNULL(e.pos_number, 0)
LEFT JOIN (
  SELECT crt.person_id, crt.certification_type, crt.cert_expiration FROM cert_info crt
) c ON IFNULL(e.person_id, 0) = IFNULL(c.person_id, 0)
WHERE (pi.pos_ending > date('now') OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%')
  AND ((pi.pos_number LIKE '999%' AND e.full_name > ' ') OR pi.pos_number < '9990000')
  AND pi.organization = :organization
ORDER BY pi.object, pi.pos_name

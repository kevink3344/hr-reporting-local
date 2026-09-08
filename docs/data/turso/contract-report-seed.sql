-- Contract Report seed — Test Oak Elementary
-- Makes the contract report return rows: tap=1 + contract_id NOT NULL
-- Idempotent: safe to re-apply
UPDATE employee_info SET tap = 1, contract_id = 'CONT-10M', tenure_code = 'T10', contract_end = '2027-06-30' WHERE person_id = 10001;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-12M', tenure_code = 'T12', contract_end = '2027-06-30' WHERE person_id = 10002;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-11M', tenure_code = 'T11', contract_end = '2027-06-30' WHERE person_id = 10003;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-10M', tenure_code = 'T10', contract_end = '2027-06-30' WHERE person_id = 10004;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-10M', tenure_code = 'T10', contract_end = '2027-06-30' WHERE person_id = 10005;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-10M', tenure_code = 'T10', contract_end = '2028-06-30' WHERE person_id = 10016;
UPDATE employee_info SET tap = 1, contract_id = 'CONT-10M', tenure_code = 'T10', contract_end = '2028-06-30' WHERE person_id = 10020;
-- Leave 10024, 10028, 10032 as tap=100 / contract_id NULL to demonstrate filtering (3 non-matching rows)

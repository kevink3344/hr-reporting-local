# Certification Report SQL

# SQL for main report
select * from employee_info where organization = :organization and object < '140' and primary_flag = 'Y' order by cost_center , object , full_name

# Columns for main report
full_name | assignment | track | classroom | position_name | position_no | contract_renewal | contract_type | contract_desc | contract_end | expires | renewal_cycle_start | renewal_cycle_end | nbpts_expires

# SQL for subreport
select distinct * from cert_area where person_id = :person_id order by cert_area

# Columns for subreport
area | area_desc | years | program | nclb_code
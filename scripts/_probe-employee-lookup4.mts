// Exercises the REAL repository implementation (not a copy of its SQL) against
// the live MySQL database, so the shipped predicate is what gets verified.
import { mysqlRepositories } from '../src/repositories/mysql-repository.js';

console.log(`data source people repo: ${typeof mysqlRepositories.people.findByEmployeeNumber}`);

// A known-good number (repeated 6x, so it also exercises the ORDER BY tie-break).
const hit = await mysqlRepositories.people.findByEmployeeNumber('149098');
console.log('HIT  ->', JSON.stringify(hit, null, 2));

// Leading-zero number: proves the string compare keeps the zeros.
const zero = await mysqlRepositories.people.findByEmployeeNumber('022033');
console.log('ZERO ->', JSON.stringify(zero));

// A miss must be null, not a throw, so the route can answer found:false.
const miss = await mysqlRepositories.people.findByEmployeeNumber('999999');
console.log('MISS ->', JSON.stringify(miss));

// Shape check: the 6-digit regex the route enforces means a 5-digit number
// should simply never reach here, but confirm it does not accidentally match.
const short = await mysqlRepositories.people.findByEmployeeNumber('14909');
console.log('SHORT->', JSON.stringify(short));

// Timing on the real code path.
const started = Date.now();
for (let i = 0; i < 5; i += 1) await mysqlRepositories.people.findByEmployeeNumber('149098');
console.log(`5 lookups in ${Date.now() - started} ms`);

const contractFallback = await mysqlRepositories.people.findByEmployeeNumber('149098');
console.log('contractType resolved to:', JSON.stringify(contractFallback?.contractType));
console.log('hireDate resolved to:', JSON.stringify(contractFallback?.hireDate));

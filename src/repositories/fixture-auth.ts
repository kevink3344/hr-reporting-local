import type { FixtureUser, Person, School } from '../types.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataDirectory = resolve(process.cwd(), 'docs', 'data');

async function readUsers(): Promise<FixtureUser[]> {
  const contents = await readFile(resolve(dataDirectory, 'users.json'), 'utf8');
  return JSON.parse(contents) as FixtureUser[];
}

async function readPeople(): Promise<Person[]> {
  const contents = await readFile(resolve(dataDirectory, 'people.json'), 'utf8');
  return JSON.parse(contents) as Person[];
}

async function readSchools(): Promise<School[]> {
  const contents = await readFile(resolve(dataDirectory, 'schools.json'), 'utf8');
  return JSON.parse(contents) as School[];
}

export async function authenticateFixtureUser(wakeId: string, employeeNumber: string) {
  const [users, people, schools] = await Promise.all([readUsers(), readPeople(), readSchools()]);
  const user = users.find((candidate) => candidate.wakeId.toLowerCase() === wakeId.toLowerCase() && candidate.employeeNumber === employeeNumber);
  if (!user) return null;

  const person = people.find((candidate) => candidate.employeeNumber === user.employeeNumber);
  if (!person) return null;
  const school = schools.find((candidate) => candidate.id === person.organizationId);
  if (!school) return null;

  return {
    user: {
      id: user.id,
      wakeId: user.wakeId,
      displayName: user.displayName,
      email: user.email,
      roles: user.roles,
      schoolIds: user.schoolIds,
      canViewAllSchools: user.canViewAllSchools
    },
    person,
    school
  };
}
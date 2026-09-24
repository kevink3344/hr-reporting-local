// Scratch structural check for the OpenAPI document: every `$ref` must resolve
// and every operation must carry a tag that the document declares.
import { openApiDocument } from '../src/openapi.js';

const doc = openApiDocument as unknown as {
  tags: { name: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; parameters: Record<string, unknown> };
};

const declaredTags = new Set(doc.tags.map((tag) => tag.name));
const problems: string[] = [];

function walk(node: unknown, where: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, `${where}[${index}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      const match = /^#\/components\/(\w+)\/(.+)$/.exec(value);
      if (!match) {
        problems.push(`${where}: unparseable $ref ${value}`);
      } else {
        const [, section, name] = match;
        const bucket = (doc.components as Record<string, Record<string, unknown>>)[section];
        if (!bucket || !(name in bucket)) problems.push(`${where}: dangling $ref ${value}`);
      }
    } else {
      walk(value, `${where}.${key}`);
    }
  }
}

let operations = 0;
for (const [path, item] of Object.entries(doc.paths)) {
  walk(item, path);
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;
    operations += 1;
    const tags = (op as { tags?: string[] }).tags ?? [];
    for (const tag of tags) {
      if (!declaredTags.has(tag)) problems.push(`${method.toUpperCase()} ${path}: undeclared tag ${tag}`);
    }
    if (tags.length === 0) problems.push(`${method.toUpperCase()} ${path}: no tag`);
    if (!(op as { operationId?: string }).operationId) {
      problems.push(`${method.toUpperCase()} ${path}: no operationId`);
    }
  }
}

const lines = [
  `paths=${Object.keys(doc.paths).length} operations=${operations} tags=${doc.tags.length}`,
  `schemas=${Object.keys(doc.components.schemas).length} parameters=${Object.keys(doc.components.parameters).length}`,
  problems.length === 0 ? 'OK: no problems' : problems.map((p) => `PROBLEM ${p}`).join('\n')
];
console.log(lines.join('\n'));
if (problems.length > 0) process.exitCode = 1;

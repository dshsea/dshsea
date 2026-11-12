// Validates data/projects/*.yaml. Runs in CI on every PR and before every build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects } from './lib/load-projects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { projects, errors } = loadProjects(root);

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s) in data/projects:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nSee CONTRIBUTING.md for the entry format.\n');
  process.exit(1);
}
console.log(`✓ ${projects.length} creatures in the ocean, all valid.`);

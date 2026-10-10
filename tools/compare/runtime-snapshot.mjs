import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, fileHash } from '../oracle/trace-build-info.mjs';

// Follow actual static relative imports so a newly connected core service cannot
// silently fall outside a differential report's source identity.
export function runtimeSnapshot(entries, extraFiles = []) {
  const files = new Set();
  function visit(name) {
    name = path.relative(root, path.resolve(root, name));
    if (name.startsWith('..') || path.isAbsolute(name)) throw new Error('Snapshot dependency leaves repository');
    if (files.has(name)) return;
    files.add(name);
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) return;
    const source = readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
      visit(path.relative(root, path.resolve(root, path.dirname(name), match[1])));
    }
  }
  entries.forEach(visit);extraFiles.forEach(name => files.add(name));
  files.add('tools/compare/runtime-snapshot.mjs');
  return [...files].sort().map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
}

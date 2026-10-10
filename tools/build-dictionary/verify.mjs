import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDictionary } from './build.mjs';
import { root, fileHash } from '../oracle/trace-build-info.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/dictionary-regeneration-'));
const manifest = buildDictionary({ output }), files = ['en_dict.bin', 'manifest.json', 'profile.js'];
for (const name of files) assert.deepEqual(readFileSync(path.join(output, name)), readFileSync(path.join(root, 'data/dictionary', name)), `Regenerated dictionary ${name}`);
const loaded = loadDictionary(new Uint8Array(readFileSync(path.join(output, 'en_dict.bin'))), manifest);
assert.equal(loaded.entryCount, 7792);assert.equal(loaded.groups2Used, 72);
const report = { schemaVersion: 1, status: 'passed', kind: 'dictionary-deterministic-regeneration', byteLength: manifest.byteLength,
  upstreamCommit: manifest.upstreamCommit, dataFingerprint: manifest.dataFingerprint, entryCount: loaded.entryCount,
  files: files.map(name => ({ path: 'data/dictionary/' + name, sha256: fileHash(path.join(output, name)) })) };
writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: original dictionary bytes and generated profile regenerate exactly. Report: ${output}/report.json`);

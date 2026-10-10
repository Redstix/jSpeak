import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root, config, sha256, fileHash } from '../oracle/trace-build-info.mjs';
import { createRulesOracle } from '../oracle/rules.mjs';
import { rulesInputs } from '../oracle/rules-build-info.mjs';
const envelope = createRulesOracle()();
const { letterBits, letterGroups, removeAccent, ...profile } = envelope.profile;
const module = '// Original initialized en-us rule options and raw letter/accent data. GPL-3.0-or-later.\n' +
  '// Copyright (C) 2005-2015 Jonathan Duddington; see licenses/espeak-ng/COPYING.txt.\n' +
  'export var RULE_PROFILE = Object.freeze(' + JSON.stringify(profile) + ');\n' +
  'export var LETTER_BITS = new Uint8Array(' + JSON.stringify(letterBits) + ');\n' +
  'export var LETTER_GROUPS = Object.freeze(' + JSON.stringify(letterGroups) + '.map(function (row) { return row === null ? null : Object.freeze(row); }));\n' +
  'export var REMOVE_ACCENT = new Uint8Array(' + JSON.stringify(removeAccent) + ');\n';
const directory = path.join(root, 'data/rules');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'profile.js'), module);
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'initialized-en-us-rules-profile', upstreamCommit: config.commit,
  reference: envelope.reference, inputs: rulesInputs(), generatorSha256: fileHash(fileURLToPath(import.meta.url)), profile,
  moduleSha256: sha256(module), license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt' }, null, 2) + '\n');
console.log(JSON.stringify({ ...profile, letterBits: letterBits.length, letterGroups, removeAccentBytes: removeAccent.length }));

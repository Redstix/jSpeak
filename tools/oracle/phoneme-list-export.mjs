import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {root,config,fileHash,sha256} from './trace-build-info.mjs';
import {createPhonemeListOracle} from './phoneme-list.mjs';
import {phonemeListInputs} from './phoneme-list-build-info.mjs';
const envelope=createPhonemeListOracle()(),{constants,...profile}=envelope.profile;
const module='// Original TranslateWord2 list layout and initialized en-us profile. GPL-3.0-or-later.\n'+
  '// Copyright (C) 2005-2015 Jonathan Duddington; see licenses/espeak-ng/COPYING.txt.\n'+
  'export var PHONEME_LIST_PROFILE = Object.freeze('+JSON.stringify(profile)+');\n'+
  'export var PHONEME_LIST_CONSTANTS = Object.freeze('+JSON.stringify(constants)+');\n';
const directory=path.join(root,'data/phoneme-list');mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'profile.js'),module);
writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,kind:'initialized-en-us-phoneme-list',upstreamCommit:config.commit,reference:envelope.reference,inputs:phonemeListInputs(),generatorSha256:fileHash(fileURLToPath(import.meta.url)),profile,constants,moduleSha256:sha256(module),license:'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt'},null,2)+'\n');
console.log(JSON.stringify({profile,constants}));

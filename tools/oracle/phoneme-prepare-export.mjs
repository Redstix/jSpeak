import {mkdirSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {root,config,fileHash,sha256} from './trace-build-info.mjs';import {createPhonemePrepareOracle} from './phoneme-prepare.mjs';import {phonemePrepareInputs} from './phoneme-prepare-build-info.mjs';
const envelope=createPhonemePrepareOracle()(),{replacements,constants,...profile}=envelope.profile;
const module='// Original initialized en-us MakePhonemeList preparation data. GPL-3.0-or-later.\n'+
'// Copyright (C) 2005-2014 Jonathan Duddington; 2015-2016 Reece H. Dunn.\n'+
'// See licenses/espeak-ng/COPYING.txt.\n'+
'export var PHONEME_PREPARE_PROFILE = Object.freeze('+JSON.stringify(profile)+');\n'+
'export var VOICE_PHONEME_REPLACEMENTS = Object.freeze('+JSON.stringify(replacements)+'.map(function(row){return Object.freeze(row);}));\n'+
'export var PHONEME_PREPARE_CONSTANTS = Object.freeze('+JSON.stringify(constants)+');\n';
const directory=path.join(root,'data/phoneme-prepare');mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'profile.js'),module);
writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,kind:'initialized-en-us-phoneme-preparation',upstreamCommit:config.commit,reference:envelope.reference,inputs:phonemePrepareInputs(),generatorSha256:fileHash(fileURLToPath(import.meta.url)),profile,replacements,constants,moduleSha256:sha256(module),license:'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt'},null,2)+'\n');console.log(JSON.stringify({profile,replacements}));

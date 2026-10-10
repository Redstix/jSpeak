import assert from'node:assert/strict';import{readFileSync,mkdirSync,writeFileSync}from'node:fs';import{fileURLToPath}from'node:url';import path from'node:path';
import{root,config,sha256,fileHash}from'../oracle/trace-build-info.mjs';import{createWordEndingOracle}from'../oracle/word-ending.mjs';import{wordEndingInputs}from'../oracle/word-ending-build-info.mjs';
const envelope=createWordEndingOracle()(),source=readFileSync(path.join(root,'upstream/espeak-ng/src/libespeak-ng/dictionary.c'),'utf8');
function strings(name){const body=source.match(new RegExp('static const char \\* const '+name+'\\[\\] = \\{([\\s\\S]*?)\\};'))?.[1];assert(body,'Missing ending source table');const text=body.replace(/\/\/[^\n]*/g,'');const tokens=text.split(',').map(s=>s.trim()).filter(Boolean);assert.equal(tokens.pop(),'NULL');return tokens.map(token=>{assert(/^"[a-z]+"$/.test(token),'Unknown ending table literal');return token.slice(1,-1);});}
const exceptions=strings('add_e_exceptions'),additions=strings('add_e_additions');
const module='// Initialized en-us ending options and exact source exception/addition tables. GPL-3.0-or-later.\n'+
  '// Copyright (C) 2005-2015 Jonathan Duddington; see licenses/espeak-ng/COPYING.txt.\n'+
  'export var WORD_ENDING_PROFILE = Object.freeze('+JSON.stringify(envelope.profile)+');\n'+
  'export var ADD_E_EXCEPTIONS = Object.freeze('+JSON.stringify(exceptions)+');\n'+
  'export var ADD_E_ADDITIONS = Object.freeze('+JSON.stringify(additions)+');\n';
const directory=path.join(root,'data/word-ending');mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'profile.js'),module);
writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,kind:'initialized-en-us-word-ending',upstreamCommit:config.commit,reference:envelope.reference,inputs:wordEndingInputs(),generatorSha256:fileHash(fileURLToPath(import.meta.url)),profile:envelope.profile,exceptions,additions,moduleSha256:sha256(module),license:'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt'},null,2)+'\n');console.log(JSON.stringify({profile:envelope.profile,exceptions,additions}));

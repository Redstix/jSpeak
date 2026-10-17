import { loadDictionary } from './dictionary.js';
import { createEnglishClauseTranslation } from './translate-clause.js';
import { selectPhonemeTable } from './phoneme-table.js';
import { preparePhonemeList } from './phoneme-list-prepare.js';
import { createPhonemeListMaker } from './make-phoneme-list.js';
import { createPitchCalculator } from './calc-pitches.js';
import { createLengthCalculator } from './calc-lengths.js';
import { createGenerateEventPlanner } from './generate-events.js';
import { createWaveGenerator } from './wave-generator.js';
import { createWaveCommandPlanner } from './wave-command-planner.js';
import { createArrayCommandSource, createBoundedSynthesisRuntime } from './synthesis-runtime.js';
import { codePointsToString, decodeUtf8 } from './unicode.js';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_CLAUSES = 256;

function encodeUtf8(text) {
  const bytes = [];
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const width = codePoint > 0xffff ? 2 : 1;
    index += width;
    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 63));
    else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 63), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63));
  }
  return Uint8Array.from(bytes);
}

function mnemonicBytes(phoneme) {
  const bytes = [];
  let mnemonic = phoneme.mnemonic;
  while ((mnemonic & 0xff) !== 0) {
    const value = mnemonic & 0xff;
    if (value === 0x2f) break;
    bytes.push(value);
    mnemonic >>>= 8;
  }
  return bytes;
}

function translatedPhonemeString(list, count, table) {
  const bytes = [];
  const stressChars = '==,,\'\'';
  for (let index = 1; index < count - 2; index++) {
    const phoneme = table.entries[list.phonemeId[index] - 1];
    if (!phoneme) throw new Error('Translated phoneme list contains an invalid phoneme');
    const phonemeBytes = phoneme.code === 15 ? [] : mnemonicBytes(phoneme);
    if ((list.newword[index] & 1) !== 0 &&
        (list.newword[index] & (4 | 8)) === 0) bytes.push(32);
    if ((list.synthflags[index] & 4) !== 0 && list.stresslevel[index] > 1) {
      const stress = Math.min(list.stresslevel[index], 5);
      const marker = stressChars.charCodeAt(stress);
      if (marker !== 61) bytes.push(marker);
    }
    bytes.push(...phonemeBytes);
    if (phoneme.code !== 21) {
      if ((list.synthflags[index] & 8) !== 0) bytes.push(...mnemonicBytes(table.entries[12]));
      if ((list.synthflags[index] & 4) !== 0 && list.type[index] !== 2) bytes.push(...mnemonicBytes(table.entries[20]));
      if (list.tonePh[index] > 0) {
        const tonePhoneme = list.tonePhId[index] ? table.entries[list.tonePhId[index] - 1] : table.entries[list.tonePh[index]];
        if (tonePhoneme) bytes.push(...mnemonicBytes(tonePhoneme));
      }
    }
  }
  return codePointsToString(decodeUtf8(Uint8Array.from(bytes), { termination: 'bounded' }));
}

function createWav(pcm) {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  writeText(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 22050, true); view.setUint32(28, 44100, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

export function createLanguageSynthesizer({
  profile, voiceState, dictionaryBytes, phontabBytes, phonindexBytes, phondataBytes
}) {
  const arrays = { dictionaryBytes, phontabBytes, phonindexBytes, phondataBytes };
  for (const [name, value] of Object.entries(arrays)) {
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected complete ' + name + ' Uint8Array');
  }
  if (!profile || typeof profile !== 'object') throw new TypeError('Expected explicit language synthesis profile');
  if (!voiceState || voiceState.sampleRate !== 22050) throw new TypeError('Expected fixed 22050Hz voice state');
  const table = selectPhonemeTable(phontabBytes, profile.phonemeListProfile.phonemeTable);
  const dictionary = loadDictionary(dictionaryBytes, profile.dictionaryManifest);
  const eventPlanner = createGenerateEventPlanner(phonindexBytes, table, { phondataBytes });
  const commandPlanner = createWaveCommandPlanner(phondataBytes, table, { voice: voiceState });
  const pitchCalculator = createPitchCalculator(table, profile.pitchCalculatorProfile);
  const lengthCalculator = createLengthCalculator(table, profile.prosodyProfile);
  const phonemeMaker = createPhonemeListMaker(phonindexBytes, table, profile.phonemePrepareProfile);

  function synthesize(text) {
    const input = typeof text === 'string' ? encodeUtf8(text) : text;
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected text string or UTF-8 bytes');
    if (input.length > MAX_INPUT_BYTES) {
      const error = new Error('Input exceeds bounded profile: ' + MAX_INPUT_BYTES + ' bytes');
      error.code = 'JSPEAK_INPUT_LIMIT'; throw error;
    }
    const translation = createEnglishClauseTranslation(input, dictionary, table, { profile });
    const commands = [];
    const phonemeLines = [];
    let clauseCount = 0;
    while (translation.hasMore()) {
      if (++clauseCount > MAX_CLAUSES) {
        const error = new Error('Input exceeds bounded clause profile: ' + MAX_CLAUSES);
        error.code = 'JSPEAK_INPUT_LIMIT'; throw error;
      }
      const clause = translation.next();
      const source = clause.phonemes.list;
      const list = { length: source.length, phcode: new Uint8Array(1000), stresslevel: new Uint8Array(1000),
        wordstress: new Uint8Array(1000), tonePh: new Uint8Array(1000), sourceix: new Uint16Array(1000),
        synthflags: new Uint16Array(1000) };
      for (const key of ['phcode', 'stresslevel', 'wordstress', 'tonePh', 'sourceix', 'synthflags']) {
        list[key].set(source[key].subarray(0, source.length));
      }
      const prepared = preparePhonemeList(list, table, profile.phonemePrepareProfile);
      const made = phonemeMaker.make(prepared, { postPause: clause.clausePause, startSentence: clause.startSentence });
      const pitched = pitchCalculator.calculate(made.list, made.count, clause.tone);
      const lengthened = lengthCalculator.calculate(pitched.list, pitched.count,
        { list: clause.phonemes.state.embeddedList, index: 0 });
      phonemeLines.push(translatedPhonemeString(lengthened.list, lengthened.count, table));
      const events = eventPlanner.plan(lengthened.list, lengthened.count,
        { list: clause.phonemes.state.embeddedList, clauseStartChar: clause.startCharacter,
          countCharacters: 0, countSentences: 0, clauseStartWord: clause.startWord - 1 });
      const producedCommands = commandPlanner.process(events);
      for (let index = 0; index < producedCommands.length; index++) commands.push(producedCommands[index]);
    }
    const inputBytes = input.length;
    const phonemeText = phonemeLines.join('\n');
    if (!commands.length) return { commands, sampleCount: 0, inputBytes, clauseCount, phonemeText };
    return { commands, voice: voiceState, sampleRate: 22050, clauseCount, inputBytes, phonemeText };
  }

  function synthesizePcm(text, options) {
    const planned = synthesize(text);
    const opts = options || {};
    return new Promise((resolve, reject) => {
      if (!planned.commands.length) {
        resolve({ pcm: new Int16Array(0), sampleCount: 0, stats: planned }); return;
      }
      const commands = planned.commands;
      for (let index = 0; index < commands.length; index++) {
        const command = commands[index];
        if (command.b !== null && typeof command.b === 'number' && (command.type & 0xff) === 9) {
          command.b = { envelope: command.b };
        }
      }
      let pcm = new Int16Array(0);
      let sampleCount = 0;
      const runtime = createBoundedSynthesisRuntime({
        createCommandSource: () => createArrayCommandSource(commands, {
          inputBytes: planned.inputBytes,
          codePoints: typeof text === 'string' ? text.length : planned.inputBytes,
          clauses: planned.clauseCount
        }),
        createWaveGenerator: () => createWaveGenerator({ voice: voiceState, phondataBytes, randomSeed: 1 }),
        onAudio(chunk) {
          const produced = chunk.samples.length;
          if (sampleCount + produced > pcm.length) {
            const grown = new Int16Array(Math.max(produced, pcm.length * 2));
            grown.set(pcm);
            pcm = grown;
          }
          pcm.set(chunk.samples, sampleCount);
          sampleCount += produced;
          chunk.release();
        },
        onEnd(stats) { resolve({ pcm, sampleCount, stats: { ...stats, clauseCount: planned.clauseCount, phonemeText: planned.phonemeText } }); },
        onError(error) { reject(error); },
        onCancel() { reject(new Error('Synthesis canceled')); },
        scheduler: opts.scheduler || (callback => setTimeout(() => {
          if (opts.shouldContinue && !opts.shouldContinue()) runtime.cancel();
          else callback();
        }, 0)),
      });
      runtime.start();
    });
  }

  async function synthesizeWav(text, options) {
    const result = await synthesizePcm(text, options);
    result.pcm = result.pcm.subarray(0, result.sampleCount);
    result.wav = createWav(result.pcm);
    return result;
  }

  return { synthesize, synthesizePcm, synthesizeWav,
    profile: { voice: profile.voice, sampleRate: 22050, maxInputBytes: MAX_INPUT_BYTES, maxClauses: MAX_CLAUSES } };
}

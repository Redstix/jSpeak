// Composition of original en-us services. Caller supplies already loaded data.
import { createDictionarySession } from './dictionary.js';
import { createLetterAccentLookup } from './letter-accent.js';
import { createDictionaryRulesSession, RULE_PROFILE } from './dictionary-rules.js';
import { createWordStressSession } from './word-stress.js';
import { WORD_STRESS_PROFILE } from '../../data/stress/profile.js';
import { createCharacterNames } from './character-names.js';
import { createLetterNames } from './letter-names.js';

export function createEnglishTextServices(dictionary, selectedTable, options) {
  var opts = options || {}, accent, rules, letters;
  var stressProfile = opts.stressProfile || WORD_STRESS_PROFILE;
  var session = createDictionarySession(dictionary, {
    dictCondition: opts.initialState && opts.initialState.dictCondition,
    textmode: opts.ruleProfile ? opts.ruleProfile.textmode === 1 : false,
    lookupAccentedLetter: function (cp, initial) { return accent(cp, initial); }
  });
  var stress = createWordStressSession(selectedTable, stressProfile);
  var initial = opts.initialState || {}, dictionaryInitial = {};
  for (var key of ['repeatCount', 'repeat', 'skipWords']) if (initial[key] !== undefined) dictionaryInitial[key] = initial[key];
  session.setState(dictionaryInitial);
  var dictionaryContext = {};
  for (var field of ['dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags', 'clauseTerminator']) if (initial[field] !== undefined) dictionaryContext[field] = initial[field];
  if (initial.prevDictFlags0 !== undefined && initial.prevDictFlags === undefined) dictionaryContext.prevDictFlags = initial.prevDictFlags0;
  session.setContext(dictionaryContext);
  if (initial.prevLastStress !== undefined) stress.setState({ prevLastStress: initial.prevLastStress });
  function translateRules(buffer, context) {
    var inherited = session.context();
    var source = buffer, offset = context.offset;
    if (offset < 3) {
      var guard = 3 - offset;source = new Uint8Array(buffer.length + guard);source.set(buffer, guard);offset += guard;
    }
    return rules.translateBuffer(source, offset, {
      wordFlags: context.wordFlags, phSize: context.capacity, phonemes: context.phonemes, endPhonemesEnabled: false,
      dictCondition: inherited.dictCondition, expectVerb: inherited.expectVerb }).phonemes;
  }
  accent = createLetterAccentLookup(session, { translateRules: translateRules, translateWord: opts.translateWord });
  letters = createLetterNames(accent, stress, { translateRules: translateRules });
  rules = createDictionaryRulesSession(dictionary, selectedTable, opts.ruleProfile || RULE_PROFILE, {
    dictionarySession: session,
    ruleData: opts.ruleData,
    lookup: function (key) { return accent.lookupSymbol(key).phonemes; },
    lookupLetter: function (codepoint, context) { return letters.lookupLetter(codepoint, context); }
  });
  if (typeof rules.setState === 'function') {
    var ruleInitial = {};
    for (var ruleKey of ['wordVowelCount', 'wordStressedCount', 'prePause']) if (initial[ruleKey] !== undefined) ruleInitial[ruleKey] = initial[ruleKey];
    rules.setState(ruleInitial);
  } else if (initial.wordVowelCount !== undefined || initial.wordStressedCount !== undefined || initial.prePause !== undefined) throw new Error('Rule state injection is not implemented');
  return { dictionary: session, accent: accent, rules: rules, letters: letters, stress: stress,
    characterNames: createCharacterNames(session, selectedTable, stress, { translateRules: translateRules }) };
}

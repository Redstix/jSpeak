// Shared text and word translation state with the original recursive Lookup edge.
import { createEnglishTextServices } from './text-services.js';
import { createWordTranslationSession } from './translate-word.js';

export function createEnglishWordServices(dictionary, selectedTable, options) {
  var opts = options || {}, words;
  var services = createEnglishTextServices(dictionary, selectedTable, {
    ruleProfile: opts.ruleProfile,
    ruleData: opts.ruleData,
    stressProfile: opts.stressProfile,
    initialState: opts.initialState,
    translateWord: function (buffer, context) { return words.translateLookup(buffer, context); }
  });
  words = createWordTranslationSession(services, selectedTable, { ...opts.initialState, profile: opts.wordTranslationProfile });
  services.wordTranslation = words;
  return services;
}

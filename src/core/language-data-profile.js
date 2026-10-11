const UPSTREAM_COMMIT = 'ba90c8e9f440ad544f674a790bb5f53878b6ffc5';

export const LANGUAGE_DATA_PROFILES = Object.freeze({
  'en-us': Object.freeze({
    voice: 'en-us',
    upstreamCommit: UPSTREAM_COMMIT,
    scope: 'en-us-candidate-probe',
    runtimeFiles: Object.freeze(['en_dict', 'intonations', 'lang/gmw/en-US', 'phondata', 'phonindex', 'phontab']),
    sourceInputs: Object.freeze([]),
    jsRuntimeStatus: 'partial-m12',
    closureComplete: false
  }),
  cmn: Object.freeze({
    voice: 'cmn',
    upstreamCommit: UPSTREAM_COMMIT,
    scope: 'cmn-candidate-probe',
    runtimeFiles: Object.freeze(['cmn_dict', 'intonations', 'lang/sit/cmn', 'phondata', 'phonindex', 'phontab']),
    sourceInputs: Object.freeze(['dictsource/cmn_list', 'dictsource/cmn_rules', 'dictsource/cmn_emoji']),
    jsRuntimeStatus: 'unsupported',
    unsupportedReason: 'M12 en-us JS text→command integration is not C-exact and only the CalcPitches_Tone cmn slice is accepted; the full cmn frontend is not implemented',
    explicitUnsupportedInputs: Object.freeze(['[[en-us]] language switch without en_dict in the standalone cmn data profile']),
    closureComplete: false
  })
});

export function selectLanguageDataProfile(voice) {
  const profile = LANGUAGE_DATA_PROFILES[voice];
  if (!profile) {
    const error = new Error('Unsupported language data profile: ' + voice);
    error.code = 'JSPEAK_LANGUAGE_PROFILE_UNSUPPORTED';
    throw error;
  }
  return profile;
}

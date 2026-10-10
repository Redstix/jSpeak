/* Observation/initialization scaffolding only; no translation algorithms. */
#ifndef JSPEAK_WORD_SHARED_H
#define JSPEAK_WORD_SHARED_H
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"
#include "translateword.h"
#include "synthdata.h"
#include "phoneme.h"
#include "readclause.h"

static inline void word_hex_bytes(FILE *out, const char *bytes, size_t length) {
    fputc('"', out); for (size_t i = 0; i < length; i++) fprintf(out, "%02x", (unsigned char)bytes[i]); fputc('"', out);
}
static inline void word_hex(FILE *out, const char *bytes) { word_hex_bytes(out, bytes, strlen(bytes)); }
static inline void word_wtab(FILE *out, const WORD_TAB *words, int count) {
    fputc('[', out);
    for (int i = 0; i < count; i++) fprintf(out, "%s{\"flags\":%u,\"start\":%u,\"prePause\":%u,\"sourceix\":%u,\"length\":%u}", i ? "," : "", words[i].flags, words[i].start, words[i].pre_pause, words[i].sourceix, words[i].length);
    fputc(']', out);
}
static inline void word_state(FILE *out, Translator *tr, const char *word) {
    uintptr_t start = (uintptr_t)word, end = (uintptr_t)translator->clause_end;
    size_t size = strlen(word);
    fprintf(out, "{\"dictCondition\":%u,\"expectVerb\":%d,\"expectVerbS\":%d,\"expectNoun\":%d,\"expectPast\":%d,\"prevDictFlags0\":%u,\"prevDictFlags1\":%u,\"clauseTerminator\":%u,\"clauseEnd\":",
        tr->dict_condition, tr->expect_verb, tr->expect_verb_s, tr->expect_noun, tr->expect_past, (unsigned)tr->prev_dict_flags[0], (unsigned)tr->prev_dict_flags[1], (unsigned)translator->clause_terminator);
    if (end >= start && end <= start + size) fprintf(out, "%zu", (size_t)(end - start)); else fputs("null", out);
    fprintf(out, ",\"clauseEndRelation\":\"%s\",\"clauseLowerCount\":%d,\"clauseUpperCount\":%d,\"prePause\":%d,\"prevLastStress\":%d,\"prepauseTimeout\":%d,\"endStressedVowel\":%d,\"wordVowelCount\":%d,\"wordStressedCount\":%d,\"repeatCount\":%d,\"repeatHex\":",
        end < start ? "before-source" : end > start + size ? "after-source" : "in-source", tr->clause_lower_count, tr->clause_upper_count, pre_pause, tr->prev_last_stress,
        tr->prepause_timeout, tr->end_stressed_vowel, tr->word_vowel_count, tr->word_stressed_count, tr->phonemes_repeat_count);
    word_hex(out, tr->phonemes_repeat);
    fprintf(out, ",\"skipWords\":%d,\"optionSayas\":%d,\"optionCapitals\":%d,\"optionToneFlags\":%u,\"phonemeTable\":%d,\"native\":%s}", dictionary_skipwords, option_sayas, option_capitals, (unsigned)option_tone_flags, tr->phoneme_tab_ix, tr == translator ? "true" : "false");
}
static inline void word_profile(FILE *out) {
    fprintf(out, "{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"wordBytes\":%d,\"phonemeBytes\":%d,\"numbers\":%u,\"numbers2\":%u,\"stressFlags\":%u,\"prefixes\":%d,\"alt\":%d,\"unpronouncable\":%d,\"maxInitialConsonants\":%d,\"accents\":%d,\"ourAlphabet\":%d,\"altAlphabet\":%d,\"minRoman\":%d,\"maxRoman\":%d,\"spellingStress\":%s,\"OPTION_EMPHASIZE_ALLCAPS\":%u}",
        (unsigned)translator->translator_name, translator->phoneme_tab_ix, N_WORD_BYTES, N_WORD_PHONEMES, translator->langopts.numbers, translator->langopts.numbers2,
        translator->langopts.stress_flags, translator->langopts.param[LOPT_PREFIXES], translator->langopts.param[LOPT_ALT], translator->langopts.param[LOPT_UNPRONOUNCABLE],
        translator->langopts.max_initial_consonants, translator->langopts.accents, translator->langopts.our_alphabet, translator->langopts.alt_alphabet,
        translator->langopts.min_roman, translator->langopts.max_roman, translator->langopts.spelling_stress ? "true" : "false", OPTION_EMPHASIZE_ALLCAPS);
}
#endif

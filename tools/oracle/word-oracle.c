#include "translate.c"
#include "word-shared.h"
extern char word_phonemes[N_WORD_PHONEMES];
static void check(espeak_ng_STATUS s) { if (s != ENS_OK) { fprintf(stderr, "Initialization status %d\n", s); exit(70); } }
static uint32_t u32(void) { unsigned char b[4]; if (fread(b, 1, 4, stdin) != 4) exit(65); return (uint32_t)b[0] | (uint32_t)b[1]<<8 | (uint32_t)b[2]<<16 | (uint32_t)b[3]<<24; }
static void read_exact(void *p, size_t n) { if (fread(p, 1, n, stdin) != n) exit(65); }
int main(int argc, char **argv) {
    if (argc != 3 || (strcmp(argv[1], "profile") && strcmp(argv[1], "word") && strcmp(argv[1], "word3") && strcmp(argv[1], "withBounds"))) return 64;
    espeak_ng_InitializePath(argv[2]); check(espeak_ng_Initialize(NULL)); check(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL)); check(espeak_ng_SetVoiceByName("en-us"));
    check(espeak_ng_SetParameter(espeakRATE, 175, 0)); check(espeak_ng_SetParameter(espeakPITCH, 50, 0)); check(espeak_ng_SetParameter(espeakVOLUME, 100, 0));
    InitText(espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE); espeak_ng_SetRandSeed(1); SelectPhonemeTable(translator->phoneme_tab_ix);
    if (!strcmp(argv[1], "profile")) { word_profile(stdout); putchar('\n'); check(espeak_ng_Terminate()); return 0; }
    uint32_t size = u32(), offset = u32(), count = u32(), remaining = u32(), with_out = u32(), any = u32(), alphabet = u32(), initial_size = u32(), repeat_size = u32();
    if (size < 1 || size > 8192 || offset < 3 || offset >= size || count > 300 || remaining > count || with_out > 1 || any > 1 || initial_size >= N_WORD_PHONEMES || repeat_size > 19) return 65;
    if ((!strcmp(argv[1], "word") || !strcmp(argv[1], "withBounds")) && with_out && !count) return 65;
    if (!strcmp(argv[1], "word") && (remaining != 0 || alphabet != 0xffffffffu || any)) return 65;
    // Explicit caller state, in the same order as word.mjs:wordStateFields.
    translator->dict_condition = u32(); translator->expect_verb = (int)u32(); translator->expect_verb_s = (int)u32(); translator->expect_noun = (int)u32(); translator->expect_past = (int)u32();
    translator->prev_dict_flags[0] = (int)u32(); translator->prev_dict_flags[1] = (int)u32(); translator->clause_terminator = u32(); uint32_t clause_end = u32();
    translator->clause_lower_count = (int)u32(); translator->clause_upper_count = (int)u32(); pre_pause = (int)u32(); translator->prev_last_stress = (int)u32(); translator->prepause_timeout = (int)u32();
    translator->end_stressed_vowel = (int)u32(); translator->word_vowel_count = (int)u32(); translator->word_stressed_count = (int)u32(); translator->phonemes_repeat_count = (int)u32();
    dictionary_skipwords = (int)u32(); option_sayas = (int)u32(); option_capitals = (int)u32(); option_tone_flags = (int)u32();
    char text[8192 + 512] = {0}; read_exact(text, size);
    size_t source_size = strlen(text + offset);
    if (!source_size || source_size > 4096 || text[offset + source_size - 1] != ' ' || clause_end > source_size) return 65;
    translator->clause_end = text + offset + clause_end;
    char phonemes[N_WORD_PHONEMES] = {0}; read_exact(phonemes, initial_size); memcpy(word_phonemes, phonemes, sizeof(phonemes));
    memset(translator->phonemes_repeat, 0, sizeof(translator->phonemes_repeat)); read_exact(translator->phonemes_repeat, repeat_size);
    WORD_TAB words[300] = {{0}};
    for (uint32_t i = 0; i < count; i++) {
        uint32_t flags = u32(), start = u32(), pause = u32(), source = u32(), length = u32();
        if (start > 65535 || pause > 255 || source > 65535 || length > 255) return 65;
        words[i].flags = flags; words[i].start = start; words[i].pre_pause = pause; words[i].sourceix = source; words[i].length = length;
    }
    if (fgetc(stdin) != EOF) return 65;
    char out[N_WORD_BYTES + 1] = {0}; bool any_stressed = any != 0;
    fputs("{\"stateBefore\":", stdout); word_state(stdout, translator, text + offset); fputs(",\"wordsBefore\":", stdout); word_wtab(stdout, words, count);
    int flags;
    if (!strcmp(argv[1], "word")) {
        flags = TranslateWord(translator, text + offset, count ? words : NULL, with_out ? out : NULL);
        memcpy(phonemes, word_phonemes, sizeof(phonemes));
    } else if (!strcmp(argv[1], "withBounds")) {
        any_stressed_words = any != 0;
        current_alphabet = alphabet == 0xffffffffu ? NULL : (ALPHABET *)AlphabetFromChar((int)alphabet);
        flags = TranslateWordWithBounds(translator, text + offset, count ? words : NULL, remaining, with_out ? out : NULL, 0);
        any_stressed = any_stressed_words;
        memcpy(phonemes, word_phonemes, sizeof(phonemes));
    } else flags = TranslateWord3(translator, text + offset, count ? words : NULL, remaining, with_out ? out : NULL, &any_stressed,
        alphabet == 0xffffffffu ? NULL : (ALPHABET *)AlphabetFromChar((int)alphabet), phonemes, sizeof(phonemes));
    printf(",\"flags\":%u,\"phonemesHex\":", (unsigned)flags); word_hex(stdout, phonemes); fputs(",\"wordOutHex\":", stdout); if (with_out) word_hex(stdout, out); else fputs("null", stdout);
    fputs(",\"prefixAfterHex\":", stdout); word_hex_bytes(stdout, text + offset - 2, 2); fputs(",\"wordAfterHex\":", stdout); word_hex_bytes(stdout, text + offset, source_size);
    fputs(",\"bufferAfterHex\":", stdout); word_hex_bytes(stdout, text, size);
    fputs(",\"wordsAfter\":", stdout); word_wtab(stdout, words, count); fputs(",\"stateAfter\":", stdout); word_state(stdout, translator, text + offset);
    fputs(",\"anyStressedWords\":", stdout); if (!strcmp(argv[1], "word")) fputs("null", stdout); else fputs(any_stressed ? "true" : "false", stdout); puts("}");
    check(espeak_ng_Terminate()); return fflush(stdout) ? 74 : 0;
}

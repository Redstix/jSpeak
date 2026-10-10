/* The original source is included verbatim to expose raw static data, not
   copied or modified. Public TranslateRules runs with the clean library. */
#include "../../upstream/espeak-ng/src/libespeak-ng/dictionary.c"

static void oracle_require(espeak_ng_STATUS status)
{
    if (status != ENS_OK) { fprintf(stderr, "Initialize status %d\n", status); exit(70); }
}
static int oracle_digit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}
static size_t oracle_decode(char *output, const char *encoded, size_t capacity)
{
    size_t length = !strcmp(encoded, "-") ? 0 : strlen(encoded);
    if (length % 2 || length / 2 >= capacity) exit(65);
    for (size_t i = 0; i < length / 2; i++) {
        int a = oracle_digit(encoded[i * 2]), b = oracle_digit(encoded[i * 2 + 1]);
        if (a < 0 || b < 0) exit(65);
        output[i] = (char)(a * 16 + b);
    }
    output[length / 2] = 0;
    return strlen(output);
}
static void oracle_hex(const char *bytes, size_t length)
{
    putchar('"');
    for (size_t i = 0; i < length; i++) printf("%02x", (unsigned char)bytes[i]);
    putchar('"');
}
static void oracle_array(const unsigned char *bytes, size_t length)
{
    putchar('[');
    for (size_t i = 0; i < length; i++) printf("%s%u", i ? "," : "", bytes[i]);
    putchar(']');
}
static void oracle_profile(void)
{
    printf("{\"voice\":\"en-us\",\"translatorName\":%u,\"phonemeTable\":%d,\"dictCondition\":%u,\"letterBitsOffset\":%d,\"toneNumbers\":%d,\"suffix\":%d,\"diereses\":%d,\"bracketPause\":%d,\"bracketPauseAnnounced\":%d,\"altAlphabet\":%d,\"altAlphabetLanguage\":%d,\"optionSayas\":%d,\"letterBits\":",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, (unsigned)translator->dict_condition,
           translator->letter_bits_offset, translator->langopts.tone_numbers, translator->langopts.param[LOPT_SUFFIX],
           translator->langopts.param[LOPT_DIERESES], translator->langopts.param[LOPT_BRACKET_PAUSE],
           translator->langopts.param[LOPT_BRACKET_PAUSE_ANNOUNCED], translator->langopts.alt_alphabet, translator->langopts.alt_alphabet_lang, option_sayas);
    oracle_array(translator->letter_bits, sizeof(translator->letter_bits));
    fputs(",\"letterGroups\":[", stdout);
    for (int i = 0; i < 8; i++) {
        if (i) putchar(',');
        if (!translator->letter_groups[i]) fputs("null", stdout);
        else {
            putchar('[');
            for (int j = 0; translator->letter_groups[i][j]; j++) printf("%s%u", j ? "," : "", (unsigned)translator->letter_groups[i][j]);
            putchar(']');
        }
    }
    printf("],\"removeAccentLimit\":%u,\"removeAccent\":", N_REMOVE_ACCENT);
    oracle_array(remove_accent, sizeof(remove_accent));
    fputs("}", stdout);
}
int main(int argc, char **argv)
{
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]);
    oracle_require(espeak_ng_Initialize(NULL));
    oracle_require(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL));
    oracle_require(espeak_ng_SetVoiceByName("en-us"));
    SelectPhonemeTable(translator->phoneme_tab_ix);
    fputs("{\"profile\":", stdout); oracle_profile(); fputs(",\"results\":[", stdout);
    char line[20000], word_hex[16386], phonemes_hex[804], added_hex[804], prefix_hex[5];
    unsigned row = 0;
    while (fgets(line, sizeof(line), stdin)) {
        if (line[0] == 'A') {
            int capacity, vowels, stresses, pause, used = 0;
            if (sscanf(line, "A %d %d %d %d %803s %803s %n", &capacity, &vowels, &stresses, &pause, phonemes_hex, added_hex, &used) != 6 || line[used]) return 65;
            if (capacity < 1 || capacity > N_WORD_PHONEMES || ++row > 16384) return 65;
            char phonemes[404] = {0}, added[404] = {0};
            oracle_decode(phonemes, phonemes_hex, sizeof(phonemes)); oracle_decode(added, added_hex, sizeof(added));
            translator->word_vowel_count = vowels; translator->word_stressed_count = stresses; pre_pause = pause;
            AppendPhonemes(translator, phonemes, capacity, added);
            if (row > 1) putchar(',');
            fputs("{\"phonemesHex\":", stdout); oracle_hex(phonemes, strlen(phonemes));
            printf(",\"stateAfter\":{\"wordVowelCount\":%d,\"wordStressedCount\":%d,\"prePause\":%d}}", translator->word_vowel_count, translator->word_stressed_count, pre_pause);
            continue;
        }
        unsigned word_flags, dict_present, flags0, flags1, end_enabled, ph_size, condition;
        int expect_verb, pre_pause_initial, repeat, source_offset, used = 0;
        if (sscanf(line, "%u %u %u %u %u %u %u %d %d %d %16385s %803s %4s %d %n", &word_flags, &dict_present, &flags0, &flags1, &end_enabled, &ph_size, &condition, &expect_verb, &pre_pause_initial, &repeat, word_hex, phonemes_hex, prefix_hex, &source_offset, &used) != 14 || line[used]) return 65;
        if (dict_present > 1 || end_enabled > 1 || ph_size < 1 || ph_size > 200 || ++row > 16384) return 65;
        char source[8210] = {0}, phonemes[404] = {0}, ending[N_PHONEME_BYTES + 8] = {0};
        size_t length, buffer_length = 0, start = 3;
        if (source_offset >= 0) {
            buffer_length = strlen(word_hex) / 2;
            if (source_offset < 1 || (size_t)source_offset >= buffer_length || strcmp(prefix_hex, "-")) return 65;
            oracle_decode(source, word_hex, 8193); start = (size_t)source_offset;
            if (!memchr(source + start, 0, buffer_length - start)) return 65;
            length = strlen(source + start);
        } else {
        source[1] = source[2] = ' ';
        if (strcmp(prefix_hex, "-")) {
            char prefix[3] = {0};
            if (strlen(prefix_hex) != 4) return 65;
            oracle_decode(prefix, prefix_hex, sizeof(prefix)); source[0] = ' '; source[1] = prefix[0]; source[2] = prefix[1];
            for (int i = 0; i < 2; i++) {
                unsigned char c = (unsigned char)prefix[i];
                if (c >= 0xc0 && c <= 0xf7 && !(c <= 0xdf && i == 0 && (prefix[1] & 0xc0) == 0x80)) return 65;
            }
        }
        length = oracle_decode(source + 3, word_hex, 4097);
        source[3 + length] = ' ';
        }
        size_t ph_length = oracle_decode(phonemes, phonemes_hex, sizeof(phonemes));
        if (ph_length >= ph_size) return 65;
        translator->expect_verb = expect_verb;
        translator->dict_condition = (int)condition;
        translator->phonemes_repeat_count = repeat;
        translator->phonemes_repeat[0] = 0;
        translator->clause_end = source + start + length;
        pre_pause = pre_pause_initial;
        dictionary_skipwords = 0;
        unsigned flags[2] = {flags0, flags1};
        int ending_type = TranslateRules(translator, source + start, phonemes, (int)ph_size, end_enabled ? ending : NULL, (int)word_flags, dict_present ? flags : NULL);
        if (row > 1) putchar(',');
        printf("{\"endType\":%d,\"wordHex\":", ending_type); oracle_hex(source + start, length);
        if (source_offset >= 0) { fputs(",\"sourceHex\":", stdout); oracle_hex(source, buffer_length); }
        fputs(",\"phonemesHex\":", stdout); oracle_hex(phonemes, strlen(phonemes));
        fputs(",\"endPhonemesHex\":", stdout); oracle_hex(ending, strlen(ending));
        printf(",\"dictFlags\":%s", dict_present ? "[" : "null");
        if (dict_present) printf("%u,%u]", flags[0], flags[1]);
        printf(",\"stateAfter\":{\"wordVowelCount\":%d,\"wordStressedCount\":%d,\"prePause\":%d,\"repeatCount\":%d,\"skipWords\":%d}}",
               translator->word_vowel_count, translator->word_stressed_count, pre_pause, translator->phonemes_repeat_count, dictionary_skipwords);
    }
    if (ferror(stdin)) return 74;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}

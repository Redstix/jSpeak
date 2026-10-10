/* Initialization/table export only: never serializes TranslateChar answers. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "translate.h"

static void require_status(espeak_ng_STATUS status, const char *operation)
{
    if (status != ENS_OK) { fprintf(stderr, "%s status %d\n", operation, status); exit(70); }
}
static void wchar_array(const wchar_t *values)
{
    putchar('[');
    for (size_t i = 0; values[i]; i++) printf("%s%u", i ? "," : "", (uint32_t)values[i]);
    putchar(']');
}
int main(int argc, char **argv)
{
    if (argc != 2) { fputs("Usage: export-profile DATA_PATH\n", stderr); return 64; }
    espeak_ng_InitializePath(argv[1]);
    require_status(espeak_ng_Initialize(NULL), "Initialize");
    require_status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL), "InitializeOutput");
    require_status(espeak_ng_SetVoiceByName("en-us"), "SetVoice");
    InitText(espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE);
    printf("{\"schemaVersion\":1,\"profile\":{\"voice\":\"en-us\",\"translatorName\":%u,\"dotlessI\":%d,\"letterBitsOffset\":%d,\"ideographs\":%d,\"altAlphabet\":%d,\"altAlphabetLanguage\":%d,\"toneNumbers\":%d,\"capsInWord\":%d,\"apostrophe\":%d,\"punctWithinWord\":",
           (unsigned)translator->translator_name, translator->langopts.dotless_i, translator->letter_bits_offset,
           translator->langopts.ideographs, translator->langopts.alt_alphabet, translator->langopts.alt_alphabet_lang,
           translator->langopts.tone_numbers, translator->langopts.param[LOPT_CAPS_IN_WORD], translator->langopts.param[LOPT_APOSTROPHE]);
    wchar_array(translator->punct_within_word);
    fputs(",\"charPlusApostrophe\":", stdout); wchar_array(translator->char_plus_apostrophe);
    printf("},\"constants\":{\"FLAG_CHAR_REPLACED\":%u,\"AL_DONT_NAME\":%u,\"AL_NOT_LETTERS\":%u,\"AL_WORDS\":%u,\"AL_NOT_CODE\":%u,\"AL_NO_SYMBOL\":%u,\"AL_IDEOGRAPHS\":%u},\"replaceCharsHex\":",
           FLAG_CHAR_REPLACED, AL_DONT_NAME, AL_NOT_LETTERS, AL_WORDS, AL_NOT_CODE, AL_NO_SYMBOL, AL_IDEOGRAPHS);
    const unsigned char *replace = translator->langopts.replace_chars;
    if (!replace) fputs("null", stdout);
    else {
        /* The dictionary initializes this byte stream through four NULs. */
        size_t end = 0;
        while (replace[end] || replace[end + 1] || replace[end + 2] || replace[end + 3]) {
            /* Preserve from/to string NULs separately from the four-byte
               sentinel checked at the start of FindReplacementChars. */
            for (int field = 0; field < 2; field++) {
                while (replace[end]) {
                    if (++end > 65536) { fputs("Replacement stream lacks bounded sentinel\n", stderr); return 65; }
                }
                end++;
            }
        }
        putchar('"');
        for (size_t i = 0; i < end + 4; i++) printf("%02x", replace[i]);
        putchar('"');
    }
    fputs(",\"alphabets\":[", stdout);
    const ALPHABET *previous = NULL;
    int count = 0;
    for (unsigned cp = 0; cp <= 0x10ffff; cp++) {
        const ALPHABET *value = AlphabetFromChar((int)cp);
        if (value && value != previous) {
            printf("%s{\"name\":\"%s\",\"offset\":%d,\"rangeMin\":%u,\"rangeMax\":%u,\"language\":%d,\"flags\":%d}",
                   count++ ? "," : "", value->name, value->offset, value->range_min, value->range_max, value->language, value->flags);
        }
        previous = value;
    }
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}

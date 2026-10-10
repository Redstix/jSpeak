/* Development-only tokenizer capture and direct original text primitives. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include <espeak-ng/encoding.h>
#include <ucd/ucd.h>
#include "common.h"
#include "readclause.h"
#include "speech.h"
#include "translate.h"
#include "jstokenizer.h"
#include "synthesize.h"
#define MAX_INPUT_BYTES 65536u
static void require_status(espeak_ng_STATUS status, const char *operation)
{
    if (status != ENS_OK) { fprintf(stderr, "%s status %d\n", operation, status); exit(70); }
}

static unsigned char *read_bytes(size_t *length)
{
    unsigned char *bytes = calloc(MAX_INPUT_BYTES + 8, 1);
    if (!bytes) { perror("calloc"); exit(70); }
    *length = fread(bytes, 1, MAX_INPUT_BYTES + 1, stdin);
    if (ferror(stdin) || *length > MAX_INPUT_BYTES) { fputs("Input exceeds 65536 bytes or read failed\n", stderr); exit(65); }
    return bytes;
}

static void hex_string(const char *text)
{
    putchar('"');
    while (*text) printf("%02x", (unsigned char)*text++);
    putchar('"');
}
static void wchar_array(const wchar_t *values)
{
    putchar('[');
    for (size_t i = 0; values[i]; i++) printf("%s%u", i ? "," : "", (uint32_t)values[i]);
    putchar(']');
}
static void initialize(const char *data_path)
{
    espeak_ng_InitializePath(data_path);
    require_status(espeak_ng_Initialize(NULL), "Initialize");
    require_status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL), "InitializeOutput");
    require_status(espeak_ng_SetVoiceByName("en-us"), "SetVoice");
    require_status(espeak_ng_SetParameter(espeakRATE, 175, 0), "Rate");
    require_status(espeak_ng_SetParameter(espeakPITCH, 50, 0), "Pitch");
    require_status(espeak_ng_SetParameter(espeakVOLUME, 100, 0), "Volume");
    espeak_ng_SetRandSeed(1);
    const unsigned flags = espeakCHARS_UTF8 | espeakPHONEMES | espeakENDPAUSE;
    InitText(flags);
    /* These assignments are the public-state setup in speech.c:Synthesize. */
    option_ssml = flags & espeakSSML;
    option_phoneme_input = flags & espeakPHONEMES;
    option_endpause = flags & espeakENDPAUSE;
}
static void print_profile(void)
{
    printf("{\"voice\":\"en-us\",\"inputEncoding\":\"UTF-8\",\"capacity\":%d,\"randomSeed\":1,\"options\":{\"ssml\":%d,\"phonemeInput\":%d,\"endPause\":%d,\"capitals\":%d,\"punctuation\":%d,\"lineLength\":%d,\"sayas\":%d,\"silence\":%d,\"speed\":%d,\"pitch\":%d,\"amplitude\":%d},",
           N_TR_SOURCE, option_ssml, option_phoneme_input, option_endpause, option_capitals, option_punctuation, option_linelength, option_sayas,
           param_stack[0].parameter[espeakSILENCE], param_stack[0].parameter[espeakRATE], param_stack[0].parameter[espeakPITCH], param_stack[0].parameter[espeakVOLUME]);
    printf("\"translator\":{\"name\":%u,\"phonemeTable\":%d,\"dictCondition\":%u,\"numbers\":%u,\"lowercaseSentence\":%s,\"letterBitsOffset\":%d,\"toneNumbers\":%d,\"decimalSeparator\":%u,\"thousandsSeparator\":%u,\"dotlessI\":%d,\"charsIgnore\":[",
           (unsigned)translator->translator_name, translator->phoneme_tab_ix, translator->dict_condition, translator->langopts.numbers,
           translator->langopts.lowercase_sentence ? "true" : "false", translator->letter_bits_offset, translator->langopts.tone_numbers,
           translator->langopts.decimal_sep, translator->langopts.thousands_sep, translator->langopts.dotless_i);
    for (size_t i = 0; translator->chars_ignore[i]; i += 2) printf("%s[%u,%u]", i ? "," : "", translator->chars_ignore[i], translator->chars_ignore[i + 1]);
    fputs("],\"punctWithinWord\":", stdout); wchar_array(translator->punct_within_word);
    fputs(",\"charPlusApostrophe\":", stdout); wchar_array(translator->char_plus_apostrophe);
    printf(",\"replaceCharsPresent\":%s},\"embedded\":{\"capacity\":%d,\"defaults\":[", translator->langopts.replace_chars ? "true" : "false", jspeak_embedded_capacity());
    for (int i = 0; i < N_EMBEDDED_VALUES; i++) printf("%s%d", i ? "," : "", embedded_default[i]);
    printf("],\"constants\":{\"CTRL_EMBEDDED\":%u,\"SAYAS_CHARS\":%u,\"SAYAS_GLYPHS\":%u,\"SAYAS_SINGLE_CHARS\":%u,\"SAYAS_KEY\":%u,\"SAYAS_DIGITS\":%u,\"SAYAS_DIGITS1\":%u,\"EMBED_P\":%u,\"EMBED_S\":%u,\"EMBED_A\":%u,\"EMBED_R\":%u,\"EMBED_H\":%u,\"EMBED_T\":%u,\"EMBED_I\":%u,\"EMBED_S2\":%u,\"EMBED_Y\":%u,\"EMBED_M\":%u,\"EMBED_U\":%u,\"EMBED_B\":%u,\"EMBED_F\":%u}}}",
        CTRL_EMBEDDED, SAYAS_CHARS, SAYAS_GLYPHS, SAYAS_SINGLE_CHARS, SAYAS_KEY, SAYAS_DIGITS, SAYAS_DIGITS1,
        EMBED_P, EMBED_S, EMBED_A, EMBED_R, EMBED_H, EMBED_T, EMBED_I, EMBED_S2, EMBED_Y, EMBED_M, EMBED_U, EMBED_B, EMBED_F);
}
static int got_read, got_words;
static void print_embedded(const JSPEAK_EMBEDDED_STATE *state)
{
    printf("{\"embeddedIx\":%d,\"embeddedRead\":%d,\"list\":[", state->embedded_ix, state->embedded_read);
    for (int i = 0; i < state->embedded_ix; i++) printf("%s%u", i ? "," : "", embedded_list[i]);
    printf("],\"optionSayas2\":%d,\"countSayasDigits\":%d,\"wordEmphasis\":%d,\"optionSayas\":%d,\"optionEmphasis\":%d,\"pendingCount\":%d}",
        state->option_sayas2, state->count_sayas_digits, state->word_emphasis, state->option_sayas, state->option_emphasis, state->pending_count);
}
static void print_read(Translator *tr, const char *source, const short *charix, int top, int terminator, int tone)
{
    (void)tr;
    got_read++;
    printf(",\"readClause\":{\"startCharacter\":%d,\"startWord\":%d,\"sourceHex\":", clause_start_char, clause_start_word);
    hex_string(source);
    printf(",\"charixTop\":%d,\"charix\":[", top);
    for (int i = 0; i <= top; i++) printf("%s%d", i ? "," : "", charix[i]);
    printf("],\"terminator\":%u,\"tone\":%d}", (unsigned)terminator, tone);
    JSPEAK_EMBEDDED_STATE embedded;
    jspeak_capture_embedded_state(&embedded, 0);
    fputs(",\"embeddedStateBefore\":", stdout); print_embedded(&embedded);
    printf(",\"controlState\":{\"optionPunctuation\":%d,\"punctuationList\":", option_punctuation); wchar_array(option_punctlist); putchar('}');
}
static int print_words(Translator *tr, const char *source, const short *charix, int top, const char *buffer, size_t length, const WORD_TAB *words, int count, const JSPEAK_TOKENIZER_STATE *state)
{
    (void)tr; (void)source; (void)charix; (void)top;
    got_words++;
    fputs(",\"words\":{\"bufferHex\":\"", stdout);
    for (size_t i = 0; i < length; i++) printf("%02x", (unsigned char)buffer[i]);
    fputs("\",\"items\":[", stdout);
    for (int i = 0; i < count; i++) printf("%s{\"flags\":%u,\"start\":%u,\"prePause\":%u,\"sourceix\":%u,\"length\":%u}", i ? "," : "", words[i].flags, words[i].start, words[i].pre_pause, words[i].sourceix, words[i].length);
    printf("]},\"state\":{\"sourceIndex\":%u,\"sourceIndexWord\":%d,\"finished\":%s,\"wordFlags\":%u,\"nextWordFlags\":%u,\"countWords\":%d,\"countSentences\":%d,\"maxClausePause\":%d,\"clausePauseMs\":%d,\"newSentence\":%s,\"startSentence\":%s,\"terminator\":%u}",
           state->source_index, state->source_index_word, state->finished ? "true" : "false", (unsigned)state->word_flags, (unsigned)state->next_word_flags,
           state->count_words, state->count_sentences, state->max_clause_pause, state->clause_pause, state->new_sentence ? "true" : "false", state->start_sentence ? "true" : "false", (unsigned)state->terminator);
    fputs(",\"embeddedStateAfter\":", stdout); print_embedded(&state->embedded);
    return 1; /* Stop before TranslateWord2; no downstream state is executed. */
}
static void tokenize(void)
{
    size_t length;
    unsigned char *bytes = read_bytes(&length);
    (void)length;
    if (!p_decoder) p_decoder = create_text_decoder();
    if (!p_decoder) { fputs("Cannot allocate decoder\n", stderr); exit(70); }
    require_status(text_decoder_decode_string_multibyte(p_decoder, bytes, translator->encoding, espeakCHARS_UTF8), "Decode");
    jspeak_read_hook = print_read;
    jspeak_words_hook = print_words;
    int tone, terminator;
    TranslateClauseWithTerminator(translator, &tone, NULL, &terminator);
    if (got_read != 1 || got_words != 1) { fputs("Tokenizer did not reach expected boundary exactly once\n", stderr); exit(70); }
    free(bytes);
}
static size_t protocol_bytes;
static uint32_t read_u32(void)
{
    unsigned char bytes[4];
    if (fread(bytes, 1, 4, stdin) != 4) { fputs("Truncated primitive frame\n", stderr); exit(65); }
    protocol_bytes += 4;
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}
static unsigned char *read_blob(uint32_t length)
{
    if (length > MAX_INPUT_BYTES || protocol_bytes + length > 16u * 1024u * 1024u) { fputs("Primitive frame exceeds bounds\n", stderr); exit(65); }
    unsigned char *bytes = calloc((size_t)length + 8, 1);
    if (!bytes) exit(70);
    if (fread(bytes, 1, length, stdin) != length) { fputs("Truncated primitive bytes\n", stderr); exit(65); }
    protocol_bytes += length;
    return bytes;
}
static void quote(const char *text)
{
    putchar('"');
    for (; *text; text++) {
        if (*text == '"' || *text == '\\') putchar('\\');
        putchar(*text);
    }
    putchar('"');
}
static void primitives(const char *mode)
{
    uint32_t count = read_u32();
    if (count > 16384) { fputs("Primitive batch exceeds 16384\n", stderr); exit(65); }
    putchar('[');
    for (uint32_t i = 0; i < count; i++) {
        if (i) putchar(',');
        if (strcmp(mode, "scan") == 0) {
            uint32_t length = read_u32(), offset = read_u32(), backwards = read_u32();
            unsigned char *bytes = read_blob(length);
            if (offset > length || backwards > 1) { fputs("Invalid scanner bounds\n", stderr); exit(65); }
            if (backwards) {
                size_t check = offset;
                while ((bytes[check] & 0xc0) == 0x80) {
                    if (check == 0) { fputs("Backward scanner would leave buffer\n", stderr); exit(65); }
                    check--;
                }
            }
            int codepoint;
            int used = utf8_in2(&codepoint, (const char *)&bytes[offset], backwards);
            printf("{\"codepoint\":%u,\"bytes\":%d}", (unsigned)codepoint, used);
            free(bytes);
        } else if (strcmp(mode, "translate") == 0) {
            uint32_t length = read_u32(), offset = read_u32();
            int previous = (int)read_u32(); uint32_t cp = read_u32(), next = read_u32();
            int insert = (int)read_u32(), flags = (int)read_u32();
            unsigned char *bytes = read_blob(length);
            if (offset > length) { fputs("Invalid translation source offset\n", stderr); exit(65); }
            int result = jspeak_translate_char(translator, (char *)&bytes[offset], previous, cp, next, &insert, &flags);
            printf("{\"codepoint\":%u,\"insert\":%d,\"wordFlags\":%u}", (unsigned)result, insert, (unsigned)flags);
            free(bytes);
        } else if (strcmp(mode, "split") == 0) {
            int cp = (int)read_u32(), previous = (int)read_u32();
            fputs(jspeak_should_split_ideographs(translator, cp, previous) ? "true" : "false", stdout);
        } else if (strcmp(mode, "alphabet") == 0) {
            const ALPHABET *a = AlphabetFromChar((int)read_u32());
            if (!a) fputs("null", stdout);
            else {
                fputs("{\"name\":", stdout); quote(a->name);
                printf(",\"offset\":%d,\"rangeMin\":%u,\"rangeMax\":%u,\"language\":%d,\"flags\":%d}", a->offset, a->range_min, a->range_max, a->language, a->flags);
            }
        } else { fputs("Unknown primitive mode\n", stderr); exit(64); }
    }
    if (fgetc(stdin) != EOF) { fputs("Extra primitive frame bytes\n", stderr); exit(65); }
    puts("]");
}
int main(int argc, char **argv)
{
    if (argc != 3) { fputs("Usage: tokenizer-oracle profile|tokenize|scan|translate|split|alphabet DATA\n", stderr); return 64; }
    initialize(argv[2]);
    if (strcmp(argv[1], "profile") == 0) { print_profile(); putchar('\n'); }
    else if (strcmp(argv[1], "tokenize") == 0) {
        fputs("{\"profile\":", stdout); print_profile(); tokenize(); puts("}");
    } else primitives(argv[1]);
    require_status(espeak_ng_Terminate(), "Terminate");
    return fflush(stdout) == 0 && !ferror(stdout) ? 0 : 74;
}

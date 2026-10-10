/* Development-only direct ReadClause/property oracle; no clause algorithm copy. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include <espeak-ng/encoding.h>
#include <ucd/ucd.h>
#include "readclause.h"
#include "speech.h"
#include "translate.h"

#define MAX_INPUT_BYTES 65536u

static void require_status(espeak_ng_STATUS status, const char *operation)
{
    if (status != ENS_OK) { fprintf(stderr, "%s status %d\n", operation, status); exit(70); }
}
static void write_u32(uint32_t value)
{
    unsigned char bytes[4] = {(unsigned char)value, (unsigned char)(value >> 8), (unsigned char)(value >> 16), (unsigned char)(value >> 24)};
    if (fwrite(bytes, 1, 4, stdout) != 4) { perror("write"); exit(74); }
}
static uint32_t parse_u32(const char *text)
{
    char *end;
    unsigned long long value = strtoull(text, &end, 10);
    if (!*text || *text == '-' || *end || value > UINT32_MAX) { fputs("Expected uint32 decimal\n", stderr); exit(64); }
    return (uint32_t)value;
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
    printf(",\"replaceCharsPresent\":%s}}", translator->langopts.replace_chars ? "true" : "false");
}
static void print_state(const unsigned char *bytes, size_t buffer_length, int first)
{
    const unsigned char *cursor = text_decoder_get_buffer(p_decoder);
    size_t offset = cursor ? (size_t)(cursor - bytes) : buffer_length;
    printf("{\"decoderOffset\":%zu,\"decoderRemaining\":%zu,\"decoderEof\":%s,\"decoderPeek\":%u,\"logicalEof\":%s,\"countCharacters\":%d,\"clauseUpperCount\":%d,\"clauseLowerCount\":%d,\"phonemesRepeatCount\":",
           offset, buffer_length - offset, text_decoder_eof(p_decoder) ? "true" : "false", text_decoder_peekc(p_decoder), Eof() ? "true" : "false", count_characters, translator->clause_upper_count, translator->clause_lower_count);
    /* NewTranslator initializes upper/lower counts, but not repeat_count. */
    if (first) fputs("null}", stdout);
    else printf("%d}", translator->phonemes_repeat_count);
}
static void read_clauses(uint32_t max_clauses)
{
    if (max_clauses < 1 || max_clauses > 128) { fputs("maxClauses must be 1..128\n", stderr); exit(64); }
    size_t input_length;
    unsigned char *bytes = read_bytes(&input_length);
    (void)input_length;
    size_t buffer_length = strlen((const char *)bytes) + 1;
    if (!p_decoder) p_decoder = create_text_decoder();
    if (!p_decoder) { fputs("Cannot allocate decoder\n", stderr); exit(70); }
    require_status(text_decoder_decode_string_multibyte(p_decoder, bytes, translator->encoding, espeakCHARS_UTF8), "Decode");
    putchar('[');
    for (uint32_t i = 0; i < max_clauses; i++) {
        char source[N_TR_SOURCE + 40] = {0};
        short charix[N_TR_SOURCE + 4] = {0};
        int charix_top = 0, tone = 0;
        char voice_change[40] = {0};
        /* Mirror the caller's source-position setup, without invoking word translation. */
        clause_start_char = count_characters < 0 ? 0 : count_characters;
        printf("%s{\"index\":%u,\"startCharacter\":%d,\"stateBefore\":", i ? "," : "", i, clause_start_char);
        print_state(bytes, buffer_length, i == 0);
        int terminator = ReadClause(translator, source, charix, &charix_top, N_TR_SOURCE, &tone, voice_change);
        fputs(",\"sourceHex\":", stdout); hex_string(source);
        printf(",\"charixTop\":%d,\"charix\":[", charix_top);
        if (charix_top < 0 || charix_top > N_TR_SOURCE) { fputs("Invalid charixTop\n", stderr); exit(70); }
        for (int j = 0; j <= charix_top; j++) printf("%s%d", j ? "," : "", charix[j]);
        printf("],\"terminator\":%u,\"tone\":%d,\"voiceChangeHex\":", (unsigned)terminator, tone); hex_string(voice_change);
        fputs(",\"stateAfter\":", stdout); print_state(bytes, buffer_length, 0); putchar('}');
        if (terminator & CLAUSE_TYPE_EOF) break;
    }
    putchar(']');
    free(bytes);
}
static void classify(void)
{
    size_t length;
    unsigned char *bytes = read_bytes(&length);
    if (length % 4) { fputs("Expected uint32le classification input\n", stderr); exit(65); }
    putchar('[');
    for (size_t i = 0; i < length; i += 4) {
        uint32_t cp = (uint32_t)bytes[i] | ((uint32_t)bytes[i + 1] << 8) | ((uint32_t)bytes[i + 2] << 16) | ((uint32_t)bytes[i + 3] << 24);
        ucd_category category = ucd_lookup_category(cp);
        uint64_t properties = ucd_properties(cp, category);
        printf("%s{\"codepoint\":%u,\"category\":%d,\"propertiesLow\":%u,\"propertiesHigh\":%u,\"clauseType\":%u}",
               i ? "," : "", cp, category, (uint32_t)properties, (uint32_t)(properties >> 32), (unsigned)clause_type_from_codepoint(cp));
    }
    puts("]"); free(bytes);
}
static void export_table(uint32_t start, uint32_t count)
{
    if (count > 0x110000 || (uint64_t)start + count > (uint64_t)UINT32_MAX + 1) { fputs("Invalid table range\n", stderr); exit(64); }
    for (uint64_t n = start; n < (uint64_t)start + count; n++) {
        uint32_t cp = (uint32_t)n;
        ucd_category category = ucd_lookup_category(cp);
        uint64_t properties = ucd_properties(cp, category);
        write_u32(category); write_u32((uint32_t)properties); write_u32((uint32_t)(properties >> 32)); write_u32(clause_type_from_codepoint(cp));
    }
}
int main(int argc, char **argv)
{
    if (argc == 4 && strcmp(argv[1], "export-table") == 0) export_table(parse_u32(argv[2]), parse_u32(argv[3]));
    else if (argc == 2 && strcmp(argv[1], "classify") == 0) classify();
    else if ((argc == 3 && strcmp(argv[1], "profile") == 0) || (argc == 4 && strcmp(argv[1], "read") == 0)) {
        initialize(argv[2]);
        fputs("{\"profile\":", stdout); print_profile();
        if (strcmp(argv[1], "read") == 0) { fputs(",\"clauses\":", stdout); read_clauses(parse_u32(argv[3])); }
        puts("}");
        require_status(espeak_ng_Terminate(), "Terminate");
    } else { fputs("Usage: clause-oracle profile DATA | read DATA MAX | classify | export-table START COUNT\n", stderr); return 64; }
    return fflush(stdout) == 0 && !ferror(stdout) ? 0 : 74;
}

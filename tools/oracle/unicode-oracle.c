/* Development-only calls into the pinned eSpeak NG C library.
 * No decoder or classification algorithm is reimplemented here.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/encoding.h>
#include <ucd/ucd.h>
#include "common.h"

#define MAX_BYTES (1024u * 1024u)

static unsigned char *read_bytes(size_t *length)
{
    unsigned char *bytes = calloc(MAX_BYTES + 8, 1);
    if (!bytes) { perror("calloc"); exit(70); }
    *length = fread(bytes, 1, MAX_BYTES + 1, stdin);
    if (ferror(stdin) || *length > MAX_BYTES) {
        fputs("Input exceeds 1 MiB or cannot be read\n", stderr); exit(65);
    }
    return bytes;
}

static void decode(const char *termination)
{
    size_t input_length;
    unsigned char *bytes = read_bytes(&input_length);
    int length;
    size_t buffer_length;
    if (strcmp(termination, "c-string") == 0) {
        length = -1;
        buffer_length = strlen((const char *)bytes) + 1;
    } else if (strcmp(termination, "nul-terminated") == 0) {
        buffer_length = input_length + 1;
        length = (int)buffer_length;
    } else if (strcmp(termination, "bounded") == 0) {
        buffer_length = input_length;
        length = (int)buffer_length;
    } else { fputs("Unknown termination mode\n", stderr); exit(64); }
    espeak_ng_TEXT_DECODER *decoder = create_text_decoder();
    if (!decoder) { fputs("Cannot allocate decoder\n", stderr); exit(70); }
    espeak_ng_STATUS status = text_decoder_decode_string(decoder, (const char *)bytes, length, ESPEAKNG_ENCODING_UTF_8);
    if (status != ENS_OK) { fprintf(stderr, "Decoder status: %d\n", status); exit(70); }
    printf("{\"inputByteLength\":%zu,\"bufferByteLength\":%zu,\"steps\":[", input_length, buffer_length);
    size_t index = 0;
    while (!text_decoder_eof(decoder)) {
        const unsigned char *before = text_decoder_get_buffer(decoder);
        size_t offset_before = (size_t)(before - bytes);
        uint32_t peek = text_decoder_peekc(decoder);
        if (text_decoder_get_buffer(decoder) != before) { fputs("peek mutated cursor\n", stderr); exit(70); }
        uint32_t codepoint = text_decoder_getc(decoder);
        const unsigned char *after = text_decoder_get_buffer(decoder);
        size_t offset_after = after ? (size_t)(after - bytes) : buffer_length;
        if (offset_after <= offset_before || offset_after > buffer_length) { fputs("Invalid decoder cursor\n", stderr); exit(70); }
        printf("%s{\"codepoint\":%u,\"peekBefore\":%u,\"offsetBefore\":%zu,\"offsetAfter\":%zu,\"remainingBefore\":%zu,\"consumedBytes\":%zu,\"eofBefore\":false,\"eofAfter\":%s}",
               index++ ? "," : "", codepoint, peek, offset_before, offset_after,
               buffer_length - offset_before, offset_after - offset_before, text_decoder_eof(decoder) ? "true" : "false");
    }
    printf("],\"terminal\":{\"offset\":%zu,\"eof\":true,\"peek\":%u,\"getcSupported\":false}}\n", buffer_length, text_decoder_peekc(decoder));
    destroy_text_decoder(decoder);
    free(bytes);
}

static void print_classification(uint32_t codepoint, Translator *tr)
{
    char encoded[4];
    int length = utf8_out(codepoint, encoded);
    printf("{\"codepoint\":%u,\"category\":%d,\"lower\":%u,\"upper\":%u,\"ucdLower\":%u,\"bracket\":%d,",
           codepoint, ucd_lookup_category(codepoint),
           (uint32_t)towlower2(codepoint, tr), ucd_toupper(codepoint), ucd_tolower(codepoint),
           IsBracket((int)codepoint));
    printf("\"isAlpha\":%d,\"isDigit\":%d,\"isDigit09\":%d,\"isSpace\":%d,\"isSpace2\":%d,\"isEmoji\":%d,\"isRegionalIndicator\":%d,\"isEmojiModifier\":%d,\"isEmojiTag\":%d,",
           IsAlpha(codepoint), IsDigit(codepoint), IsDigit09(codepoint), IsSpace(codepoint), isspace2(codepoint),
           IsEmoji(codepoint), IsRegionalIndicator(codepoint), IsEmojiModifier(codepoint), IsEmojiTag(codepoint));
    printf("\"iswAlnum\":%d,\"iswAlpha\":%d,\"iswBlank\":%d,\"iswCntrl\":%d,\"iswDigit\":%d,\"iswGraph\":%d,\"iswLower\":%d,\"iswPrint\":%d,\"iswPunct\":%d,\"iswSpace\":%d,\"iswUpper\":%d,\"iswXdigit\":%d,\"utf8Hex\":\"",
           !!iswalnum(codepoint), !!iswalpha(codepoint), !!iswblank(codepoint), !!iswcntrl(codepoint),
           !!iswdigit(codepoint), !!iswgraph(codepoint), !!iswlower(codepoint), !!iswprint(codepoint),
           !!iswpunct(codepoint), !!iswspace(codepoint), !!iswupper(codepoint), !!iswxdigit(codepoint));
    for (int i = 0; i < length; i++) printf("%02x", (unsigned char)encoded[i]);
    fputs("\"}", stdout);
}

static void classify(int dotless_i)
{
    size_t length;
    unsigned char *bytes = read_bytes(&length);
    if (length % 4) { fputs("Classification input must be packed uint32le\n", stderr); exit(65); }
    Translator tr = {0};
    /* towlower2 reads only langopts.dotless_i; explicit state is not a loaded voice. */
    tr.langopts.dotless_i = dotless_i;
    fputc('[', stdout);
    for (size_t offset = 0; offset < length; offset += 4) {
        uint32_t codepoint = (uint32_t)bytes[offset] | ((uint32_t)bytes[offset + 1] << 8) |
                            ((uint32_t)bytes[offset + 2] << 16) | ((uint32_t)bytes[offset + 3] << 24);
        if (offset) fputc(',', stdout);
        print_classification(codepoint, &tr);
    }
    fputs("]\n", stdout);
    free(bytes);
}

static void write_u32(uint32_t value)
{
    unsigned char bytes[4] = {(unsigned char)value, (unsigned char)(value >> 8), (unsigned char)(value >> 16), (unsigned char)(value >> 24)};
    if (fwrite(bytes, 1, 4, stdout) != 4) { perror("table write"); exit(74); }
}

static uint32_t parse_u32(const char *text)
{
    char *end;
    unsigned long long value = strtoull(text, &end, 10);
    if (!*text || *end || *text == '-' || value > UINT32_MAX) { fputs("Expected uint32 decimal\n", stderr); exit(64); }
    return (uint32_t)value;
}

static void export_table(uint32_t start, uint32_t count)
{
    if (count > 0x110000 || (uint64_t)start + count > (uint64_t)UINT32_MAX + 1) { fputs("Invalid table bounds\n", stderr); exit(64); }
    Translator tr = {0};
    for (uint64_t n = start; n < (uint64_t)start + count; n++) {
        uint32_t cp = (uint32_t)n;
        const int values[] = {IsAlpha(cp), IsDigit(cp), IsDigit09(cp), IsSpace(cp), isspace2(cp), IsEmoji(cp), IsRegionalIndicator(cp), IsEmojiModifier(cp), IsEmojiTag(cp),
                              iswalnum(cp), iswalpha(cp), iswblank(cp), iswcntrl(cp), iswdigit(cp), iswgraph(cp), iswlower(cp), iswprint(cp), iswpunct(cp), iswspace(cp), iswupper(cp), iswxdigit(cp)};
        uint32_t flags = 0;
        for (unsigned i = 0; i < sizeof(values)/sizeof(values[0]); i++) flags |= (!!values[i]) << i;
        char encoded[4];
        int length = utf8_out(cp, encoded);
        uint32_t packed = 0;
        for (int i = 0; i < length; i++) packed |= (uint32_t)(unsigned char)encoded[i] << (i * 8);
        write_u32(flags);
        write_u32((uint32_t)ucd_lookup_category(cp));
        write_u32((uint32_t)towlower2(cp, &tr));
        write_u32(ucd_toupper(cp));
        write_u32(ucd_tolower(cp));
        write_u32((uint32_t)IsBracket((int)cp));
        write_u32(packed);
        write_u32((uint32_t)length);
    }
}

int main(int argc, char **argv)
{
    if (argc == 4 && strcmp(argv[1], "export-table") == 0) {
        export_table(parse_u32(argv[2]), parse_u32(argv[3]));
        return fflush(stdout) == 0 ? 0 : 74;
    }
    if (argc != 3) { fputs("Usage: unicode-oracle decode MODE | classify 0|1\n", stderr); return 64; }
    if (strcmp(argv[1], "decode") == 0) decode(argv[2]);
    else if (strcmp(argv[1], "classify") == 0 && (strcmp(argv[2], "0") == 0 || strcmp(argv[2], "1") == 0)) classify(argv[2][0] - '0');
    else { fputs("Unknown command\n", stderr); return 64; }
    if (fflush(stdout) != 0 || ferror(stdout)) { perror("stdout"); return 74; }
    return 0;
}

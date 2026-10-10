/* Calls the original public RemoveEnding, and exports initialized options. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "dictionary.h"
#include "translate.h"
static void require_status(espeak_ng_STATUS status) { if (status != ENS_OK) exit(70); }
static int digit(char c) { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; return -1; }
static void hex(const char *bytes, size_t length) { putchar('"'); for (size_t i = 0; i < length; i++) printf("%02x", (unsigned char)bytes[i]); putchar('"'); }
int main(int argc, char **argv)
{
    if (argc != 2) return 64;
    espeak_ng_InitializePath(argv[1]); require_status(espeak_ng_Initialize(NULL));
    require_status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL)); require_status(espeak_ng_SetVoiceByName("en-us"));
    printf("{\"profile\":{\"voice\":\"en-us\",\"translatorName\":%u,\"suffixAddE\":%u,\"wordCopyCapacity\":%d,\"endingCapacity\":50},\"results\":[",
           (unsigned)translator->translator_name, (unsigned)translator->langopts.suffix_add_e, N_WORD_BYTES);
    char line[10000], encoded[8194]; unsigned row = 0;
    while (fgets(line, sizeof(line), stdin)) {
        int end_type, expect_verb, copy, used = 0;
        if (sscanf(line, "%d %d %d %8193s %n", &end_type, &expect_verb, &copy, encoded, &used) != 4 || line[used] || (copy != 0 && copy != 1) || ++row > 16384) return 65;
        size_t hex_length = !strcmp(encoded,"-") ? 0 : strlen(encoded);
        if (hex_length % 2 || hex_length > 8192) return 65;
        char word[4120] = {0}, original[N_WORD_BYTES] = {0}; word[0] = word[1] = word[2] = ' ';
        for (size_t i = 0; i < hex_length / 2; i++) {
            int a = digit(encoded[i*2]), b = digit(encoded[i*2+1]); if (a < 0 || b < 0) return 65;
            word[3+i] = (char)(a*16+b);
        }
        size_t length = strlen(word+3); word[3+length] = ' ';
        /* Reject suffixes that would move before the logical word, rather
           than assigning meaning to caller memory preceding that word. */
        char *cursor = strchr(word+3,' ');
        for (int i = 0; i < (end_type & 0x3f); i++) {
            if (cursor <= word+3) return 65;
            cursor--;
            while (cursor >= word+3 && (*cursor & 0xc0) == 0x80) cursor--;
            if (cursor < word+3) return 65;
        }
        translator->expect_verb = expect_verb;
        int flags = RemoveEnding(translator,word+3,end_type,copy ? original : NULL);
        if (row > 1) putchar(',');
        size_t result_length = length + (word[3+length] != ' ' ? 1 : 0);
        fputs("{\"wordHex\":",stdout);hex(word+3,result_length);
        fputs(",\"wordCopyHex\":",stdout);if(copy)hex(original,strlen(original));else fputs("null",stdout);
        printf(",\"endFlags\":%d,\"expectVerb\":%d}",flags,translator->expect_verb);
    }
    if (ferror(stdin)) return 74;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}

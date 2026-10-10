/* Independent direct SelectPhonemeTable/DecodePhonemes oracle. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <espeak-ng/espeak_ng.h>
#include <espeak-ng/speak_lib.h>
#include "dictionary.h"
#include "phoneme.h"
#include "synthdata.h"

static void require_status(espeak_ng_STATUS status, const char *operation)
{
    if (status != ENS_OK) { fprintf(stderr, "%s status %d\n", operation, status); exit(70); }
}
static int digit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}
int main(int argc, char **argv)
{
    if (argc != 3) { fputs("Usage: phoneme-table-oracle DATA_PATH TABLE_INDEX\n", stderr); return 64; }
    char *end;
    long index = strtol(argv[2], &end, 10);
    if (!*argv[2] || *end || index < 0 || index >= N_PHONEME_TABS) return 64;
    espeak_ng_InitializePath(argv[1]);
    require_status(espeak_ng_Initialize(NULL), "Initialize");
    require_status(espeak_ng_InitializeOutput(ENOUTPUT_MODE_SYNCHRONOUS, 0, NULL), "InitializeOutput");
    require_status(espeak_ng_SetVoiceByName("en-us"), "SetVoice");
    if (!phoneme_tab_list[index].name[0]) { fputs("Missing phoneme table\n", stderr); return 65; }
    SelectPhonemeTable((int)index);
    printf("{\"index\":%ld,\"name\":\"%s\",\"nPhonemes\":%d,\"entries\":[", index, phoneme_tab_list[index].name, n_phoneme_tab);
    for (int i = 0; i < 256; i++) {
        if (i) putchar(',');
        PHONEME_TAB *ph = phoneme_tab[i];
        if (!ph) { fputs("null", stdout); continue; }
        printf("{\"mnemonic\":%u,\"phflags\":%u,\"program\":%u,\"code\":%u,\"type\":%u,\"startType\":%u,\"endType\":%u,\"stdLength\":%u,\"lengthMod\":%u}",
               ph->mnemonic, ph->phflags, ph->program, ph->code, ph->type, ph->start_type, ph->end_type, ph->std_length, ph->length_mod);
    }
    fputs("],\"decoded\":[", stdout);
    char line[16387], input[8194], output[32778];
    unsigned cases = 0;
    while (fgets(line, sizeof(line), stdin)) {
        size_t length = strlen(line);
        if (!length || line[length - 1] != '\n' || (length - 1) % 2 || length > 16385 || cases >= 2048) return 65;
        memset(input, 0, sizeof(input));
        for (size_t i = 0; i < (length - 1) / 2; i++) {
            int a = digit(line[i * 2]), b = digit(line[i * 2 + 1]);
            if (a < 0 || b < 0) return 65;
            input[i] = (char)(a * 16 + b);
        }
        DecodePhonemes(input, output);
        if (cases++) putchar(',');
        putchar('"');
        for (size_t i = 0; output[i]; i++) printf("%02x", (unsigned char)output[i]);
        putchar('"');
    }
    if (ferror(stdin)) return 74;
    puts("]}");
    espeak_ng_Terminate();
    return 0;
}

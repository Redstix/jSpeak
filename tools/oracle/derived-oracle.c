#include <stdint.h>
#include <stdio.h>
#include "numbers.h"
#include "translateword.c"
static int u32(uint32_t *v) {
    unsigned char b[4]; if (fread(b, 1, 4, stdin) != 4) return 0;
    *v = (uint32_t)b[0] | (uint32_t)b[1]<<8 | (uint32_t)b[2]<<16 | (uint32_t)b[3]<<24; return 1;
}
int main(void) {
    uint32_t count, cp; if (!u32(&count) || count > 131072) return 65;
    putchar('[');
    for (uint32_t i=0; i<count; i++) { if (!u32(&cp)) return 65; printf("%s[%d,%d]", i ? "," : "", IsSuperscript((int)cp),NonAsciiNumber((int)cp)); }
    if (fgetc(stdin) != EOF) return 65;
    puts("]"); return fflush(stdout) ? 74 : 0;
}

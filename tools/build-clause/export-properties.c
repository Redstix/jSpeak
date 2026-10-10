/* Build-only raw property export; no readclause algorithm or result table.
 * Derived from pinned ucd-tools, GPL-3.0-or-later.
 */
#include <stdint.h>
#include <stdio.h>
#include <ucd/ucd.h>

static void write32(uint32_t value)
{
    for (unsigned shift = 0; shift < 32; shift += 8) putchar((int)((value >> shift) & 255));
}

int main(void)
{
    fwrite("JSCLPR01", 1, 8, stdout);
    write32(0x110000);
    for (uint32_t codepoint = 0; codepoint < 0x110000; ++codepoint) {
        ucd_category category = ucd_lookup_category(codepoint);
        ucd_property properties = ucd_properties(codepoint, category);
        write32((uint32_t)(properties >> 52));
    }
    return ferror(stdout) ? 1 : 0;
}

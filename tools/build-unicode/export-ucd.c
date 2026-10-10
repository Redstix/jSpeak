/* Build-only adapter over the pinned ucd-tools implementation. GPL-3.0-or-later. */
#include <stdint.h>
#include <stdio.h>
#include <ucd/ucd.h>

static void write32(uint32_t value) {
  for (int i = 0; i < 4; ++i) putchar((int)((value >> (8 * i)) & 255));
}

int main(void) {
  fwrite("JSCUCD01", 1, 8, stdout);
  write32(0x110000);
  for (uint32_t cp = 0; cp < 0x110000; ++cp) {
    uint32_t flags =
      (!!ucd_isalnum(cp) << 0) | (!!ucd_isalpha(cp) << 1) |
      (!!ucd_isblank(cp) << 2) | (!!ucd_iscntrl(cp) << 3) |
      (!!ucd_isdigit(cp) << 4) | (!!ucd_isgraph(cp) << 5) |
      (!!ucd_islower(cp) << 6) | (!!ucd_isprint(cp) << 7) |
      (!!ucd_ispunct(cp) << 8) | (!!ucd_isspace(cp) << 9) |
      (!!ucd_isupper(cp) << 10) | (!!ucd_isxdigit(cp) << 11);
    write32(flags | ((uint32_t)ucd_lookup_category(cp) << 12));
    write32(ucd_tolower(cp));
    write32(ucd_toupper(cp));
  }
  return ferror(stdout) ? 1 : 0;
}

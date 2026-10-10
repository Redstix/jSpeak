# M01 UTF-8 与字符原语

M01 已实现固定 eSpeak NG 版本的 UTF-8 输入 decoder、字符分类、简单大小写映射及 UTF-8 输出原语。运行时是纯 JavaScript，内部采用数字码点与 typed arrays，不调用 Node、Vela、DOM、Promise、TextEncoder/TextDecoder 或宿主 Unicode 正则/大小写规则。它不包含 clause 切分、字典查找或语音合成。

## 入口与范围

实现：`src/core/unicode.js`。独立生成数据：`data/unicode/tables.js`、`manifest.json`。固定上游为 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，UCD 数据版本 **11.0.0**，包含该上游的实际扩展规则；不能直接替换为宿主系统当前 Unicode 数据。

| API | 契约 |
|---|---|
| `createUtf8Decoder(Uint8Array, {termination, encoding})` | 借用不可变输入；提供 `next()`、`peek()`、`eof()`、`offset()`、`remaining()`、有效 `byteLength` |
| `decodeUtf8(bytes, options)` | 返回精确大小 `Uint32Array`，包含 decoder 实际消费的终止 NUL；两遍扫描以避免大 backing store 挂在短视图后面 |
| `writeUtf8CodePoint(cp, output, offset)` | 向已有 Uint8Array 写入 1–4 字节，返回字节数；写入前检查容量 |
| `encodeUtf8(Uint32Array)` | 对应 `common.c:utf8_out`，不自动添加终止 NUL |
| `stringToCodePoints(string)` | JS UTF-16 边界转换，不执行 eSpeak 解码、大小写或 Unicode normalization |
| `codePointsToString(Uint32Array)` | 边界转换；用有限长度字符串片段组装，拒绝无法表达的 >0x10FFFF 值 |
| `isAlpha` / `isLetter`、`isDigit`、`isDigit09`、`isSpace` / `isWhitespace`、`isSpace2` | 对应同名 eSpeak common 语义；返回 0/1 |
| `bracketIndex(cp)` | 对应 `IsBracket`，保留原始查表序号，而非压成布尔值 |
| `isEmoji`、`isRegionalIndicator`、`isEmojiModifier`、`isEmojiTag` | 固定源码范围判断 |
| `iswAlnum/Alpha/Blank/Cntrl/Digit/Graph/Lower/Print/Punct/Space/Upper/Xdigit` | 对应 compat/wctype.h 重定向后的 ucd 函数，返回 0/1 |
| `category`、`ucdToLower`、`toUpperCodePoint`、`toLowerCodePoint(cp, dotlessI=false)` | UCD 枚举值、简单单码点映射；最后一项包含 towlower2 的 dotless-I 分支 |
| `classifyCodePoint(cp, dotlessI=false, output?)` | 差分/诊断用聚合记录，可复用调用者记录，热路径可直接使用标量 API |

标量输入要求 uint32 范围内整数。decoder 只接受显式 UTF-8，`encoding` 缺省等于 `'UTF-8'`；AUTO、8-bit、UCS-2、wchar 等输入模式明确报错。输入长度最多 `2147483646` 字节，保证终止字节后的长度仍符合 C signed-int 契约；该结构上限不是设备内存预算，设备容量须由 D1/M11 单独约束。大输入可通过 cursor 逐个读取，不必先生成完整码点数组。borrowed bytes 使用期间不得由调用者修改。

## 三种精确长度语义

- `c-string`（默认）：与固定 CLI 的 `text_decoder_decode_string_multibyte(..., espeakCHARS_UTF8)` 相同；等效 `strlen+1`，首个 NUL 及其之前的字节可见，其后不进入 decoder。没有 NUL 时使用一个虚拟终止字节。
- `nul-terminated`：在完整输入后追加虚拟 NUL，使用显式长度。保留内嵌 NUL，继续读到有效末尾；用于区分 decoder 原语和 CLI 字符串边界。
- `bounded`：使用精确传入长度，不追加字节；与 `text_decoder_decode_string` 的显式长度参数一致。

上游 multibyte 可用空间检查为 `current + tailCount >= end`，故末尾完整多字节序列仍需要其后存在一个字节。例如 `C2 A9` 在 bounded 模式得到 U+FFFD，而 c-string 模式得到 U+00A9、NUL。JS 忠实保留该行为，未套用标准 decoder。

`peek()` 不移动 cursor，到 EOF 返回 0；`next()` 在 EOF 抛 RangeError。C 的 getc 本身不检查 EOF，会越界，因此 C helper 也不调用 EOF 后 getc。这是明确的调用前置条件，不把未定义行为作为兼容目标。NUL 是 decoder 可返回的数值；它不等于所有模式中的 EOF。

## 必须保留的上游行为

- 单独 continuation byte 输出 U+FFFD；截断序列把 cursor 移到有效末尾。
- 非 continuation byte 不会被错误序列吞掉：上游将 cursor 回退一个字节，下一次读取处理它。长度不足判断先于 continuation 检查。
- `C0 80` 等 overlong 序列按上游解码，可能得到 NUL。
- 三字节序列解出的 U+FFFD 被上游替换成 **U+001A**；直接用 TextDecoder 会产生不兼容结果。
- UTF-8 中的 surrogate 数值原样保留；四字节结果超出 U+10FFFF 则输出 U+FFFD。
- BOM U+FEFF 在本 decoder 原语中不被剥离；后续 clause 行为不在 M01 冒充实现。
- `utf8_out` 对 surrogate 输出对应三字节；对任何 uint32 `>=0x110000` 输出 ASCII 空格。

JS 字符串边界把合法 UTF-16 surrogate pair 合成为补充码点，孤立 surrogate 保留为该数字。这样 `stringToCodePoints → encodeUtf8` 与 C 对这些数值的输出规则一致；不使用宿主编码器的 U+FFFD 自动替换。`stringToCodePoints` 保留内嵌 NUL；是否截断由随后选择的 c-string decoder 明确决定。若输入本来是 U+FFFD 字符，经 UTF-8 再进入 eSpeak decoder 会成为 U+001A，此行为亦有测试。

## 分类与大小写依据

`src/include/compat/wctype.h` 将 `isw*` 指向固定 `ucd_*`；默认构建不使用 libc locale 分类。生成工具只调用固定源码中的基础 UCD 查询，再保存连续区间和简单映射。JS 自己实现 `common.c` 的额外分支，未将全套 eSpeak 分类答案直接序列化。

若干容易误用的例子：

- `IsAlpha` 还接受组合标记、部分 Indic/Tibetan/Jamo/Braille/CJK 范围及指定 emoji；不等于 Unicode Letter。
- `IsDigit` 是 ASCII 数字加 U+0966–U+096F；该版本 `ucd_isdigit` 仅接受 ASCII。Arabic-Indic 数字可满足 iswAlnum，却不满足 IsDigit。
- `IsSpace` 包含 box drawing U+2500–U+259F 和 Unicode specials U+FFF9–U+FFFF；U+0000 不算空格。
- `ucd_isspace` 排除 U+00A0、U+2007、U+202F；不能用 JS `\s` 替代。
- `IsBracket(')')` 返回 2，U+E03C 返回 16；相关调用可以检查非零，但差分保留其原值。
- `towlower2` 的 `dotless_i` 只改变 ASCII I→U+0131；en-us 缺省为 false。其余映射是简单单码点，不是 full case folding，不做 normalization 或字符串扩张。

源码入口：`encoding.c:string_decoder_getc_utf_8/text_decoder_decode_string/text_decoder_peekc`；`common.c:utf8_out/IsAlpha/IsDigit/IsSpace/IsBracket/IsEmoji/IsRegionalIndicator/IsEmojiModifier/IsEmojiTag/towlower2`；`translate.c:lookupwchar`；`ucd-tools/src/{categories,proplist,ctype,case}.c`。

## 数据生成与验证

```sh
node tools/build-unicode/build.mjs
node --test tests/unicode.test.mjs
node tools/oracle/build-unicode.mjs
node tools/build-unicode/verify.mjs
```

生成器在临时目录编译独立 UCD exporter，只读固定 checkout，不修改 `build/oracle`。`manifest.json` 记录每个输入源码 SHA256、sourceFingerprint、exporter SHA256、原始全码点导出 SHA256、最终模块 SHA256 和数据布局。生成后的 `data/unicode` 文件应纳入版本控制，普通 Node 测试无需 C 编译器或 upstream checkout。

当前数据为 **3847 个连续区间、1383 个小写映射、1400 个大写映射**，typed array payload 共 **68428 字节**。这不包括模块解析临时数组、JS 对象、源字符串或调用者缓冲；不是设备峰值内存结论。生产数据格式与优化仍属于 M13/M14。

已通过的本地验收：

- **10 项 Node 测试**：正常/畸形 UTF-8、长度模式、embedded NUL、BOM、EOF/peek、surrogate、UTF-8 写界限、分类、大小写、数据身份与长字符串转换。
- **2430 个 C/JS decoder case**：3 种 termination；原 22 条语料、手选边界、256 种首字节、512 个固定 seed 随机字节串。比较每步码点、peek、消费长度、offset、remaining、EOF；不是仅比较最终字符串。
- **全部 1114112 个 Unicode 码点**：逐项比较 common 分类、UCD 分类、大小写、bracket 序号和 utf8_out 字节；另测 26 个 uint32 范围边界/dotless-I 样本。
- 分类参考导出 SHA256：`d6736af2f8bad7bcd1d1577ec14e4ca6c6e164c6534c265567b999a9a06d3053`。

差分报告位于 `artifacts/unicode/verification.json`，包含 seed、覆盖数量和当前源码/数据/C helper 身份。失败时保存可重放 request 或首个分歧码点到 `artifacts/unicode/failure.json`。C helper 来自独立 Oracle 工作，不使用 JS 结果或本生成器数据计算参考；它另行验证 clean/trace 构建相同函数的输出一致。

## 明确未覆盖的能力

M01 完成的是固定 UTF-8 profile 所需的上述有界原语。尚未实现其他编码、AUTO fallback、语言 translator 配置装载、clause/SSML 处理、Unicode normalization/grapheme 切分，以及 `common.c:utf8_in/utf8_in2` 面向内部字节字符串的独立（含 backwards）扫描语义。它们不得悄悄以本 decoder 或宿主函数替代；后续消费者实际需要时，先建立对应 C 观察点与范围契约。此结论不等于 M02–M06 已完成，更不等于 JS 已能发音。

生成代码和派生数据遵循上游 GPL-3.0-or-later；UCD 数据附加条款来源为 `upstream/espeak-ng/src/ucd-tools/COPYING.UCD`，统一分发材料见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。

# Trace envelope v1 — 已实现的前端观察切片

实现入口：[比较器](../tools/compare/trace.mjs)、[生成器](../tools/oracle/generate-trace.mjs)、[C 插桩补丁](../tools/oracle/patches/frontend-trace.patch)。本契约是完整 CLI 调用的可重放观察序列，**不是**完整 M00、可独立恢复的函数快照或 C/JS 兼容已通过的声明。

## Envelope 与兼容性

每例保存 `trace.json`；C 输出的逐行 JSON 另存 `instrumented.jsonl`，后者不含 envelope，不能单独用于正式比较。

```json
{
  "schemaVersion": 1,
  "stage": "frontend-observations-v1",
  "caseId": "smoke-000",
  "reference": {
    "upstreamCommit": "<40 lowercase hex>",
    "buildFingerprint": "<64 lowercase hex>",
    "dataFingerprint": "<64 lowercase hex>",
    "observationPatchSha256": "<64 lowercase hex>",
    "profile": {
      "voice": "en-us", "speed": 175, "pitch": 50, "amplitude": 100,
      "inputEncoding": "UTF-8", "randomSeed": 1
    }
  },
  "input": { "utf8Hex": "48656c6c6f20776f726c64" },
  "initialState": { "process": "fresh-cli", "randomSeed": 1 },
  "events": [],
  "finalState": { "eventCount": 0, "clauseCount": 0 }
}
```

示例空 events 仅展示 envelope，不是 Hello world 的真实输出。真实输出由生成器产生。

- `buildFingerprint` 是 trace build stamp 的规范 JSON 序列化 SHA256；stamp 同时约束 clean/instrumented 二进制、CMake cache、生成 config.h、数据 manifest、平台/架构、编译器标识、请求配置和补丁。它是本机构建来源标识，不保证跨机器二进制重现。
- `dataFingerprint` 对按路径排序的 `{path, bytes, sha256}` 全量数据 manifest 计算 SHA256；不是只校验 `en_dict`。数字音素身份是 **dataFingerprint + table + code**。
- 初始状态限定独立进程，明确 `-D`→seed 1、完整 profile、`--stdin -b 1 -x -w`。所有额外选项为固定上游 CLI 默认值；读取 stdin 后上游附加 NUL。进程内复用、任意内部边界恢复不在 v1 内。
- 原始输入用 bytes hex 保存，保留 NUL 和 Unicode UTF-8；不从展示字符串重建输入。重放用 `--replay trace.json` 或 `failure.json`。
- 比较器严格拒绝未知版本、stage、字段、事件、profile、越界整数、NaN、非法 hex、事件序号和不完整 clause 序列。先检查 metadata/input/initialState 兼容，再按事件顺序报告首个语义差异。JSON 对象键顺序不影响比较，数组顺序有意义。
- CLI 返回 0：一致；1：有效但不一致/不兼容；2：输入 trace 无效。无自动对齐、忽略尾部或容差。

## 事件

所有事件含 `seq`（从 0 连续增加的安全非负整数）和 `kind`。整数从 C 明确转换后输出十进制；无地址、时间戳或平台指针。每个 clause 依次出现 clause → words → phonemes-before-list；decode 可在其间出现。最终状态记录实际事件及 clause 数。

### decode

观察点是 `encoding.c:text_decoder_getc` 对底层 decoder 的一次调用完成后：

| 字段 | 类型/单位 | 含义 |
|---|---|---|
| codepoint | uint32，码点数值 | 底层 decoder 原样返回值，含 NUL/EOF 的 0；不替换成 JS 解码结果 |
| remainingBefore | uint32，字节 | 调用前 decoder.end-current；包括 decoder 所见终结 NUL |
| consumedBytes | uint32，字节 | 调用后 current 的前进量；EOF 可为 0，不能超过 remainingBefore |

不包含 `peekc`，也不重复记录 ReadClause 的 unget 缓存返回。尚未观察 Unicode 分类/大小写、decoder 初始化切换及无效字节所有分支。当前是固定 UTF-8 profile 的实际调用流，不是所有编码算法的完整 oracle。

### clause

观察点是 `translate.c:TranslateClauseWithTerminator` 调用 `ReadClause` 后、修改 terminator 或 charix 哨兵前。

| 字段 | 类型/单位 | 含义 |
|---|---|---|
| startCharacter | uint32，上游字符计数 | `clause_start_char`；不能视为 UTF-8 字节偏移 |
| startWord | uint32，上游词计数 | `clause_start_word` |
| terminator | uint32，位图 | ReadClause 原返回值，定义见 `translate.h:CLAUSE_*` |
| tone | int32，枚举/覆盖值 | ReadClause 原 `tone` 输出；0 表示后续采用默认 |
| sourceHex | 字节 hex | `source` 至第一个 NUL 前的全部字节，包含 ReadClause 的空格/标点变换 |
| charixTop | uint32，索引 | ReadClause 输出的最后 charix 索引 |
| charix | int16 数组 | `charix[0..charixTop]`，映射到 clause 字符计数；0 和负值保留，不解释为 JS 索引 |

### words

观察点是 tokenizer 完成、FIRST/LAST/HAS_DOT flags 已设置、TranslateWord2 迭代尚未开始。`bufferHex` 保存 `sbuf[0..tr->clause_end]`，**包括前导 NUL 及两个空格**，不含最终 NUL；不能用 `strlen(sbuf)` 截取。

`items` 是 `WORD_TAB[0..word_count-1]`，不含 sentinel：

| 字段 | C 类型/单位 | 含义 |
|---|---|---|
| flags | uint32，位图 | `FLAG_*`；原样保存 |
| start | uint16，字节偏移 | 在 bufferHex 代表的 sbuf 中的开始索引 |
| prePause | uint8，上游暂停等级 | 不等于毫秒；TranslateWord2 将其转换成 pause 音素 |
| sourceix | uint16，上游字符索引 | CalcWordLength 写入的原始值 |
| length | uint8，上游字符数 | 原 WORD_TAB 长度，不等于 UTF-8 字节数 |

### phonemes-before-list

观察点是 TranslateClause 在追加两个尾部 PAUSE 后、调用 MakePhonemeList 前。尚未执行 MakePhonemeList 的替换、VM、最终韵律与时长，因此不是最终语音时间线。

外层字段：`initialTable`（uint8，`tr->phoneme_tab_ix`）；`postPauseMs`（int32，毫秒，实际传给 MakePhonemeList 的 clause_pause）；`startSentence`（boolean，实际 new_sentence2）；`items` 为 `ph_list2[0..n_ph_list2-1]`。

每个 item：`table`（uint8，解释当前 code 所用的表）、`code`（uint8）、`stress`（uint8，原 stresslevel）、`sourceix`（uint16）、`synthflags`（uint16）、`switchTo`（-1 或 uint8）。遇到 phonSWITCH 后，后续 item 的 table 改为其 tone_ph 指定表；switch 本身属于切换前表。sourceix 是上游原字段：词首可包含低 11 位源位置与高 5 位长度，尾部 pause 使用 TranslateClause 当时的 source_index，不强行统一解释。

本切片**不读取** wordstress 或普通 tone_ph：上游尾部 pause 未初始化这些字段，不能将其作为确定性 trace。仅 phonSWITCH 分支读取已初始化的 tone_ph。tone/wordstress 的完整数值比较仍待 M05/M06 观察契约补齐。

## PCM 与未覆盖项

每例保留 clean/instrumented/repeated 的完整 WAV。`report.json` 记录 PCM16LE mono、22050Hz、sampleCount 和 WAV SHA256。WAV 解析校验完整 RIFF、格式及样本数后比较完整字节，因此此 harness 的 PCM 判定为 exact；没有任何容差批准。

缺失：分类和大小写事件、词典/规则选择与匹配分支、TranslateWord3 的独立输出/重音、完整音素字段、VM opcode/条件/mutation、韵律/命令/DSP 状态、内部边界状态恢复、失败自动缩减、大规模/无效字节 fuzz、C/JS 差分。继续 M00 时扩展为新 schema/stage 或显式版本迁移，不能静默新增字段。

## 独立 Unicode primitive Oracle v1

M01 新增 [unicode.mjs](../tools/oracle/unicode.mjs) 与 [unicode-oracle.c](../tools/oracle/unicode-oracle.c)。它直接调用固定 C 库的解码/分类/编码函数，不改变上述 `frontend-observations-v1` 事件 schema。分类和大小写现在有独立调用参考；它们尚未嵌入完整前端 trace 的决策流。

输入为一个 JSON 对象或最多 1024 个对象的数组（批输入至多 4 MiB）：

```json
{
  "utf8Hex": "61c3a90062",
  "termination": "c-string",
  "classify": [65, 73, 160, 769, 2406, 128512, 55296],
  "dotlessI": false
}
```

所有字段可省略：缺少 utf8Hex 时不解码；classify 默认空数组；termination 默认 c-string；dotlessI 默认 false。未知字段/模式、非 uint32、非法 hex、非 boolean 或容量超限均失败。单请求最多 65536 输入字节、65536 分类码点；原生开发 helper 的二进制输入上限为 1 MiB。JSON adapter 只做输入/输出与边界处理，没有 Unicode 算法。

响应为 `{schemaVersion:1, reference, request, decode, classifications}`；reference 含 upstreamCommit、traceFingerprint、helperFingerprint 和 profile `utf8-unicode-v1`。helper stamp 另外绑定 C helper 源码、相关头文件、两套实际静态库、编译参数/编译器及两套 helper 二进制。修改这些输入必须重建。

### UTF-8 三种边界

| termination | C 调用 | 语义 |
|---|---|---|
| c-string | 追加 NUL；text_decoder_decode_string(..., -1, UTF_8) | C strlen+1；首个 embedded NUL 后的字节不可见，匹配现有 CLI profile |
| nul-terminated | 追加 NUL；显式 length=输入字节数+1 | 保留 embedded NUL；观察至完整 buffer EOF |
| bounded | 不追加逻辑终结字节；显式 length=输入字节数 | 严格指定 end；末尾多字节行为与有 NUL 的模式可能不同 |

底层存储额外分配零填充空间，只为安全访问和指针运算；不扩大 bounded 模式传给 C 的 length。上游对多字节检查使用 `current+n >= end`，因此 bounded 的 `c3a9` 返回 U+FFFD，而 c-string 返回 U+00E9、NUL。这是固定 C 行为，不套用标准 TextDecoder。

`decode` 包含 inputByteLength、bufferByteLength、steps 与 terminal。每步记录 uint32 codepoint、peekBefore；字节计量的 offsetBefore/offsetAfter/remainingBefore/consumedBytes；boolean eofBefore/eofAfter。每次 peek 后验证 C cursor 未移动。全部步骤执行至 eof，不把 `codepoint=0` 自行当成停止条件。

terminal 为 `{offset, eof:true, peek:0, getcSupported:false}`。非空 decoder 的 getc 没有 EOF 检查，EOF 后调用可能越界；helper 不读取越界值，JS 对应 API 必须显式拒绝该调用。这里的 getcSupported=false 是适配层契约，并非宣称 C 返回了某个 EOF 值。NULL decoder 的特殊 getc=0 不属于此字节输入接口。

已验证的特殊行为包括：有效 `efbfbd` 被 C 映射成 U+001A；overlong `c080` 被解为 0；`eda080` 保留 surrogate U+D800；BOM 保留为 U+FEFF；错误 continuation 被留给下一次解码；截断序列可以消耗终结 NUL。每项均与 clean/instrumented C 两套库一致。

### 分类、大小写与编码

classifications 保持请求顺序，每项均含 codepoint：

- `category`：ucd_lookup_category 的枚举整数，身份绑定固定 UCD 源码。
- `lower`：(uint32_t)towlower2(cp, translator)，仅显式 langopts.dotless_i 有效；false 对应当前 en-us，true 仅测试 primitive 分支，不代表启用土耳其语合成。
- `upper`：ucd_toupper；`ucdLower`：ucd_tolower。均为单个 uint32，不使用 JS 多字符 case expansion。
- `bracket`：IsBracket 的原 int 返回值，不能简化成 boolean。
- `isAlpha/isDigit/isDigit09/isSpace/isSpace2/isEmoji/isRegionalIndicator/isEmojiModifier/isEmojiTag`：common.c 对应函数，数字 0/1。
- `iswAlnum/iswAlpha/iswBlank/iswCntrl/iswDigit/iswGraph/iswLower/iswPrint/iswPunct/iswSpace/iswUpper/iswXdigit`：使用上游 compat/wctype.h 宏映射到固定 ucd_*，规范成数字 0/1，不使用宿主 libc Unicode 数据。
- `utf8Hex`：common.c:utf8_out 的实际输出字节，surrogate 输出三字节，cp>=0x110000 输出 ASCII space。

所有 cp 输入范围为 uint32。helper 将 towlower2 的 signed int 返回转换回 uint32，以表示码点数值；IsBracket 先按该固定编译平台转换成 int。真正 JS UTF-16 string 的 paired/lone-surrogate 接入策略属于 M01 API 适配层，必须独立记录，不能称作该 C helper 的语义。

### 全码点紧凑参考

`exportUnicodeTable({start,count,reference})` 导出最多 0x110000 行；默认包含 0..0x10FFFF，dotlessI=false。每行 32 字节、小端、8 个 uint32 槽位：flags、category、lower、upper、ucdLower、bracket（按 int32 解释）、utf8Packed、utf8Length。码点由 start+行号确定。flags 位 0..20 依次对应 `unicode.mjs:unicodeFlagFields`；utf8Packed 从低字节开始存放输出，长度 1..4。`unpackUnicodeTableRow` 转成同形 classification 对象；负范围、越界范围及截断行拒绝。

该 exporter 供独立差分验证，不作为手写发音规则或 JS 算法替代。其他编码、common.c:utf8_in/utf8_in2 与完整前端分类决策事件仍待后续阶段。

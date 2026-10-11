# Source mapping

固定上游：`ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。当前映射覆盖 **C Oracle 插桩 → JS trace 工具**、**M01 Unicode**、**M02.1 固定 profile 的 ReadClause 切片**、**M10 Wavegen** 与 **M15 cmn tone 切片**；完整发音/文本核心尚未移植。

| 上游路径/符号 | 已核验行为与状态 | 当前 JS/工具入口 | 观察/回归 |
|---|---|---|---|
| `src/libespeak-ng/encoding.c:text_decoder_getc` | 读取 decoder.current/end，调用 decoder.get，记录 uint32 返回值与字节前进量；不修改解码状态 | `tools/oracle/patches/frontend-trace.patch`；`tools/compare/trace.mjs:validateTrace` | decode；22 smoke、BOM/组合字符/非 BMP/空输入/NUL 边界 |
| `src/libespeak-ng/readclause.c:ReadClause`；`translate.c:TranslateClauseWithTerminator` | ReadClause 返回后的 source 字节、charix、tone/terminator 与开始计数；在后续 sentinel/terminator 调整前观察 | 同上 | clause；标点、CRLF、段落、缩写、长词/长 clause |
| `translate.c:TranslateClauseWithTerminator` tokenizer 尾部；`translate.h:WORD_TAB` | FIRST/LAST/HAS_DOT 已设置，WORD_TAB 与完整 sbuf（包含前导 NUL）尚未进入词翻译 | 同上 | words；撇号、连字符、数字、空白、大小写与 Unicode |
| `translate.c:TranslateClauseWithTerminator` → `phonemelist.c:MakePhonemeList` 调用前 | 含两个尾部 PAUSE 的 ph_list2；记录 phcode/stresslevel/sourceix/synthflags，初始表与 SWITCH 目标，实际 pause/sentence 参数 | 同上 | phonemes-before-list；dataFingerprint + table + code 作为身份 |
| `common.c:espeak_ng_SetRandSeed`；`src/espeak-ng.c:main` | CLI -D 在初始化后调用 SetRandSeed(1)；--stdin 全量读取、-b 1 UTF-8、固定参数 | `tools/oracle/generate-trace.mjs:run`；`tools/oracle/trace-corpus.mjs` | clean/instrumented 各两次独立进程，WAV/mnemonic/trace exact |
| 上游 CMake 数据构建 | 原始编译数据不转换；按路径/长度/SHA256 全量记录，两构建的 manifest fingerprint 必须相同 | `tools/oracle/trace-build-info.mjs`；`build-trace.mjs` | build stamp 源码/配置/二进制/数据验证 |

具体字段位宽、单位和限制见 [TRACE_FORMAT.md](TRACE_FORMAT.md)；运行与证据见 [ORACLE_TRACE.md](ORACLE_TRACE.md)。所有源码路径均相对于 `upstream/espeak-ng/`；插桩只在 `build/oracle-trace/source/`，不编辑固定上游。

未移植/未观察：其他输入编码、common.c 的内部 utf8_in/utf8_in2 scanner、字典 reader 和规则选择、TranslateWord3 的递归替换/重音输出、完整音素字段、VM/音素 mutation、韵律、合成命令及 DSP。数字 sourceix 和音素表不能按展示文本或 JS UTF-16 索引自行推断。当前完整重放单位是新 CLI 进程，不是函数中间快照。

后续每项映射必须追加：真实 JS 算法路径/符号、状态读写、数据转换规则、回归 case ID、支持范围与未移植原因。数据管线复用固定版本上游编译器；运行时不解析 phsource；单语言裁剪仍需依赖闭包和 exclusions 清单。

## M01 独立 C primitive 参考

下列映射新增可执行的独立参考，尚不单独证明 JS 移植已通过：

| 固定 C 符号 | 观察语义 | 工具/测试 |
|---|---|---|
| encoding.c:text_decoder_decode_string/getc/peekc/eof/get_buffer | c-string/nul-terminated/bounded 的真实 UTF-8 步进、peek 不移动 cursor、NUL/EOF/无效序列行为 | tools/oracle/unicode-oracle.c:decode；unicode.mjs:createUnicodeOracle |
| common.c:IsAlpha/IsDigit/IsDigit09/IsSpace/isspace2/IsBracket/IsEmoji/IsRegionalIndicator/IsEmojiModifier/IsEmojiTag | 上游额外字符范围与 raw bracket int；不以标准 Unicode 属性替换 | unicode-oracle.c:print_classification/export_table |
| src/include/compat/wctype.h；src/ucd-tools/src/ctype.c/categories.c/case.c/proplist.c | isw* 实际重定向到固定 ucd_*，分类表、属性与单码点大小写 | 同上；全码点 32-byte rows reference |
| common.c:towlower2/utf8_out | 显式 dotless_i 状态；原始 UTF-8 编码行为，包括 surrogate 和越界 cp | 同上；test-unicode.mjs |

构建入口 `tools/oracle/build-unicode.mjs`；协议测试 `tests/trace-unicode.test.mjs`。C helper 的库、头文件、源码和二进制均经 SHA256/stamp 约束。

## M01 运行期 JS 映射

| 固定 C 行为 | JS 实现/状态 | 数据转换与验收 |
|---|---|---|
| encoding.c:string_decoder_getc_utf_8；text_decoder_decode_string/peekc/eof | src/core/unicode.js:createUtf8Decoder；借用 Uint8Array，维护 offset/end，三种显式结束模式；peek 恢复游标 | 不借用宿主 TextDecoder；保留 malformed、过长编码、surrogate、FFFD→001A 和尾部边界；verify.mjs 逐步比较码点、peek、游标与EOF |
| common.c:utf8_out | writeUtf8CodePoint/encodeUtf8；调用方缓冲或精确大小数组 | surrogate 原样编码，超 Unicode 范围输出空格；全码点及 uint32 边界对照原C |
| common.c 的 IsAlpha/IsDigit/IsDigit09/IsSpace/isspace2/IsBracket 与 emoji helpers | unicode.js 同义原语，bracketIndex 保留原 int 返回值 | 上游自定义范围单独移植；不以 Unicode 标准属性替换；全码点差分 |
| compat/wctype.h → ucd-tools 分类/简单大小写；common.c:towlower2 | isw*、category、ucdToLower、toLowerCodePoint、toUpperCodePoint；dotlessI 显式参数 | tools/build-unicode 导出并压缩固定 Unicode 11.0.0 表；data/unicode/manifest.json 绑定全部来源与表SHA |
| JS API 字符串边界（C 无同名API） | stringToCodePoints/codePointsToString | 合法 UTF-16 pair 合并，孤立 surrogate 保留，不归一化；独立边界/长输入单测，不冒称原C字符串API |

具体接口、分配、支持范围和例外见 [UNICODE.md](UNICODE.md)。M01 的 decoder/classifier 通过不代表词典或发音通过。M02 已补标点原语和下述 ReadClause 切片，内部 scanner/tokenizer 仍待迁移；详见 [M02_SCOPE.md](M02_SCOPE.md)。

## M02.1 ReadClause 切片

| 固定 C 行为 | JS 实现 / 状态与数据 | 观察与回归 |
|---|---|---|
| `readclause.c:clause_type_from_codepoint`；UCD top12 property | `src/core/clause-type.js` 保留原 switch；`data/clause/properties.js` 存原始属性128个稀疏区间，不存 C 最终答案 | 独立原函数全1114112码点及6项uint32边界；`tools/build-clause/verify.mjs` |
| `readclause.c:GetC/UngetC/Eof/InitText2` | `read-clause.js:createClauseReader`；固定en-us/UTF-8/C-string，countCharacters=-1、单字符回退、decoder游标、大小写计数、repeat reset显式独立 | `tools/oracle/clause-oracle.c` 原库直调；`clause.mjs` 固定来源；延迟EOF、连续clause、自有buffer测试 |
| `ReadClause/TerminateBufWithSpaceAndZero` | `reader.next` 返回 source bytes、Int16 charix、tone/terminator、voiceChange、前后状态；容量800与725/796阈值 | `tools/compare/clause.mjs` 全字段exact；原22、大小写、日期/数字、CRLF/段落、多字节/非法UTF-8、容量与固定seed语料 |
| `IgnoreOrReplaceChar` 的固定 chars_ignore 配置；非拉丁分支 | U+00AD/U+200C忽略；Tibetan/Malayalam/Sinhala/Armenian行为保留；借用M01分类/编码 | ignore、ZWJ、stress/tone、byte-end charix与-1/0条目单测/差分 |
| `CheckPhonemeMode`；标点lookahead与组合位 | actual option_phoneme_input=256；保留双括号状态和原 QUESTION\|EXCLAMATION 掩码 | `[[...]]` 内外标点、双点/混合标点、缩写和所有C返回状态 |
| `CTRL_EMBEDDED`、`LookupCharName` 可达依赖 | 目前明确 `READ_CLAUSE_UNSUPPORTED`，reason分别为 `embedded-command`、`punctuation-name-dictionary`；出错会话不可继续 | 所有例外保留case ID与已匹配prefix，不把例外计为exact；补齐依赖前完整M02不完成 |

运行期无系统API、Node或宿主Unicode依赖。profile外SSML、punctuation/capital选项、非默认lineLength、skip/end-position均未实现，不能通过options启用。原始阶段文档保持不变。接口/分配见 [READ_CLAUSE](READ_CLAUSE.md)，证据见 [M02.1验收](build-results/2026-10-05-m02-clause.md)。

## M10 Wavegen 映射

| 固定 C 行为 | JS 实现 / 状态与数据 | 观察与回归 |
|---|---|---|
| `wavegen.c:WavegenInit/GetAmplitude/WavegenSetEcho/SetPitchFormants` | `src/core/wave-generator.js` 初始化、embedded defaults、echo ring 与 voice formant 状态；`src/core/wavegen-data.js` 保存固定表 | en-us voice由命令观察器导出；非零echo无语料覆盖 |
| `wavegen.c:PeaksToHarmspect/AdvanceParameters/Wavegen/SetSynth` | 保留C整数wrap、double插值、Flutter、roughness、glottal reduction、AGC、WAVE2混合和formant状态 | 67输入、99 clause、15449命令、6344247样本C/JS exact |
| `wavegen.c:PlaySilence/PlayWave/WavegenFill2` | pause、marker、wave、WAVE2、spect/spect2、amplitude、pitch、embedded和bounded resume；未用命令显式unsupported | 1/7/64/1323/4096样本分块拼接一致 |
| `common.c:espeak_rand`；`wavegen.c:InitBreath/SetBreath/ApplyBreath` | 确定性LCG与breath resonator已实现 | 当前en-us breath为零，该分支无C/JS exact覆盖 |

命令观察器把 `N_WCMDQ` 扩为4096以捕获完整逻辑计划；原170项运行时队列调度仍是M11范围。接口见 [WAVE_GENERATOR](WAVE_GENERATOR.md)，证据见 [M10完整验收](build-results/2026-10-10-m10-wave-full.md)。

## M15 cmn tone 映射

| 固定 C 行为 | JS 实现 / 状态与数据 | 观察与回归 |
|---|---|---|
| `intonation.c:CalcPitches_Tone` 的 Mandarin 分支 | `src/core/calc-pitches-tone.js`；`src/core/calc-pitches.js` 通过 `toneLanguage=1` 分派；`data/cmn/prosody-profile.js` 锁 translator/table/profile | 独立C Oracle输出 MakePhonemeList before/pitches；13例、76音素、stress/tone/pitch字段全exact |
| Mandarin tone promotion 与 sandhi | 保留无调号promotion、214/51/55相邻sandhi、tone-5 level changes、句末55/15 stress调整和tone phoneme start/end pitch | `tools/compare/cmn-tone.mjs`；构造 `PHONEME_LIST2` 覆盖 reviewed组合，不宣称完整文本前端 |

C 参考：`tools/oracle/cmn-tone-oracle.c`；构建入口 `tools/oracle/cmn-tone-build.mjs`。输入为显式 `PHONEME_LIST2` 行，未覆盖任意文本、损坏输入或全部 tone 组合。

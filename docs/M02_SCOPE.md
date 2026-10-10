# M02 实施规格与剩余范围

本记录基于固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 与现有前端 trace。它细化实施边界，不替代原 [M02/DESIGN.md](../design/stages/M02/DESIGN.md)，不表示完整 M02 验收已通过。固定 profile 的 ReadClause 状态机与标点属性切片已实现；接口见 [READ_CLAUSE](READ_CLAUSE.md)、[CLAUSE_TYPE](CLAUSE_TYPE.md)，验收见 [M02.1 记录](build-results/2026-10-05-m02-clause.md)。

实施顺序：**M01 验收 → M02.1 直接 ReadClause（含重复调用）→ 补齐阻塞依赖 → M02.2 tokenizer → 与翻译器的多 clause 集成**。直接重复调用不修改下游词计数，不等同于完整 TranslateClause 集成。

## 第一切片：固定 profile 的 ReadClause

范围为 plain-text、en-us、新会话，执行 `readclause.c:ReadClause` 及其直接读取/缓冲逻辑。输出 UTF-8 source bytes、int16 charix、charixTop、terminator、tone 和结束后的读取状态。

| 源码符号 | 必须保留的行为 |
|---|---|
| `readclause.c:GetC/UngetC/Eof` | 两种回退状态与 lookahead；只有实际 decoder 读取才增加 count_characters；不把回退读取重复计数 |
| `readclause.c:InitText2`；`translate.c:InitText` | 新会话计数/模式初始化，count_characters 初始 -1；new_sentence 等上层状态的来源 |
| `readclause.c:IgnoreOrReplaceChar/lookupwchar2`；`tr_languages.c:chars_ignore_default` | 按真实 en translator 配置删除/替换字符；默认忽略 U+00AD/U+200C，U+200D 不忽略 |
| `readclause.c:CheckPhonemeMode` | 固定 CLI 默认启用 phoneme-input 标志时，`[[...]]` 对标点扫描的影响；不得假定纯文本自动关闭该默认值 |
| `readclause.c:clause_type_from_codepoint` | UCD category + eSpeak 高位 property → CLAUSE_* 位图，不能用 iswpunct 或标点正则代替 |
| `readclause.c:TerminateBufWithSpaceAndZero` | 写入尾部空格/NUL，并将必要的 lookahead 放回；末尾空格属于参考输出 |
| `readclause.c:ReadClause` | 空白/段落、标点与相邻字符、缩写/小写跟随、数字/点、上游字符处理、容量触发断句与 EOF |

缓冲保持 `translate.h:N_TR_SOURCE=800`；原缓冲接近容量时检查 `ix > n_buf-75`（800 时为 725）及 `ix >= n_buf-4`（796）。charix 的 0、-1、字符计数不能转换成 JS UTF-16 索引。变更容量之前先通过相同容量的差分。

需要显式状态：M01 decoder、ungot_char、ungot_char2、count_characters、clause_start_char、输入/输出索引、charix/charixTop、phoneme_mode、当前/前一个/下一个码点、any_alnum、上游扫描局部状态，以及固定 speech/options 和 translator 的相关字段。SSML 关闭时保留此已声明前提；不能复用一个先运行过其他模式的隐含全局状态。

固定 translator 依赖至少含 translator_name、chars_ignore、langopts.numbers/lowercase_sentence、clause_upper_count/clause_lower_count、phonemes_repeat_count。参数应从固定源与实际 en-us 初始化核验后提取，而不是凭产品语言名称猜测。C 中 ReadClause 会修改大小写计数与 repeat_count，后续阶段不能另造不同结果。

### 当前依赖与支持缺口

1. M01 的分类 flags/category/case 不含 eSpeak 高位 UCD property；M02 已另增原始 property 数据和原 switch 移植，经独立 C 函数全码点差分。见 [CLAUSE_TYPE](CLAUSE_TYPE.md)，不改 M01 表。
2. **ellipsis/三个点即使 option_punctuation=0，仍进入 LookupCharName 的字典依赖。** `Wait... what?` 不能靠删去这条分支通过。可先让第一切片明确拒绝此未实现分支，报告为该切片的覆盖缺口；在宣称完整 ReadClause/M02 完成前，必须补齐真实字典服务。
3. `CTRL_EMBEDDED`（0x01）能够修改 punctuation、改变 voice、产生后续 EmbeddedCommand 状态。未移植时显式返回不支持，不当作普通字符静默跳过。
4. 非默认 capitals/punctuation、SSML/sayas/skip-position 等模式不属于第一切片；当前 profile 下仍可达的非拉丁行为应逐项迁移或显式报告，不以“只做英文”为理由丢弃。

## 第一切片验收与现有 trace 的对应

现有 C 插桩在 `TranslateClauseWithTerminator` 调用 ReadClause 后、后续 sentinel/terminator 调整前记录 `clause`。新的独立 C helper 在相同初始化后直接调用原 ReadClause，比较 sourceHex、charix、charixTop、terminator、tone、voiceChangeHex、startCharacter，以及前后 decoder/counter 状态。首个边界另与既有 CLI trace 对照。此接口没有调用词翻译器，**不提供 startWord**；既有 CLI trace 中该字段仍由真实上层生成，不以固定值或 oracle 答案塞回 JS。

先验证参考 trace 的 schema/commit/build/data/profile，再提取该已定义边界用于 M02 独立差分。不要为了只比较一个阶段而放宽原 trace comparator、忽略其未知字段或伪造尚未产生的 words/phonemes 事件。可另建明确标识为 M02.1 的边界契约/比较入口，保留来源 metadata。

样例至少覆盖 Hello world、逗号/分号/问叹号、缩写和点、日期/小数、CRLF/段落、Unicode/组合字符/emoji、BOM、空字符串和 800-byte 附近窗口；遇到上文暂不支持分支必须有确定性的拒绝测试。空输入要区分 CLI 未调用合成与直接 ReadClause 返回空 clause，不凭空制造 CLI 事件。

已有 trace 的后续 `startWord` 来自下游 count_words。第一切片支持直接 ReadClause 重复调用与自身状态连续性，不能声称完整多 clause 翻译 metadata 已兼容。首条 stateBefore.phonemesRepeatCount 为 null，因为 C 在第一次调用前未初始化它；进入 ReadClause 后的重置和后续数值逐项比较。迭代必须以返回 CLAUSE_TYPE_EOF 为准，不能仅检查 decoderEof。后续完成 tokenizer/调用者计数后再扩展集成验收。

## 第二切片：TranslateClause tokenizer

观察边界已存在：`translate.c:TranslateClauseWithTerminator` 从 sbuf 初始化开始，至设置 FIRST/LAST/HAS_DOT flags、进入 TranslateWord2 循环之前的 `words` 事件。

真实最小依赖：

- `common.c:utf8_in/utf8_in2`（包括向后读取）；**它们不同于 M01 的 text_decoder UTF-8 解码器**，不能直接互换。
- `TranslateChar/SubstituteChar/FindReplacementChars`：语言替换与 `.replace` 数据，包含跨调用的 ignore_next_n 状态；需核验固定 en 数据的实际设置。
- 实际初始化已导出 `replaceCharsPresent:true`，不能因未看到规则文件里的 `.replace` 就假设空指针；须检查真实数据的内容/结束哨兵。
- `AlphabetFromChar/ShouldSplitIdeographs` 及真实 alphabet 表、letter_bits_offset、punct_within_word/char_plus_apostrophe 等 translator 设置。
- `CalcWordLength` 与 WORD_TAB flags：charix→sourceix/length；源索引、UTF-8 byte start、字符长度分别保持对应 C 类型。
- M01 common/UCD 分类与大小写、emoji modifier/区域旗帜/ZWJ/tag 组合逻辑、数字/连字符/撇号处理，以及明确的 embedded/sayas/phoneme-input 边界。

此切片对完整 sbuf bytes（含前导 NUL 和两个空格）及所有 WORD_TAB 的 flags/start/prePause/sourceix/length 做 exact 差分。数字的后续分组展开发生在 words 观察点之后，不能因为 tokenizer 通过而宣称数字发音已移植。M02.1 + M02.2 通过后，再验证跨 clause 状态、容量边界与调用者计数，并补齐之前明确列出的可达缺口。

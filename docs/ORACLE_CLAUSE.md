# 固定 C ReadClause / 标点属性 Oracle

该独立开发工具直接调用固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 的 `ReadClause`、`clause_type_from_codepoint`、`ucd_properties`。它为 M02.1 提供真实 C 参考；不复制 clause 算法，也不运行 JS tokenizer。M02 后续范围见 [M02_SCOPE.md](M02_SCOPE.md)。

## 构建与运行

已有 clean reference 和隔离 trace 构建后：

```sh
node tools/oracle/clause-build.mjs
node tools/oracle/clause-selfcheck.mjs --trace-dir artifacts/oracle-trace-wOIRDF
node tools/oracle/clause.mjs < requests.json
```

`--trace-dir` 应指向当前固定构建生成的完整 CLI trace 目录。省略它时，自检仍验证独立 C helper，但明确记录 CLI trace 桥接检查未执行。

[clause-build.mjs](../tools/oracle/clause-build.mjs) 将同一 [clause-oracle.c](../tools/oracle/clause-oracle.c) 分别链接 clean/instrumented 库，生成 `build/oracle-clause/clause-oracle` 与 `clause-oracle-reference`。构建目录与 M01 helper 分开，不改原上游、baseline、M01 helper 或稳定 trace 补丁。stamp 约束源码、头文件、两套静态库、编译参数/编译器、两套 binary hash 与原 trace fingerprint；每次创建 oracle 都验证来源。

## 输入和响应

JSON CLI 接收单对象或有序数组；Node 接口为：

```js
import { createClauseOracle } from './tools/oracle/clause.mjs';
const oracle = createClauseOracle();
const result = oracle({ utf8Hex: '48656c6c6f2e204e6578742e', maxClauses: 3, classify: [46, 8230] });
// 第二参数 { reference: true } 调用未插桩的 C 库。
```

请求只允许 `utf8Hex`、`maxClauses`、`classify`：

- utf8Hex 可省略；有值时为最多 65536 bytes 的小写偶数长度 hex。
- maxClauses 默认 1，范围 1..128；到达上限时最后一个结果可能尚未返回 EOF。
- classify 默认 []，最多 16384 个 uint32 码点，保留顺序。
- 每 JSON batch 最多 1024 个请求、4 MiB。未知字段、错误类型/范围或非法 hex 直接失败。

响应固定为 `{schemaVersion:1, reference, request, profile, clauses, classifications}`。未请求 utf8Hex 时 clauses=null；否则至少执行一次 ReadClause。reference 包含 upstreamCommit、traceFingerprint、helperFingerprint、dataFingerprint 与 profile ID `read-clause-en-us-v1`。profile 是原 C 初始化后读取的值，不从 JS 默认值拼接。

## 初始化与实际 profile

helper 调用 espeak_ng_InitializePath/Initialize/InitializeOutput，加载 en-us voice，设置 speed=175、pitch=50、amplitude=100、seed=1，调用原 InitText，并按 `speech.c:Synthesize` 设置 ssml/phonemeInput/endPause flags。字节输入通过原 `text_decoder_decode_string_multibyte(..., espeakCHARS_UTF8)` 初始化，因此是 strlen+1 的 C-string 模式，首个 embedded NUL 后的字节不可见。

`InitText2` 将 count_characters 初始化为 **-1**；上游 `tests/readclause.c:set_text` 人工设为 0，不能直接混用那里的 charix 预期值。helper 每次调用前按真实调用者设置 `clause_start_char=max(0,count_characters)`，不执行词翻译，不生成伪造的 startWord。

实际 profile：

| 字段 | C 导出值 |
|---|---|
| capacity | 800（N_TR_SOURCE） |
| ssml / capitals / punctuation / lineLength / sayas / silence | 全部 0 |
| phonemeInput / endPause | 256 / 4096（原 flags 位值） |
| translator.name / phonemeTable / dictCondition | 25966 / 80 / 72 |
| numbers / lowercaseSentence / letterBitsOffset / toneNumbers | 16779328 / false / 0 / 0 |
| decimalSeparator / thousandsSeparator / dotlessI | 46 / 44 / 0 |
| charsIgnore | [[173,1],[8204,1]]，即删除 U+00AD/U+200C |
| punctWithinWord / charPlusApostrophe | [39] / [] |
| replaceCharsPresent | true，仅说明实际指针非 NULL，不代表替换表一定非空 |

完整 profile 可通过 `oracle({}).profile` 获取。profile 记录初始配置，不是每一步完整内部状态快照。输入中的可执行 embedded control 等原 C 行为可改变后续内部状态；第一版 JS 不支持的分支应明确报告，不能因为 C oracle 能运行就宣称 JS 支持。

## 每次 ReadClause 的记录

clauses item 为 `{index,startCharacter,sourceHex,charix,charixTop,terminator,tone,voiceChangeHex,stateBefore,stateAfter}`。

- index 从 0 开始；startCharacter 是本次调用前设置的 clause_start_char。
- sourceHex 是 source 按 C strlen 截至首 NUL 的字节，不包含该 NUL。尾部空格保留。embedded voice 命令等 C 分支可在 buffer 内写入 NUL；尾部强调标记也会改变 source 与 charixTop 的关系，不能据 hex 长度重算 charixTop。当前普通字符路径将解码出的 NUL 改为空格。
- charix 是原 int16 的 `[0..charixTop]`，长度为 top+1；0、-1、截断/回绕后的 signed 值均保持，不换成 JS UTF-16 索引。
- terminator 是原返回位图（uint32），tone 是原 int32；voiceChangeHex 是 ReadClause 的 voice_change 输出至 NUL。它不等同于源 buffer 中 embedded voice 命令附加的全部负载。
- 本次输出的 source、charix 与顶层观察字段可直接对照既有 `frontend-observations-v1` 的首次 clause 事件；新 helper 另外输出可访问的读状态。

stateBefore/stateAfter 字段：

| 字段 | 含义 |
|---|---|
| decoderOffset / decoderRemaining | 原 decoder cursor 的字节位置/逻辑剩余字节；包含可见终结 NUL |
| decoderEof / decoderPeek | 原 text_decoder_eof/peekc；peek 不移动 cursor |
| logicalEof | **原 Eof() 的返回值**，只检查 ungot_char，不检查 ungot_char2，不能解释为全部 pending 状态皆空 |
| countCharacters | 原 signed 字符计数，初始 -1，实际 GetC 才递增 |
| clauseUpperCount / clauseLowerCount | 原 Translator 计数；NewTranslator 初始化为 0，每次 ReadClause 进入重置 |
| phonemesRepeatCount | 原 repeat count；首次 stateBefore 为 null，其后为 int |

首次 repeat count 使用 null 是因为 NewTranslator 没有初始化这个字段，ReadClause 一进入就覆写为 0；helper 不读取未初始化内存。stateBefore 在 ReadClause reset 之前，因此后续调用能看见上一调用留下的计数。

静态 ungot_char/ungot_char2 等不经无侵入公开 API 导出；helper 不伪造它们的值。连续调用验证这些状态的实际效果，记录也不宣称足够恢复任意 C 中间执行点。

**停止依据是返回 terminator 的 CLAUSE_TYPE_EOF 位，或 maxClauses 上限。** 不能只检查 decoderEof/logicalEof。例如 `Hello world. Next.` 第二次可返回句号边界且 decoderEof=true，仍需第三次调用才返回空 EOF clause。

空 UTF-8 输入也会直接调用 ReadClause，得到 sourceHex=`20`、charix=[0]、CLAUSE_EOF。现有 CLI 的完全空 stdin 根本不发起合成，因此没有 clause 事件；桥接验收明确区分两者。

## 原始标点属性接口

classifications 每项为 `{codepoint,category,propertiesLow,propertiesHigh,clauseType}`。category 是原 ucd_lookup_category；properties 是原 `ucd_properties(cp,category)` 的 uint64 拆成两个 uint32；clauseType 直接调用原 clause_type_from_codepoint。

`exportClauseTable({start=0,count=0x110000,reference=false})` 导出每行 16 字节的小端 Buffer，4 个 uint32 依次是 category、propertiesLow、propertiesHigh、clauseType。`unpackClauseTableRow(bytes,index,codepoint)` 转成同形分类对象。一次最多 0x110000 行，范围不能超过 uint32。`propertiesHigh >>> 20` 对应上游 clause 分类使用的高 12 位；不能用 iswpunct 替代。

cp 支持所有 uint32，包含 surrogate 及大于 0x10FFFF 的值；无效 Unicode 码点的原分类为 Ii，原 clauseType 为 CLAUSE_NONE（0x4000）。接口不自动正规化或替换输入码点。

## 已执行验证

2026-10-05 最新自检：[report.json](../artifacts/oracle-clause-NVsvFs/report.json)。

- **63 输入、111 个 ReadClause 返回**，每例 clean/instrumented/fresh-repeat 三次独立进程，结果 exact。
- **268 个分类码点**（含 uint32 扩展边界）、**1,114,112 全 Unicode 行**，两套 C 原属性/分类 exact。
- JSON batch 顺序/重复性、非法模式/字段/hex/范围与容量限制检查通过。
- 既有 50-case CLI trace 中 **49 个首次 clause** 全字段桥接通过；1 个完全空 CLI 输入明确没有 clause。
- 原 C 真实返回与初始化契约保持，未改稳定插桩。

全码点 table SHA256：`7f6e4bc288b2f5d11e70ef2349f1595936056f11c860e40836bda5d4aa334fc9`；helperFingerprint：`87619997923240893d486324dafc5c1d965f298407760145f78fd3a55716365a`。本地 artifacts 不受 Git 跟踪，换机需重新构建/生成。

该记录是 C 参考自检与 CLI 边界桥接；M02.1 的 C/JS 差分由独立 runner 报告。tokenizer、完整字典/规则、SSML、任意状态恢复和其他 voice/profile 不由此结果声明完成。失败保存当时 request 和错误，可将 request 送回 JSON CLI 重放，暂未自动缩减。

# M02.2 固定 en-us 的 tokenizer

`src/core/tokenize-clause.js` 移植固定上游 `translate.c:TranslateClauseWithTerminator` 的文本转词表循环，到设置 FIRST/LAST/HAS_DOT 后、进入 `TranslateWord2` 循环前为止。输入为 [ReadClause](READ_CLAUSE.md) 的记录，输出为同一观察边界的 `sbuf` bytes 和紧凑 WORD_TAB 数组。

当前支持固定 en-us plain-text profile，包括实际 `.replace`、Unicode/跨文字系统、大小写、数字、标点、phoneme input 与 emoji 处理。已接入原版嵌入命令状态与实际 dictionary 公告；非空 voice change 仍明确拒绝；词翻译、数字读法展开、完整多 clause 调用者状态与设备性能尚未完成。本切片通过不能替代完整 M02 验收。

## 接口

```js
import { createClauseReader } from '../src/core/read-clause.js';
import { createClauseTokenizer } from '../src/core/tokenize-clause.js';

var reader = createClauseReader(new Uint8Array([72, 101, 108, 108, 111]));
var tokenizer = createClauseTokenizer();
while (reader.hasMore()) {
  var clause = reader.next();
  var tokens = tokenizer.tokenize(clause);
  // tokens.sbuf 与 tokens.words 交给后续词翻译层。
}
```

`createClauseTokenizer(options?)` 接受默认配置或 `{ voice: 'en-us', embedded }`，其中 embedded 可注入 `createEmbeddedSession()` 共享命令会话；未知配置、其他 voice 和非对象 options 均拒绝。返回：

- `tokenize(clause)`：同步生成一个完整词表；不修改传入的 ReadClause 记录。
- `state()`：返回 `{ ignoreNextN }`，即字符替换器的会话状态快照，不提供从任意快照恢复的接口。

每个输入 clause 需要 `source: Uint8Array`、`charix: Int16Array`、`charixTop` 和 `terminator`。`charix.length` 必须是 `charixTop + 1`；输入应来自已验证的固定 profile ReadClause。传入的非空 `voiceChange` 会被拒绝，不能将其他 translator 的结果解释为 en-us。

返回值：

| 字段 | 类型与语义 |
|---|---|
| `sbuf` | `Uint8Array`；包含第一个 NUL、两个前导空格及实际末尾空格，排除最后的 C 终止 NUL |
| `wordCount` | 有效词表项数；与所有 `words` 数组长度一致 |
| `words.flags` | `Uint32Array`；WORD_TAB.flags |
| `words.start` | `Uint16Array`；该词在 sbuf 中的 UTF-8 字节起点 |
| `words.prePause` | `Uint8Array`；WORD_TAB.pre_pause 原值 |
| `words.sourceix` | `Uint16Array`；来自 charix 的上游源字符位置 |
| `words.length` | `Uint8Array`；CalcWordLength/插入边界调整后的上游词长 |
| `scanState` | 循环边界的 `sourceIndex`、`sourceIndexWord`、`finished`、`wordFlags`、`nextWordFlags` |
| `stateBefore` / `stateAfter` | 调用前后替换器状态快照 |
| `embeddedStateBefore` / `embeddedStateAfter` | 同一 words 边界的完整命令队列、读取游标、pending、sayas/emphasis 状态 |

例如 `Hello world` 返回 `sbufHex=00202068656c6c6f20776f726c6420`，两项分别为 `{flags:514,start:3,prePause:0,sourceix:1,length:5}` 和 `{flags:16,start:9,prePause:0,sourceix:7,length:5}`。空 ReadClause 返回 `sbufHex=002020` 和空词表，不能拿 `strlen(sbuf)` 得到输出长度，因为 sbuf 的第一字节本来就是 NUL。

输出数组归返回记录所有，后续调用不会覆盖它们。`WORD_FLAGS` 是冻结对象，提供当前 tokenizer 使用的 FLAG_* 子集，键名去掉 `FLAG_` 前缀；它不是全部词典/词翻译标志的公共目录。

## 原语与真实配置

该层扫描使用 `src/core/utf8-scan.js` 的 `readForward` / `readBackward`，逐字节移植 `common.c:utf8_in` / `utf8_in2`。它们与 M01 的输入 text_decoder 在畸形序列、continuation 跳过及返回宽度上不同，不能互换。逆向读取的 offset 是要检查的最后一个字节，通常是 `index - 1`；正向移动依然使用 C 返回的 decoded width。

[字符原语](TEXT_CHARACTER.md) `src/core/text-character.js` 提供每会话 `createTextCharacterSession()`、`alphabetFromChar` 与 `shouldSplitIdeographs`。构建数据 `data/text/profile-export.json`、`tables.js` 和 `manifest.json` 来自真实 en-us 初始化，而不是空表或观察答案：

- 18 条 `.replace`，116 字节原始 NUL 分隔表；`æ/œ/ﬀ` 等按真实条目扩展，未列入的 `ﬃ` 保持原样。
- 28 个 alphabet 记录，用于外语文字系统边界与 ideograph 判断。
- `translatorName=25966`、`dotlessI=0`、`letterBitsOffset=0`、`toneNumbers=0`、`capsInWord=0`、`apostrophe=0`、`ideographs=0`、`altAlphabet=0`。
- `punctWithinWord=[39]`、`charPlusApostrophe=[]`；breaks 表仅包含下划线。

ReadClause 固定默认 `phonemeInput=256`，所以 tokenizer 支持 `[[...]]` 与内部 `[0x02` phoneme 起始标记；在模式内保持原来的大小写和标点，并设置 PHONEMES。这里的 phoneme mode 是每次调用的局部状态。`.replace` 的 `ignore_next_n` 则是跨调用状态，因此同一文本会话必须复用 tokenizer。固定 en 数据当前没有多码点 from 条目，但实现仍保留原始状态机，不能把接口改为无状态查表。

Hangul 音节拆成 Jamo 的分支在语言 switch 前执行，en-us 也能到达。插入字符必须再次进入 TranslateChar；只对原输入字符处理一次会丢失递归的 Hangul 拆分。UpperCaseInWord 的特殊规则仅用于其他 translator，固定 en-us 返回 0；CAPS_IN_WORD、APOSTROPHE、tone_numbers 等被排除的分支均有实际初始化依据。

## 保留的非直观行为

词表不是按空格简单拆分。循环保留 `source_index`、`prev_in_save`、`char_inserted` 与 `space_inserted`；插入词间空格后会回退原输入位置，再处理同一字符。输出位置、输入 byte offset 和源字符计数因此不能合并。

`CalcWordLength` 在 ReadClause 的 charix 后写入 `0, 0x7fff, 0` 三个调用者哨兵，再跳过非正值计数；中途强制断词时按另一段逆向计数更新长度。结果赋给 C `unsigned char`，故 256 字符词的 length 为 0，300 字符词的 length 为 44。JavaScript 通过 `Uint8Array` 保留这个截断，不能扩大字段后声称兼容。

大小写逻辑区分首字母、全大写、CamelCase、连续大写后跟小写，以及英语 acronym 的 `s/'s` 复数；NOSPACE、MULTIPLE_SPACES、HAS_DOT 等标志随原始分支设置。数字可在 `0x10`、`23rd`、`1,234` 等输入中被拆成多个词表项；千位分组和发音处理在 words 边界后才发生，本层不提前展开。

连字符、引号和 pause 可触发额外空格，首词 prePause 强制为 0。亚美尼亚 U+0530 强调标记与 U+0557 comma-break 标记分别设置 FOCUS/COMMA_AFTER。末词标记会跳过末尾括号；HAS_DOT 还受 NOSPACE 约束。

emoji 相邻并不总是一个词：modifier 与前一个 emoji 合并，regional indicators 两个成对，ZWJ 仅在词确实始于 emoji 时连接，tag 序列保留，U+FE0E/U+FE0F presentation selector 删除。普通字母与 emoji 或不同 foreign-ness 的文字系统会按上游规则拆词。

输出保持 `N_TR_SOURCE=800` 的写入条件与 `N_CLAUSE_WORDS=300` 的词数上限。上游在 `ix >= 796` 时不再写普通字符，但仍继续读到结束/分隔符，这可能使该 clause 的 tokenizer buffer 比 ReadClause source 短；例如 795 个 `x` 后接 emoji 的容量样例，首词表 buffer 为 797 字节、length 为 27，均与 C 一致。不能擅自把这些被容量条件省略的字节塞到另一个词表中。

## 嵌入命令状态

`src/core/embedded.js` 的 `createEmbeddedSession()` 保留原版 `PSARHTIVYMUBF` 命令与默认值 `[0,50,175,100,50,0,0,0,175,0,0,0,0,0,0]`。命令名区分大小写；未知命令只去掉控制标记，其后文本保留。无数字采用默认值并重置 +/-；数字按固定 Linux `atoi` 的 signed-long 饱和与 int32 窄化解析，不能换成普通 parseInt。总容量 250，但接受上限为 248，满后 source pointer 保持不变。

`beginClause()` 重置队列/read/pending，保留 `optionSayas2`、数字分组计数和 `wordEmphasis`。真实词完成时末命令设置 0x80，词设置 EMBEDDED；仅命令 clause 会生成原版 null word。SAYAS_KEY、DIGITS 分组与强调直接影响此 tokenizer 边界；后续 `consumeWordCommands(prePause)` 才应用 Y/F/B 至 optionSayas/optionEmphasis/prePause，两个阶段不能混淆。速度等合成命令仍交给后续合成层消费。

两份 embedded 快照包含 `embeddedIx`、`embeddedRead`、`list`、`optionSayas2`、`countSayasDigits`、`wordEmphasis`、`optionSayas`、`optionEmphasis`、`pendingCount`，全部在独立 C 差分中比较。ReadClause 的 B 公告状态另外通过 `controlState()` 比较。

## 不支持与错误

实际遇到以下边界会抛出 `UnsupportedTokenizerError`，`code='TOKENIZER_UNSUPPORTED'`：

| `reason` | 含义 |
|---|---|
| `voice-change` | 输入记录携带非空 voiceChange，超出固定 translator |
| `output-capacity-overflow` | 原分支组合需要在 800 字节 sbuf 之外写终止字节，无法以定义明确的 C 内存行为验收 |

错误附带 `codepoint`、`sourceIndex`、`state`，不返回半成品词表；同一会话后续 tokenize 再次抛出同一个错误。容量检测使用 4 个额外工作字节，目的在于确定性报告越界，而非扩展允许输出的容量。例如 `'ab - ' + '한'.repeat(88)` 的 Hangul 展开和 prepause 插空格使 ix 达到 800；源码接下来的 `sbuf[ix]=0` 超过 `char sbuf[800]`。[独立 C UBSAN 诊断](ORACLE_TOKENIZER.md) 已确认此边界；JS 确定性拒绝，差分将它单列为上游未定义行为，不算兼容通过。普通类型/边界参数错误则以 TypeError/RangeError 报告。

ReadClause 注入真实 dictionary 后，省略号与已有名称的标点公告通过；`+`、全角句读等字符名称仍需未接入的 TranslateRules 回调，报精确依赖错误。tokenizer 不会把错误变成空词表。SSML、voice/语言切换与完整合成命令消费仍在此切片之外。

词表观察点之前，`count_words` 尚未递增；递增和 `new_sentence` 后续更新属于下游词翻译循环，且可受字典吞词、音素容量及 terminator 修改影响。本接口因此不伪造 `startWord`、完整句子计数或词翻译后的 pause。连续 tokenize 可以验证自身跨调用状态，但不能单凭这一点宣布完整多 clause TranslateClause 集成完成。

## 验证、来源与后续

```sh
node --test tests/tokenize-clause.test.mjs
node --test tests/tokenizer-compare.test.mjs
node --test tests/embedded.test.mjs
node tools/oracle/tokenizer-build.mjs
node tools/compare/tokenizer.mjs
```

18 项核心单测使用固定 C words 边界期望值及确定性拒绝断言，覆盖完整 Hello/空输入、Unicode、CamelCase/复数、真实替换、Hangul、emoji、数字、空白、phoneme、强调、字段宽度/容量、跨调用所有权和明确错误。5 项 embedded 状态测试覆盖解析/容量/整数窄化/跨句/消费；另 6 项比较器测试覆盖字段/类型/schema 破坏、局部状态差异、精确异常白名单和 C 未定义行为的独立分类。

当前正式差分报告为 `artifacts/tokenizer-differential-KdWw3R/report.json`：990 输入中 **981 exact、7,389 个词完整字段一致**；8 项是实际到达字符名称 TranslateRules 的固定输入缺口，1 项是 C UBSAN 确认的未定义容量行为。五个 scanState、完整 embedded 前后状态与 ReadClause B 配置均比较。C 的 countWords/countSentences/pause/newSentence 等调用者字段保留观测，不冒充完整 TranslateClause 实现。

历史报告保留可追溯性：最初 `tokenizer-differential-MdNJXf` 为 686 输入/648 exact/37 缺口/1 UB；嵌入命令接入后 `tokenizer-differential-3RpTvT` 为 779/766/12/1；字典省略号接入后 `tokenizer-differential-giaWDN` 为 779/776/2/1。当前 B1/list 两个输入已转为 exact，新增 8 个字符规则输入被明确列出，不能把例外数量变化误读成原输入退化。每份报告绑定当时文件 SHA256，后续修改必须重跑。

runner 使用原始输入独立创建 JS ReadClause 与 tokenizer，不把 C clause/state 作为 JS 的隐藏输入；先比较 fresh ReadClause 字节/charix/terminator/tone，再比较 words 与局部状态。基础语料原先无服务的 ReadClause 缺口在此 runner 必须正常比较；剩余公告缺口由 `tokenizer-corpus.mjs` 绑定输入 SHA256 与精确 reason/codepoint/clauseIndex；未知错误、参考进程故障、schema 改变或数据/profile 来源变化直接失败。报告单列 unsupported 与 upstreamUndefined，始终保留 `coverageComplete=false`，不允许用这些项凑出完整通过率。

每次运行在 `artifacts/tokenizer-differential-*/` 保存 `requests.json`、完整 `oracle.jsonl`、`results.json` 与 `report.json`；失败另写 `failure.json`。运行前后核验核心/数据/比较器文件 SHA256 和 C helper/build/reference 指纹。既有 trace 的 76 个 words 记录与额外 16 组定向输入的 18 个 clause 也已通过开发验证，后者原始记录在 `artifacts/tokenizer-targeted-P3qB0U/`，与正式新会话首 clause 验收范围明确区分。

固定上游 commit 为 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。源码对应 `translate.c:1032` 起的 TranslateClauseWithTerminator 初始化、`:1104` 的 charix 哨兵、`:1159–1663` 的词表循环/最终标志与 `:1864` 的 CalcWordLength；类型宽度来自 `translate.h:263` 起的 WORD_TAB。原语对应 `common.c:utf8_in/utf8_in2`、`translate.c:TranslateChar/SubstituteChar/FindReplacementChars` 与 alphabet 数据。许可为 GPL-3.0-or-later，见 `licenses/espeak-ng/COPYING.txt` 及相应 Unicode notices。

工作存储为 source、charix、sbuf 以及五个 300 项 TypedArray，返回时只复制有效前缀；标量扫描状态不依赖宿主字符串分词。scanner 和字符翻译器每步返回的小对象开销尚待性能阶段评估。当前在 Node 验证；`Object.freeze`、`Number.isInteger`、TypedArray 的 set/slice 及整体内存/吞吐须在 M12 设备集成时验证，不改动已冻结探针。

下一步是把真实字典、规则、重音依赖接入词翻译阶段，补齐字符名称规则回调；只有调用者计数/跨 clause 状态与全部支持缺口都有证据后，才能关闭完整 M02。

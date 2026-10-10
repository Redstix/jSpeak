# 原 C 词翻译 oracle

`tools/oracle/word.mjs` 对固定上游
`ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 的公开 `TranslateWord`、
`TranslateWord3` 和私有 `TranslateWordWithBounds` 提供独立调用。helper
直接包含未修改的原始 `translate.c`，以访问真实私有函数和状态，并链接
`build/oracle` 的原始静态库。额外代码只初始化状态、调用原函数和序列化结果，
不复制翻译算法，也不修改原源码或旧 trace 构建。

初始化为 en-us、rate 175、pitch 50、volume 100、phoneme table 80、seed 1，
调用原 `InitText`。每个请求使用新进程；状态只通过明确字段传入。

## 构建和调用

```sh
node tools/oracle/word-build.mjs
node tools/oracle/word-observer-build.mjs
node tools/oracle/word-selfcheck.mjs
```

```js
import { createWordOracle } from './tools/oracle/word.mjs';
const oracle = createWordOracle();
const response = oracle({
  operation: 'word3',
  bufferHex: Buffer.from('\0  hello world \0').toString('hex'),
  offset: 3,
  words: [{ flags: 0 }, { flags: 65552 }],
  remaining: 2
});
```

也可把单个请求或最多 1024 个请求的数组传入 `node tools/oracle/word.mjs`
的标准输入。响应为 `{schemaVersion, reference, profile, request, status, diagnostic, result}`，
`request` 是完整规范化请求，始终包含 bufferHex/offset 及从中导出的 utf8Hex/prefixHex。`reference` 包含原 commit、data 和 helper 指纹；
构建验证会检查静态库、原源码、helper/header 和可执行文件 hash。

## 请求契约

| 字段 | 默认值与边界 |
| --- | --- |
| `operation` | `word3`，公开包装器 `word`，或真实私有包装器 `withBounds` |
| `bufferHex` / `offset` | 首选入口；完整缓冲区小写 hex，最多 8192 字节；词偏移至少 3。当前词到首个 NUL 或缓冲区末端为源字符串，长 1..4096 字节并以空格结束 |
| `utf8Hex` | 兼容入口；当前词起的源字符串小写 hex，1..4096 字节、不含 NUL、空格结尾。省略 bufferHex 时使用下行的有界前缀 |
| `prefixHex` | `0020`；恰好两个前置字节，helper 在这两个字节前另加一个零 backing byte |
| `words` | `[{}]`；最多 300 项，空数组对应 NULL `WORD_TAB` |
| `remaining` | word3/withBounds 为 `words.length`；word 必须为 0，与原公开包装器一致 |
| `wordOut` | `true`；是否传入文本替换输出指针；word/withBounds 为 true 时必须有 WORD_TAB |
| `anyStressedWords` | `false`；word3 传入非 NULL bool 指针；withBounds 初始化真实私有 bool；word 必须为 false |
| `alphabetCodepoint` | `null`；word3 传入原 `AlphabetFromChar(cp)` 的返回指针；withBounds 初始化真实私有 current_alphabet；word 必须为 null |
| `initialPhonemesHex` | 空；最多 199 字节，原 C 的 NUL 语义 |
| `state` | 下表所列状态，其他字段会被拒绝 |

旧 prefixHex 兼容入口只提供两个前置字节加零 backing byte；它不等价任意
CLI 前文。原数字逻辑读取 word[-3]，部分规则向后扫描到空格而非 NUL，因此
生产衔接和新的真实 CLI 重放必须使用完整 bufferHex/offset。

每个 WORD_TAB 项包含 `flags:uint32`、`start:uint16`、`prePause:uint8`、
`sourceix:uint16`、`length:uint8`，省略字段为 0。

状态 `dictCondition` 默认 72，`clauseEnd` 默认 `source.length - 1`，
其余数值默认 0，`repeatHex` 默认空：

| 类别 | 字段 |
| --- | --- |
| 字典和语法 | `dictCondition`, `expectVerb`, `expectVerbS`, `expectNoun`, `expectPast`, `prevDictFlags0`, `prevDictFlags1` |
| 句子上下文 | `clauseTerminator`, `clauseEnd`, `clauseLowerCount`, `clauseUpperCount` |
| 重音和停顿 | `prePause`, `prevLastStress`, `prepauseTimeout`, `endStressedVowel`, `wordVowelCount`, `wordStressedCount` |
| 重复和跳词 | `repeatCount`, `repeatHex`（最多 19 字节）, `skipWords` |
| 原全局选项 | `optionSayas`, `optionCapitals`, `optionToneFlags` |

`dictCondition`、两个 prev flags、`clauseTerminator`、`clauseEnd` 和
`optionToneFlags` 为 uint32；其余数值为 int32。`clauseEnd` 是相对当前源
字符串起点的偏移，必须在 `[0, source.length]` 内。任意组合的标记不一定是
真实调用上下文；helper 不宣称对原 C 完成了全程序未定义行为审计。

## 返回契约

有效调用返回 `status: 'ok'`、`diagnostic: null`，`result` 包含：

- `flags`：原函数的 uint32 位模式；`phonemesHex`：终结 NUL 前的音素。
- `wordOutHex`：文本替换输出；没有输出指针时为 null。
- `bufferAfterHex`：调用后完整输入缓冲区，保持完整输入长度；`prefixAfterHex`、
  `wordAfterHex` 为当前词前两字节和当前源字符串的原始字节，后者保持原源字符串长度。
- `wordsBefore`、`wordsAfter`：所有传入 WORD_TAB 项。
- `stateBefore`、`stateAfter`：全部显式状态，另附 `clauseEndRelation`、
  `phonemeTable`、`native`；`phonemeTable` 是 translator 字段，并非不可见静态选表变量。
- `anyStressedWords`：word3/withBounds 的调用后 bool；公开 word 包装器返回 null。

`profile` 导出实际初始化后的语言参数，含 `minRoman=2`、`maxRoman=49`、
`spellingStress=false`、`OPTION_EMPHASIZE_ALLCAPS=256`。

`TranslateWord3` 只执行单次词翻译；公开 `TranslateWord` 还执行原
`TranslateWordWithBounds` 的 TEXTMODE 分段、最多三层替换递归和音素合并。
`withBounds` 直接调用该私有包装器，并保留真实 remaining 和字母表/重音上下文。
例如 `boogey ` 的 word3 返回替换文本 `boogie ` 和空音素，word 返回相同替换
文本及最终音素。原 `translateword.c` 中 `(any_stressed_words)` 判断的是
指针本身，不能将它重写为读取 bool 值的条件。

## 原源码越界分类

每个请求先由隔离的 `word-oracle-asan` 执行 AddressSanitizer 预检；合法结果
仍取自普通原 C helper。ASAN 构建对真实 `translate.c`、`dictionary.c` 和
`common.c` 及 helper 的源缓冲区插桩，不使用 sanitizer 输出来生成发音答案。

已确认原 KEY 分支的源下溢：兼容前缀 `0020`、`optionSayas=36`、`key ` 或
`abc ` 时，规则从被改为 `_` 的前置空格向后扫描，越过 NUL，最终读取
`text[-1]`。独立原源码复核证据为
`artifacts/word-key-asan-P7rD1D/report.json`；同样输入的 `2020` 前缀为安全对照。

只有 sanitizer 类型、原源码调用位置和 helper text 缓冲区负一索引全部匹配，
才返回 `status: 'undefined-upstream-behavior'`、`result: null`，以及诊断：

```json
{"code":"WORD_SOURCE_UNDERFLOW","sanitizer":"AddressSanitizer","kind":"stack-buffer-overflow","source":"src/libespeak-ng/common.c","line":138,"callerSource":"src/libespeak-ng/dictionary.c","callerLine":1967,"relativeIndex":-1}
```

其他 sanitizer 错误仍使调用失败。本分类只处理这个已证实的原源码边界，
不代表全程序未定义行为审计，也不把完整 CLI 的合法 KEY 输入归为异常。

## 完整 CLI 只读观测和重放证据

`word-observer-build.mjs` 用 GNU ld `--wrap=TranslateWord3` 将原 CLI object、
原静态库和一个只读观察 object 链接到独立的
`build/oracle-word-observer/espeak-ng`。设置 `JSPEAK_WORD_TRACE_FILE`
即可记录 enter/exit JSONL；观察器调用 `__real_TranslateWord3` 执行原算法。
同一 object 内部直接绑定的调用可能不经过链接 wrapper，因此事件数不是所有
递归调用的证明。

观察器记录真实 WORD_TAB、音素初值、alphabet、状态和返回结果。native
in-clause 调用按原 TranslateClause 的 `word == sbuf + WORD_TAB.start` 契约
还原完整 sbuf，检查原 `[0,32,32]` 开头并记录完整输入字节与 offset。只对
native en、table 80、200 字节音素容量、非 NULL bool 指针、空格终止源、
源内部 clause_end 且能还原原始句子缓冲区的调用进行独立重放。TEXTMODE/字符名称调用可能让
clause_end 指向其他缓冲区；这时记录 null 和地址相对关系，不伪造偏移。

正式完整缓冲区报告：`artifacts/oracle-word-UEVXVz/report.json`。
旧 `artifacts/oracle-word-Bqaved/report.json` 只验证其所测的两字节前缀输入，不作为任意前文的证明。

- 64 组完整 CLI 输入，观察版与原版 mnemonic 和完整 WAV 字节完全一致。
- 771 次观察到的词调用；649 次独立重放，每次再用新进程重复一次，全部
  返回字段和前后状态一致；122 次调用的排除原因逐项保留。
- 36 组直接 word/word3 请求，包含有/无 wordOut 和 TEXTMODE 包装器行为；
  11 个无效 Node 请求拒绝检查。
- 6 组 withBounds 请求，包含 remaining=0 与公开包装器对照，以及真实
  remaining=2/anyStressedWords 上下文；2 组精确 KEY 越界分类及安全前缀对照。
- `replays.json` 保留 649 组完整 request/result，可供 JS 实现做真实输入回归。

本报告验证原 C oracle 与 CLI 观察桥梁，不代表 JS `TranslateWord` 或完整合成
已经实现。旧 frozen trace、tokenizer 和原 `build/oracle` 均未修改。

当前 helper fingerprint：
`a554c2c93c0f8223e64e3cc73bfd4179cc7a04887115f4b74a90bdeff87df67a`。
当前 observer fingerprint：
`5de5da1fc777d8ace79c628d8f1680c945e3944cb2436128efd252670de896c0`。

# M04 固定 en-us 单词翻译

`src/core/translate-word.js` 移植 pinned `translateword.c:TranslateWord3` 和 `translate.c:TranslateWordWithBounds`。原版字典、规则、词缀、字母名称、数字、音素编码与重音服务共享会话状态；输入和输出都是字节、音素 ID 与原版元数据。此层不生成音频，也不代替 TranslateWord2 的音素列表、整句韵律或语言切换调度。

## 装配与接口

```js
import { createEnglishWordServices } from '../src/core/word-services.js';

// dictionary、selectedTable 来自已验证的数据装载器。
var services = createEnglishWordServices(dictionary, selectedTable);
var words = services.wordTranslation;
var result = words.translate(fullBuffer, {
  offset: 3,
  operation: 'withBounds',
  words: [{ flags: 0, start: 3, prePause: 0, sourceix: 1, length: 5 }],
  remaining: 1
});
```

`createWordTranslationSession(services, selectedTable, initialState?)` 是底层工厂；通常使用 `createEnglishWordServices`，由它把原 `Lookup → TranslateWord` 递归回调连接到同一会话。核心不访问 Node、文件系统、音频或宿主字符分类。phoneme table 必须是实际 index 80、en-us。

`translate(bytes, options?)` 的主接口使用完整输入 backing 与 `offset >= 3`。保留当前词前的全部字节，包括早先单词和 NUL；规则向前搜索、数字千位组与 KEY 模式会读取它们。当前词及后续文本到第一个 NUL，最后一个有效字节必须是空格；没有 NUL 时在输入尾边界终止。传入数组只借用，返回修改后的独立副本。

兼容入口省略 offset，传入 NUL-free、空格结尾的当前词及后续文本，并通过 `prefixBytes` 提供两个前置字节，默认 `[0,32]`。该入口不含更早上下文，不能用来代替真实多词调用；特别是 KEY 模式默认前缀存在已确认的原 C 越界。

三种 operation：

| 值 | 原版边界 |
|---|---|
| `word3`，默认 | 直接 TranslateWord3；TEXTMODE 返回替换文本，输出音素可能保留传入的旧值 |
| `word` | public TranslateWord；remaining 必须为 0，使用默认 alphabet/any-stressed 上下文 |
| `withBounds` | 真正有界替换包装器；保留 remaining、alphabet、any-stressed，供 TranslateWord2 接入 |

其他 options 为 `words`、`remaining`、`wordOut`、`anyStressedWords`、`alphabetCodepoint` 和 `initialPhonemes`。WORD_TAB 是含 flags/start/prePause/sourceix/length 的数组，使用原字段宽度；默认一条零值记录。`remaining` 限定仍可访问的词表项数，word3/withBounds 默认等于数组长度。`wordOut=false` 对应 NULL 输出指针，不允许将其当作“返回空替换文本”。

结果包含：

- `flags`：原版 uint32 返回值；`phonemes` 为不含终止 NUL 的 Uint8Array。
- `wordOut`：真实替换文本 bytes，或 NULL 指针对应的 null。
- `prefixAfter`、`wordAfter`、`bufferAfter`：前两个字节、当前词及后续字符串、完整输入 backing 的修改后副本。
- `wordsBefore` / `wordsAfter`：包括替换文字大小写修改在内的词表快照。
- `stateBefore` / `stateAfter`：完整暴露状态；`anyStressedWords` 为原 bool 观察值，public word 返回 null，与 C helper 一致。

`state()` 不推进处理。`setState(patch)` 为上层 Word2/整句调用者部分更新已知状态，字典重复/吞词、规则计数与重音字段同步到真实共享服务；它不允许恢复已失效会话。`translateLookup(buffer,{offset,sayAs:0})` 只供内部 Lookup 回调使用：临时清除 sayas，采用 NULL word_out 和零 WORD_TAB 语义，并保留原全局 word_phonemes 的递归效果。

## 状态与原版行为

状态字段包括 dictCondition、expectVerb/expectVerbS/expectNoun/expectPast、prevDictFlags0/1、clauseTerminator/clauseEnd、clauseLowerCount/clauseUpperCount、prePause、prevLastStress、prepauseTimeout、endStressedVowel、wordVowelCount/wordStressedCount、repeatCount/repeat/skipWords、optionSayas/optionCapitals/optionToneFlags，以及 phonemeTable/native/clauseEndRelation。clauseEnd 是相对于当前词的偏移。初值可以明确注入；未指定时采用 direct fresh-session 的 72 条件位与零计数，clauseEnd 默认当前字符串末尾空格的位置。

处理顺序保留原源码：原词字典查找、TEXTMODE/点缩写/数字/罗马数字、拼读与不可读前缀、规则识别、前缀确认和移除、多层后缀与还原、音素追加、重音、强调/末词属性、下一词词性期待值更新。Removed E、多个 suffix、prefix stress、FLAG_MAX3、dictionary_skipwords 等不由 JS 自行简化。

文本替换采用原 SegmentReplacement，保留非 ASCII 标记边界与字母间连字符切词；替换首字母按原宽度限制转小写，设置 FIRST_UPPER；递归最多 3 层，保留每次实际吞词数量，合并时插入 phonEND_WORD。遇到仅字典 flags 为 0 但有音素的 Lookup 结果，后续规则仍追加到已有音素，不能把它当成空输出。

SAYAS 字母名称使用真实 LookupLetter、derived_letters、NonAsciiNumber 与 EncodePhonemes。未命名字符会按原算法读十六进制字符码；盲文按点号处理。SetSpellingStress 保留 0xff 分隔符替换、VSHORT/NOLINK 停顿及最后一个重音。英语 fixed profile 的 spellingStress=false、minRoman=2、maxRoman=49，均由独立 C 实际导出。

源码在 FLAG_UNSTRESS_END 分支检查的是 `any_stressed_words` 指针，未解引用。此接口总有一个 bool 观察槽，因此该路径保留原条件，不按直觉改成检查 bool 值。

## 尚未覆盖的实际边界

遇到不支持路径抛出 `UnsupportedWordTranslationError`，`code='WORD_TRANSLATION_UNSUPPORTED'`，携带 `reason` 和状态，失效会话后续调用再次抛出同一错误。一般非法参数使用 TypeError/RangeError。底层服务的明确缺口保留服务 code 与 reason；未知异常不能降格成覆盖例外。

仍可能触发的 reason 包括 `letter-language`、`alphabet-name-language`、`derived-letter-language`（需要其他 translator 的字母/文字系统名称），`separator-prefix`（实际 SUFX_B 分支），以及原本有界字符名称、重音或文本替换缓冲的容量边界。返回 phonSWITCH 的词本身可在此层精确输出，实际加载其他语言并重译属于调用者工作。

`rule-source-bounds` 是实际规则读取超出给定 backing 的确定性拒绝。ASAN 使用未修改的原函数确认：`key ` / `abc `、optionSayas=36、旧 prefix=0020 时，KEY 把最后一个前导空格改为下划线，RULE_NOVOWELS 忽略 NUL 继续向左寻找空格，最终读到 text[-1]。证据 `artifacts/word-key-asan-P7rD1D/report.json`；prefix=2020 的相同输入是安全对照。该类样例属于原 C 未定义行为，绝不计为兼容通过。

## 验证与限制

```sh
node --test tests/translate-word.test.mjs
node tools/oracle/word-build.mjs
node tools/oracle/word-selfcheck.mjs
node tools/compare/word.mjs artifacts/oracle-word-8eBznr/replays.json
```

8 项集成单测验证原版音素/flags、词缀还原、重音与词性期待状态、拼读、TEXTMODE 两个边界、完整 backing 所有权和 KEY 越界的稳定拒绝。需要先构建 pinned phoneme 数据；缺数据时测试会明确跳过，正式差分入口则必须有真实数据。

开发阶段已逐字段通过 649 次真实 CLI word3 调用；正式比较器使用这些调用的明确输入和起始状态，重新调用独立 C，不把旧输出或观察答案填入 JS。另有固定词、flags、sayas、词性期待、数字、emoji、文本替换、长度与固定种子生成词的独立输入。比较完整音素、flags、替换文本、源缓冲、词表、所有暴露状态，严格检查 schema/profile 与运行前后源码和数据 SHA256。KEY 两项只在绑定请求 hash 与原 ASAN 精确诊断都满足时单列为 upstreamUndefined。

正式报告 `artifacts/word-differential-sKvwjw/report.json`：1372 个输入，其中 1370 个逐字段精确一致，共比较 10661 个音素字节；unsupported 为 0；另 2 个 KEY 输入由独立 ASAN 确认为上游未定义行为，单列、不计通过。报告目录保存 requests/oracle/results/report，失败额外保存 failure。当前 selected profile 的独立词调用通过，不等于 M04 全部语言语料或 M05–M06 整句前端验收。外部 clause_end 指针、其他 translator、音素列表输出、设备运行和性能仍需后续验证。

实现目前为正确性优先的 TypedArray 工作缓冲与有界字节拼接，未优化热路径分配。新增运行时能力与整体内存/吞吐在 M12 验证；不重发已冻结的设备探针，不以 Node 差分替代设备数据。

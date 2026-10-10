# 原 CLI 的 TranslateClause → TranslateWord2 边界观测

`tools/oracle/clause-word2-build.mjs` 生成独立的原 CLI 观察版，用于验证
M05/M06 的真实入参、跨词状态和 `MakePhonemeList` 之前的 `PHONEME_LIST2`。
固定原 commit 为 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，默认 CLI 配置
为 en-us、rate 175、pitch 50、volume 100。

## 构建与采集

```sh
node tools/oracle/clause-word2-build.mjs
node tools/oracle/clause-word2-selfcheck.mjs --trace-dir artifacts/oracle-trace-wOIRDF
```

独立二进制为 `build/oracle-clause-word2/espeak-ng`。设置
`JSPEAK_CLAUSE_WORD2_TRACE_FILE` 为输出 JSONL 的绝对路径，再使用标准 CLI
参数。以下例子从标准输入读取文本：

```sh
ESPEAK_DATA_PATH=/home/rd/dev/jSpeak/build/oracle \
JSPEAK_CLAUSE_WORD2_TRACE_FILE=/tmp/jspeak-word2.jsonl \
LC_ALL=C build/oracle-clause-word2/espeak-ng \
  -D -b 1 -v en-us -s 175 -p 50 -a 100 --stdin -x -w /tmp/jspeak-word2.wav
```

Node 工具可从 `clause-word2-build-info.mjs` 导入 `clauseWord2Binary` 和
`validateClauseWord2Build()`，在使用观察版前验证输入和输出 hash。

## 原算法与观测代码的边界

构建仅在隔离目录生成两份源文件：

- `translate.c`：给原静态 `TranslateWord2` 定义改名，由同名只读 wrapper
  记录前后状态并调用原函数体；在原调用点记录输入缓冲区来源，并在完成
  tokenizer 后及调用 `MakePhonemeList` 前记录子句状态。
- `synthdata.c`：增加只读 getter，读取真实静态 `current_phoneme_table`。

原函数体和分支逻辑保留；观察 object 与原 CLI object、原静态库链接。
`upstream/espeak-ng`、`build/oracle`、旧 frozen trace 均不修改。构建 stamp
记录原文件、观察 header、构建器、静态库、CLI object 及生成文件/二进制的
hash。环境变量未设置时不写 trace。

## 事件契约

所有事件含 `schemaVersion: 1`，`clause` 从 1 递增。事件按实际执行顺序写入。

| kind | 时点与特有字段 |
| --- | --- |
| `clause.words` | tokenizer 完成且尚未执行 Word2。含完整 `bufferHex`（含结尾 NUL）、`sourceHex`、`wordCount`、`wordsWithSentinel`（真实 count+1 项）、`sourceIndex`、`clausePause`、`tone`、`terminator`、`newSentence2`、`charixTop`、`charix`（含 4 个哨兵槽） |
| `word2.enter` | 原 Word2 执行前。含成对 `id`、`origin`、`wordIndex`、`subIndex`、完整 `bufferHex` 与 `offset`、独立的完整 `clauseBufferHex`、`remaining`、`prePauseArgument`、实际传入的 `words` |
| `word2.exit` | 原 Word2 执行后。保留相同入参标识和当前缓冲区、状态，并增加 uint32 `flags` |
| `clause.before-phonemelist` | 补完结尾两个 pause、调用 `MakePhonemeList` 前。含修改后的完整 `bufferHex`、字表和子句最终参数 |

`origin` 明确区分三种 backing buffer，避免只拼接两个前置字节来假定 CLI
上下文：

- `clause`：真实 `sbuf`，保留 tokenizer 完成时从开头到 NUL 的整个长度。
- `number-split`：真实 `number_buf`，记录原代码已经初始化的
  `(pn - number_buf) + 17` 字节。
- `spell-retry`：真实、已 memset 的完整 150 字节拼读缓冲区。

`words` 使用 `flags`、`start`、`prePause`、`sourceix`、`length`，长度等于
真实 `remaining`。`prePauseArgument` 是传给 Word2 的函数参数；它和全局
`clauseState.prePause` 是两个不同的状态。

每种事件还包含：

- `wordState`：与 [词 oracle](ORACLE_WORD.md) 相同的字典、规则、重音、选项
  状态。`clauseEnd` 是相对当前词的偏移；若指针属于其他缓冲区，返回 null
  和 `clauseEndRelation`，不伪造词内偏移。
- `clauseState`：`clauseEndOffset` 是相对真实 `sbuf` 的偏移；另含
  `prePause`、`optionEmphasis`、`optionSayas2`、`countSayasDigits`、
  `wordEmphasis`、`embeddedFlag`、`anyStressedWords`、`newSentence`、
  `maxClausePause`、`countWords`、`countSentences`、`clauseStartChar`、
  `clauseStartWord`、`skipWords`、`skipSentences`、`skippingText`、
  `optionEndpause`、`optionWordgap`、`selectedTable`、`voiceTable`、
  `currentAlphabet`（range_min 或 null）。`selectedTable` 读取真实静态选表。
- `embedded`：真实 `capacity: 250`、`index`、`read`、有效 `list`，以及
  15 项 `values`。
- `phonemesHex`：当前全局 `word_phonemes`，按原 NUL 语义截取。
- `phonemeList2`：`count`、`capacity`、`items`；每项记录 `synthflags`、
  `phcode`、`stresslevel`、`sourceix`、`wordstress`、`tonePh`。

## 字段定义和验证范围

此边界的 `wordstress` 对大部分 Word2 项尚未赋值；结尾两个 pause 的
`tone_ph` 也未初始化。观察器保留这些原始存储值供排查，但它们不能作为
此阶段的语义等价要求。结尾两个 pause 应比较 code、stress、sourceix 和
synthflags；切表项 `phcode=21` 的 `tonePh` 才是后续表编号。

`InitText` 后 `optionEndpause=0`，标准 CLI 经过 `speech.c` 后实际为
4096。两者由 `data/phonemizer/profile.js` 的 `optionEndpause` 和
`cliOptionEndpause` 分别真实导出；CLI 重放须使用后者。

正式报告：`artifacts/oracle-clause-word2-2pOOA5/report.json`。

- 68 组 CLI 输入，观察版与原版 mnemonic 和完整 WAV 字节完全一致。
- 每次观察使用两个新 CLI 进程重复，完整事件一致。
- 99 个子句、712 次 Word2 调用：628 次普通词、64 次拼读重试、20 次数字分组。
- 验证调用前列表等于前次调用后列表、最终两个 pause 的位置和有效字段。
- 与原 frozen trace 桥接 50 组输入、78 个子句，tokenizer 字表和
  `MakePhonemeList` 前规范字段全部一致。

每个用例目录保留原/观察/重复 WAV 和观察 JSONL。该报告证明观察桥梁的
透明性和所测输入的确定性；JS Word2/完整 phonemizer 的实现结果应另行对比，
此报告不代替 JS 集成验收或设备预算验证。

当前 observer fingerprint：
`b89fc5fe18cd55491292a82b3f94cad035dcc6600c1ef440457db9407f9ef913`。

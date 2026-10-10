# 整句到紧凑音素列表

`src/core/translate-clause.js` 组合 ReadClause、tokenizer、真实词典/规则/词重音、TranslateWord3 与 TranslateWord2，输出 `MakePhonemeList` 之前的 `PHONEME_LIST2`。固定范围为 en-us、UTF-8、rate175、pitch50、amplitude100、seed1，不包含音频合成。

## 接口

```js
const engine = createEnglishClauseTranslation(inputBytes, loadedDictionary, selectedTable, { trace });
while (engine.hasMore()) {
  const clause = engine.next();
  // clause.phonemes.list 是固定1000项的紧凑arena
}
```

`trace(kind, row)` 按实际执行顺序输出 `clause.words`、`word2.enter`、`word2.exit` 和 `clause.before-phonemelist`。`word2.enter` 同时保留 `wordIndex`（原句词索引）、`rowIndex`（数字拆分内的行索引）和 `subIndex`，避免把三种索引混成一个字段。

## 原语义细节

- 外层停止条件使用 decoder EOF，与上游 `text_decoder_eof` 一致；最后一个真实子句后不再额外生成 EOF 空子句。
- `clause_end` 在 Word2 入口按当前词起点转换；子句结束观察则按第一个词起点复位。
- `spell-retry` 与 `number-split` 的独立缓冲与原句 `clause_end` 指针不是同一来源，关系为 `after-source`，不伪造词内偏移。
- 数字拆分的 16 字节尾窗可能让最后一组以 NUL 结束；原 `TranslateWord3` 把 NUL 当词界，JS 保留该行为。
- 无词子句的 `clause_end` 关系为 `before-source`；观察器中的 `null` 在 JS 状态里以 0 加同名关系表示。

## 验证

`node tools/compare/clause-translation.mjs artifacts/oracle-clause-word2-2pOOA5`

- 68 组原 CLI 输入全部 exact。
- 99 个子句、712 次 Word2 调用、3409 个紧凑音素项一致。
- 词级 `TranslateWord3/WithBounds` 正式差分：1372 组、1370 exact、10661 个词音素比较、0 服务缺口；2 组为已审查的原 C 源下溢 UB。
- 全量 Node 回归：252/252、0 skip。
- 覆盖 `clause`、`number-split`、`spell-retry` 三种 Word2 起源。
- 整句报告：`artifacts/clause-translation-K5mAKJ/report.json`
- 词级报告：`artifacts/word-differential-7OupSZ/report.json`

比较只使用语义字段，不把 `wordstress` 的未初始化原始存储或结尾 pause 的未初始化 `tone_ph` 当等价条件。此结果不包含 `MakePhonemeList`、prosody、DSP 或音频输出。

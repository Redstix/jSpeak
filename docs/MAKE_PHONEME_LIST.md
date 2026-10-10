# MakePhonemeList 完整输出

`src/core/make-phoneme-list.js` 在 `src/core/phoneme-list-prepare.js` 的 pre-VM 边界之后执行原 `phonemelist.c:MakePhonemeList`：运行真实 `phonindex` 程序、处理替换/插入/追加、计算默认长度与词/句/子句标记，并输出完整 `PHONEME_LIST`。

## 接口

```js
const maker = createPhonemeListMaker(phonindexBytes, selectedTable);
const result = maker.make(prepared, { postPause, startSentence });
// result.list 是固定1000行的复用arena，result.count是有效行数
```

同一个 maker 实例对应一个原 C 进程中的全局 `phoneme_list` arena。它跨子句复用输出缓冲；终止 pause 行只写原 C 明确赋值的字段，`stresslevel`、`wordstress`、`tonePh`、`env`、`amp`、`pitch1/2` 等保留上一子句的实际存储值。不要在每个子句后清空 arena，否则会丢失这个原行为。

## 原语义

- 使用真实 `InterpretPhoneme`，不是按音素表平均时长猜长度。
- 支持 `CHANGE_NEXTPHONEME`、`INSERTPHONEME`、`CHANGEPHONEME`、`APPENDPHONEME` 与重解释。
- 保留 en-us 的 unstressed-vowel 规则、`SFLAG_LENGTHEN` 插入、词/句/子句 `newword` 位、默认 `length=128` 与结尾两个 pause。
- 当前固定 profile 的 `regressiveVoicing`、`vowelPause`、`wordGap`、`optionWordgap` 均为 0；非零配置显式拒绝。

## 验证

`node tools/compare/make-phoneme-list.mjs artifacts/oracle-clause-word2-2pOOA5`

- 99 个真实 CLI 子句全部 exact。
- 3430 个完整 `PHONEME_LIST` 行一致。
- 覆盖 68 组原 CLI 输入产生的所有 pre-MakePhonemeList 子句。
- 报告：`artifacts/make-phoneme-list-HpMyKA/report.json`

比较包含 `count`、`phcode`、`stresslevel`、`wordstress`、`tonePh`、`sourceix`、`synthflags`、`length`、`env`、`type`、`prepause`、`amp`、`newword`、`pitch1/2`、`stdLength`、`phontabAddr`、`soundParam` 和 `tonePhData`。此结果不包含后续 `CalcPitches`、`CalcLengths` 或 DSP。

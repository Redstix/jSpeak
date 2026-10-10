# 2026-10-05 M07 MakePhonemeList 记录

固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`、en-us、`phonindex` 48856B。本记录验收完整 `MakePhonemeList` 输出，不包含后续 prosody 或合成。

| 验证 | 结果 | 报告 |
|---|---|---|
| 原 C `MakePhonemeList` 完整输出 | 99个子句、3430行全exact，0服务缺口 | `artifacts/make-phoneme-list-HpMyKA/report.json` |
| 输入来源 | 68组原CLI输入的真实 pre-MakePhonemeList 子句 | `artifacts/oracle-clause-word2-2pOOA5/report.json` |

`tools/oracle/phoneme-make-oracle.c` 直接调用原 `MakePhonemeList` 并输出完整 `phoneme_list`；`tools/compare/make-phoneme-list.mjs` 用 JS `createPhonemeListMaker` 逐子句比较。比较包含所有输出字段和跨子句 arena 残留。

实现保留一个关键原行为：`phoneme_list` 是进程级复用缓冲，终止 pause 行不重置全部字段。因此同一 maker 实例必须跨子句复用输出 arena；每子句新建缓冲会把原 C 的跨子句残留错误清零。

接口与限制见 [MAKE_PHONEME_LIST](../MAKE_PHONEME_LIST.md)。`CalcPitches`、`CalcLengths`、`Generate` 和 DSP 尚未验收。

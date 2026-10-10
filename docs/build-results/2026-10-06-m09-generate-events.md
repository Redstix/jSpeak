# 2026-10-06 M09 Generate 事件记录

固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`、en-us、rate175、pitch50、amplitude100。本记录验收 `Generate` 的高层事件计划，不包含 PCM 或有界队列调度。

| 验证 | 结果 | 报告 |
|---|---|---|
| Generate 高层事件 | 99子句、19994事件全exact，0服务缺口 | `artifacts/generate-events-uhdGD0/report.json` |
| 输入来源 | 68组原CLI输入的真实 pre-MakePhonemeList 子句 | `artifacts/oracle-clause-word2-2pOOA5/report.json` |

观察器重编译 `synthesize.c` 和 `wavegen.c`，并将 `N_WCMDQ` 放大为 4096 以暴露完整逻辑事件。原 170 项队列的满队 resume、重复当前音素和消费调度不在此验收范围内。

接口与限制见 [GENERATE_EVENTS](../GENERATE_EVENTS.md)。

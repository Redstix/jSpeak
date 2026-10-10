# 2026-10-05 M02.2 文本服务集成记录

固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`、en-us/UTF-8、seed1。实际原始字典、TranslateRules、TranslateWord、accent和词重音共用状态，打通标点公告、字母名、文本替换和省略号查询。

| 比较入口 | 结果 | 报告 |
|---|---|---|
| ReadClause→tokenizer | 990输入，989 exact/7390词条，0服务缺口；1原C越界单列 | `artifacts/tokenizer-differential-SIxRup/report.json` |
| 直接ReadClause（基础639+公告/省略号） | 864输入、1695返回全exact | `artifacts/read-clause-names-PuNVxx/report.json` |
| 原静态LookupCharName | 860输出及共享状态exact，含+ | `artifacts/character-names-xAwXf8/report.json` |
| 原LookupLetter与组合accent | 1536+768输出及共享状态exact，0依赖例外 | `artifacts/letter-names-gIoVqX/report.json` |

以上报告依次SHA256：

- `f5e76af7bf1cdc1d3a33b74ad197ec324170bdda976bc5160f59123fd455f4c9`
- `a3b9afac98ba20de2d9e5a5079bbe55de4bf9eef99daa8e06e8e425ee247fa8a`
- `036460990eb50434a27e9fb3ce95b5ea17da221072dfae686ac0db11f2995560`
- `3759ef049b6140b71c9bd4d855cc965b43d516f2bc95b43137682baed3e4698b`

每份报告记录核心静态imports的完整传递依赖hash，运行前后检查不变；并行编辑导致的snapshot失败不签发通过报告。C字母/字符服务逐批重复并另与clean库比对；完整read/tokenizer以原始C状态和字节序列为准。

原C `ab - `加88个韩文字会越过`sbuf[800]`，JS明确拒绝并单独记录，不计入exact。此前M02.1的41项和中间标点服务缺口是历史报告，保留原文件；不能将这些历史数字当成当前服务状态。

集成还保留原Lookup返回0标志但输出非空、后续TranslateRules追加的行为。例如¢拼读会产生两份cents；已加实际字典组合回归，不人为简化原C输出。接口和状态边界见[CHARACTER_NAMES](../CHARACTER_NAMES.md)。

最新整合Node测试238/238、0 skip，`artifacts/core-after-m02-closure-fixed.tap`；首次整合发现旧测试未接受新增的初始phonemes回调字段，修正契约期望后通过。

范围限制：此处比较ReadClause/tokenizer调用边界，不包含完整多clause TranslateWord2/MakePhonemeList调用者、动态语言闭包或PCM合成。候选`closureComplete:false`不变。已交付probe0.4.1未重建，设备仍无需新操作。

# 2026-10-05 M03 固定en词典运行时记录

上游固定 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。原数据182152B、SHA256 `621c5825c37cff4510ab4e9a724314587995c78bcb86675d21964fe896ad2d4c`；规则offset124920、7792词条、1024bucket、72双字节组。

本轮实现/接口见[DICTIONARY](../DICTIONARY.md)。数据装载有界且无运行期I/O；词典内容原样保存，转置表与常量由固定源码生成。完整前端和PCM尚未完成。

| 验证 | 结果 | 报告 |
|---|---|---|
| 最终C/JS字典差分 | 8399请求，7920lookup、524transpose exact；495 clean对照、271重复、415共享上下文 | `artifacts/dictionary-differential-ObRuEg/report.json` |
| 独立原始字节补查 | 792请求、912lookup exact，含256单字节和512畸形/随机bytes | `artifacts/dictionary-audit-bUM0JA/report.json` |
| 独立连续混合查询 | 22次exact，覆盖repeat/普通词/短语/accent/缩写 | `artifacts/dictionary-sequence-audit-bs3MQ1/report.json` |
| 独立目录重新生成 | 原始binary、manifest、profile逐字节一致 | `artifacts/dictionary-regeneration-jscDg0/report.json` |
| 核心边界/回归 | dictionary10项及character names4项通过，accent另4项通过 | `tests/dictionary.test.mjs`等 |

最终报告SHA256：`ff6b6e51764119a7a83f2fd7adbc12b17728f1fad57db77ef29cb922b4a5fe7b`。
独立字节补查SHA256：`fcf2815c41da74224bce7d1d52cc66ec7cae16ab4c172411ded24cd94d278c81`。
连续查询SHA256：`3641e35f585104e6cac5a8f8f9c6ca089f81b0b751715b559a91138b61b9d7f9`。

最终lookup结果含5742 found、2178 missing；其中1088属性结果、10文本替换、424多词匹配、41accent路径。分类可重叠，不相加为独立请求数。

早期 `dictionary-differential-cxlxe8` 是显式规范化上下文的历史记录。独立复核发现默认clauseEnd对嵌入NUL的处理不同；修复后最终runner直接传原始settings，增加真实等号重复抑制，以上最终报告取代早期报告作为当前验收证据。

现有RPK0.4.1未重建；这些核心代码没有进入已交付包。数据候选的 `closureComplete:false` 保持不变；hy/ko/ar/hi动态字典缺口不由本次固定en验收关闭。

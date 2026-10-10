# 英语数字与罗马数字

`src/core/number-translation.js` 移植固定上游
`ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 的 `numbers.c` 英语执行路径：
`TranslateNumber`、`TranslateNumber_1`、`LookupNum2`、`LookupNum3`、
`LookupThousands` 和 `TranslateRoman`。音素逐次从现有原始 `en_dict` 查找，
未保存数字到音素的答案表；运行时无 Node、I/O 或 C 调用。

内部暂用 binary JS strings 拼接音素：每个字符只承载一个原始字节，不按
Unicode 字符解释音素。公开输入输出使用 Uint8Array，输出容量明确限定在
200..1024 字节，输入副本额外保留 512 字节供原算法式前后文访问；中间字符串
会分配临时对象。当前差分是正确性证据，不是设备峰值内存、耗时或整阶段预算
证据；typed-array 优化应在后续测量阶段保持这些已验证语义。

实际初始化 profile 从原 C 导出到 `data/number/profile.js`：
`numbers=16779328`（`NUM_HUNDRED_AND | NUM_1900 | NUM_ROMAN`）、
`numbers2=0`、逗号千分位、句点小数、Roman 范围 2..49、空 Roman 后缀、
无 ordinal indicator。其他语言、其他 numbers 配置不在该实现范围。

## 接口与共享状态

```js
const service = createNumberTranslation(dictionarySession, {
  lookupSymbol // 可选：(Uint8Array, dictionaryContext) -> {flags, phonemes}
});
const result = service.number(fullBuffer, {
  offset: 3,
  words: [{ flags: 0, start: 3, prePause: 0, sourceix: 1, length: 2 }],
  remaining: 1,
  capacity: 200,
  control: 0,
  flags: [0, 0],
  initialPhonemes: new Uint8Array(0),
  optionSayas: 0,
  dictionaryContext: { dictCondition: 72, clauseEnd: 2 }
});
```

`fullBuffer` 保留真实前文，`offset >= 3` 指向当前数字词。函数复制输入并在
结果 `buffer` 返回原输入长度的全部调用后字节，调用方负责采纳这些修改。
数字逻辑会读取 `word[-3]` 判断是否是前一千分组的延续；仅提供两字节前文
不足以覆盖该契约。当前词应使用 tokenizer 的 ASCII 数字、空格分词布局，
例如 `1, 000 `、`21 st `。该函数不负责从原始用户文本分词或规范化标点。

`.roman(fullBuffer, settings)` 使用相同布局，输入为 tokenizer 已转小写的
Roman 字母。它保留原解析限制：单字母即使数值位于范围内也不视为 Roman，
无效减法/重复组合被拒绝；成功时清零 caller 的两个 prev dictionary flags。

`result` 包含：

- `found`：原 C 的 0/1 整数；`phonemes:Uint8Array`、`flags:Uint32Array(2)`。
- `buffer`、`words`：调用后的完整源字节和 WORD_TAB 副本。
- `stateBefore`、`stateAfter`：本 translation unit 的持久数字状态。
- `dictionaryState`：共享字典的 repeat、repeatCount、skipWords。
- `prevDictFlags0`、`prevDictFlags1`：调用后需写回 caller 的字段。

`dictionaryContext` 接受现有词级状态字段：`dictCondition`、`expectVerb`、
`expectVerbS`、`expectNoun`、`expectPast`、`prevDictFlags0/1`、
`clauseTerminator`、`clauseEnd`。`clauseEnd` 相对当前词，语法 expect 字段
按原 C 的非零语义转换为字典接口的 uint32。

`state()` 与 `setState(partialState)` 管理 `speakMissingThousands`、
`numberControl`、`nDigitLookup`（int32），以及 `ordinal2`、`ordinal2x`
（最多 11 字节的 Uint8Array）。`speakMissingThousands=-1` 是正常状态，
不应被非负数验证拒绝。数字函数与嵌套 Lookup 必须使用同一字典 session。

默认 Lookup 包装器使用原 symbol/textmode 标记；若真实条目要求 TEXTMODE，
调用方应提供已集成 TranslateWord 的 `lookupSymbol`。缺依赖时抛出
`NUMBER_UNSUPPORTED / translate-word-textmode`，不猜读音。容量支持
200..1024 字节；原始初始 sprintf 输出若超过容量，显式报告
`original-initial-buffer-overflow`。带负号的直接原始数字输入显式报
`negative-source`；正常 tokenizer 数字入口和大于 INT_MAX 的拒绝路径已覆盖。

## 原 C 参考与数据来源

```sh
node tools/build-number/build.mjs
node tools/oracle/number-build.mjs
node tools/oracle/number-selfcheck.mjs
node --test tests/number-translation.test.mjs
```

profile 导出器只输出实际语言配置和原头文件常量，manifest 记录上游源码、
静态库、完整 data fingerprint、导出器与输出 hash。

`createNumberOracle()` 来自 `tools/oracle/number.mjs`，每请求新进程；
通过 `#include "numbers.c"` 编译原始 translation unit，以便准确初始化和
观察原私有数字状态，未复制或改写算法。`createNumberOracle({clean:true})`
则只链接原静态库，返回不可见的 numberState 为 null，不允许覆盖私有状态。
构建 stamp 同时验证两个二进制和全部输入。

oracle 请求 `{operation:'number'|'roman', utf8Hex, prefixHex?, words?,
remaining?, capacity?, control?, flags?, initialPhonemesHex?, state?,
numberState?}`。`utf8Hex` 是空格结束且无 NUL 的当前词及后续源字符串；
`prefixHex` 默认 `002020`，精确提供原数字算法所需的三个前置字节。
`state` 使用词 oracle 的显式状态字段；`numberState` 对应 runtime 状态，
两个字节串字段在 oracle 中命名为 `ordinal2Hex`、`ordinal2xHex`。
响应保留完整规范化请求、参考指纹、flags、音素、源和 WORD_TAB 修改、
translator 前后状态以及私有数字前后状态。

## 验证结果

正式报告：`artifacts/oracle-number-bpHsqm/report.json`。

- 1,213 组 C/JS 音素、flags、buffer、WORD_TAB、字典和数字持久状态一致。
- 70 组额外比较原静态库与可观测私有状态的 C helper，公开可见结果一致。
- 包含 0..999 全量、1900 年式、十百千、INT_MAX/溢出、前导零、序数、
  多个千分组、分数和重复小数点、2..49 Roman/无效 Roman、输出保留、
  individual digits/SAYAS_DIGITS、remaining=0 和 int32 状态边界。
- 3 项运行时行为测试通过：独立数字委派、完整千分组前文、Roman 限制。

这验证固定英语数字服务；完整 `TranslateWord` 状态编排、发音列表生成与
完整合成是其他阶段的工作。C oracle 未声称完成所有任意参数组合的全程序
未定义行为审计。旧 word/trace/tokenizer 报告继续独立保留。

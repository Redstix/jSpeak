# EncodePhonemes

`src/core/phoneme-encode.js` 移植固定上游
`ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 的
`dictionary.c:EncodePhonemes`。使用现有 `createPhonemeTables(...).select(index)`
得到的原始音素表，无额外 mnemonic 映射缓存，不修改 `phoneme-table.js`。

```js
const result = encodePhonemes(bytes, selectedTable, {
  offset: 0,
  reportBadPhoneme: true
});
// { phonemes: Uint8Array, offset: absoluteNextByte, badPhoneme: int | null }
```

函数编码一组空白分隔的 mnemonic，跳过前导 C-locale 空白。`offset` 是原 C
返回指针相对整个输入的绝对字节偏移；遇到未知 mnemonic 时返回坏字符起点
加一，而不是加完整 UTF-8 长度。`badPhoneme` 使用原 `utf8_in` 语义读取码值，
未报错为 0；`reportBadPhoneme=false` 对应 NULL 指针，返回 null。

完整保留这些控制行为：

- 在所有非 NULL、非 `phINVALID` 项中选择最长完整 mnemonic；等长时保留
  表扫描中先遇到的项，最多匹配四字节。
- 单个 `|` 只分隔相邻 mnemonic，`||` 通过原音素表编码为 word break。
- `phonSWITCH` 后的语言字符串按 C-locale ASCII 小写化；后面还有空白时
  附加 `|`，终端恰为默认语言 `en` 时省略语言名，保留 switch code。
- 真实 NUL 终止源字符串，输入中的其他字节保持原 byte 语义；高位字节的
  空白和小写判断不使用 Unicode 字符串规则。

公开输入输出均为 Uint8Array。内部复制完整输入并添加八个终结零字节，保留
原 mnemonic 探测和 UTF-8 scanner 的读取边界；输出通过临时数字数组构建。
该函数本身没有 C 原函数不存在的静默截断选项，调用方应检查其目标 buffer
容量。这里的 Node 正确性验证不代表设备分配、峰值内存或速度预算已达标。

```sh
node tools/oracle/phoneme-encode-build.mjs
node tools/oracle/phoneme-encode-selfcheck.mjs
node --test tests/phoneme-encode.test.mjs
```

参考 helper 只初始化原库、选择真实 phoneme table 并调用公开
`EncodePhonemes`，不复制算法或生成独立答案表。构建 hash 覆盖原库、源码、
phontab 和 helper。`createPhonemeEncodeOracle()` 请求为
`{index:80,encode:[hex | {bytesHex,offset,reportBadPhoneme}]}`；每次调用一个
新进程，最多 16,384 项，每项最多 8,192 字节，总二进制 frame 最多 16 MiB。

正式报告：`artifacts/oracle-phoneme-encode-wBp0Mb/report.json`。
全部 141 张原始音素表共 226,377 项比较，音素字节、返回偏移和坏字符值完全
一致。覆盖各表实际 mnemonic、最长匹配和分隔组合、语言切换、所有 256
单字节、嵌入 NUL、UTF-8 异常、非零起点以及固定种子的随机输入。en-us 批次
另用新进程重复。3 项运行时行为测试验证关键控制语义。

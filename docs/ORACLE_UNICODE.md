# 固定 C Unicode Oracle

该开发工具为 M01 提供真实 eSpeak NG C 参考：UTF-8 decoder 的边界/游标、common.c 与固定 UCD 的分类/大小写、utf8_out 输出。它不进入设备运行时，也不单独证明 JS 已兼容。M01 的运行时实现和 C/JS 验收见 [SOURCE_MAPPING.md](SOURCE_MAPPING.md) 及项目状态。

## 构建和检查

需要 Node 24、Git、CMake、C/C++ 工具链，先有固定的 clean reference 与隔离 trace 构建：

```sh
npm run oracle:build
npm run oracle:trace:build
npm run oracle:unicode:build
npm run test:oracle:unicode
node --test tests/trace-unicode.test.mjs
```

已存在且验证通过的前两项不必重复构建。Unicode 构建将同一 [unicode-oracle.c](../tools/oracle/unicode-oracle.c) 分别链接 clean/instrumented 静态库，在 `build/oracle-trace/unicode/` 生成两个 helper。它不改 `upstream/espeak-ng/`、`build/oracle/` 或稳定 trace 补丁。

[build-unicode.mjs](../tools/oracle/build-unicode.mjs) 从 trace CMake cache 读取实际编译器。独立 stamp 约束 helper 源码、相关头文件、两套静态库、编译参数/编译器、两个 helper binary hash 和原 trace fingerprint；[unicode-build-info.mjs](../tools/oracle/unicode-build-info.mjs) 拒绝过期来源。库与源码是行为依据，JSON adapter 不实现 Unicode 算法。

## JSON 协议

[unicode.mjs](../tools/oracle/unicode.mjs) 从 stdin 接收一个请求或有序请求数组：

```sh
node tools/oracle/unicode.mjs < requests.json
```

```json
{
  "utf8Hex": "61c3a90062",
  "termination": "c-string",
  "classify": [65, 73, 160, 769, 2406, 128512, 55296],
  "dotlessI": false
}
```

字段可省略，默认不解码、空 classify、c-string、dotlessI=false。未知字段/模式、非法 hex、超出 uint32 的码点及非 boolean 的 dotlessI 均失败。每请求最多 65536 字节、65536 个分类码点；批处理最多 1024 个请求、4 MiB JSON。成功 exit 0，协议或运行失败 exit 2。

响应为 `{schemaVersion:1, reference, request, decode, classifications}`。reference 含 upstreamCommit、traceFingerprint、helperFingerprint、profile=`utf8-unicode-v1`。批处理保持请求顺序。decode 不请求时为 null；classifications 保持传入码点顺序。

Node 调用先 `createUnicodeOracle()` 验证构建一次，再调用返回函数 `oracle(request)`；第二参数 `{reference:true}` 调用 clean C helper。函数输出相同协议，便于在差分批次内复用已校验来源。

## 解码和 EOF 契约

| termination | 传给 C 的 length | 语义 |
|---|---|---|
| c-string（默认） | -1；存储追加 NUL | C strlen+1，首个 embedded NUL 之后不可见；对应现有 CLI |
| nul-terminated | 输入长度+1；追加 NUL | 保留 embedded NUL，读完整逻辑 buffer |
| bounded | 精确输入长度 | 不把后面的零填充算入逻辑 buffer |

`decode` 包含 inputByteLength、bufferByteLength、steps、terminal。steps 中的 codepoint/peekBefore 为 uint32；offsetBefore/offsetAfter/remainingBefore/consumedBytes 以字节计；eofBefore/eofAfter 是 boolean。peek 必须不移动游标，步骤执行到 eof，不能把返回的 0 自行当作停止条件。

终态是 `{offset,eof:true,peek:0,getcSupported:false}`。**普通 C UTF-8 decoder 不保护 EOF 后 getc**；helper 不执行越界调用。getcSupported=false 是安全调用契约，JS next 在 EOF 后应显式拒绝，不伪造 C 的 EOF 返回值。

固定源码有非标准行为，测试已记录：bounded 的 `c3a9` 是截断，而追加 NUL 后为 é；`efbfbd` 映射到 U+001A；overlong `c080` 得到 0；surrogate `eda080` 保留 U+D800；BOM 保留；错误 continuation 会退回供下次读取。不能用宿主 TextDecoder/TextEncoder 覆盖这些行为。

## 分类和编码字段

每个 classification 含 codepoint、category、lower、upper、ucdLower、bracket、utf8Hex，以及 21 个数字 0/1 标记：

- common.c：isAlpha、isDigit、isDigit09、isSpace、isSpace2、isEmoji、isRegionalIndicator、isEmojiModifier、isEmojiTag。
- compat/wctype.h 实际映射到 pinned ucd_*：iswAlnum、iswAlpha、iswBlank、iswCntrl、iswDigit、iswGraph、iswLower、iswPrint、iswPunct、iswSpace、iswUpper、iswXdigit。

category 是固定 UCD 枚举；lower 是 towlower2 返回转 uint32，upper/ucdLower 是原 UCD 单码点映射。dotlessI 仅设置 towlower2 实际读取的 langopts.dotless_i；true 只验证 primitive 分支，不启用额外语言合成。bracket 保留 IsBracket 原 int 值。utf8Hex 直接来自 utf8_out：surrogate 输出三字节，cp>=0x110000 输出空格。

完整位宽、语义和源码对应见 [TRACE_FORMAT.md](TRACE_FORMAT.md#独立-unicode-primitive-oracle-v1) 与 [SOURCE_MAPPING.md](SOURCE_MAPPING.md)。

## 全码点参考与已执行验收

`exportUnicodeTable({start=0,count=0x110000,reference=false})` 返回 Buffer，每行 32 字节小端：flags、category、lower、upper、ucdLower、bracket、utf8Packed、utf8Length。flags 位顺序由 `unicodeFlagFields` 导出；`unpackUnicodeTableRow(bytes,index,codepoint)` 转成同形分类对象。导出对应 dotlessI=false。它用于独立验证，不代替 JS common.c 逻辑移植。

2026-10-05 [首次自检](../artifacts/oracle-unicode-0FsKwe/report.json) 与 [root 独立复跑](../artifacts/oracle-unicode-JT7e0F/report.json) 结果一致：

- **1086** 个三模式 UTF-8 用例、**201991** 个 decoder step，两套 C 输出 exact。
- **543** 个分类码点 × 两种 dotlessI 状态，输出 exact。
- **1,114,112** 行完整 Unicode 范围，分类/case/bracket/编码字节表 exact。
- 协议测试 **4/4**，覆盖 batch 顺序/稳定性、边界和错误输入拒绝。

固定无效字节 seed 为 `0x5eedb17e`；语料还包括 22 smoke、全部 256 单字节、NUL/BOM/截断/overlong/surrogate/错误 continuation、65536-byte 长输入。自检失败保存 seed、当时 request 和错误；把 failure.json 的 request 单独送入 JSON CLI 可重放，自动缩减尚未实现。

报告 SHA256：`93a08bc7b3dfc40bae48f63ccb736292b2153c67ab9577df6a9d5caad87360d5`；全码点表 SHA256：`d6736af2f8bad7bcd1d1577ec14e4ca6c6e164c6534c265567b999a9a06d3053`；helperFingerprint：`eafacd1b3149485c3f9d48452f868beb4b264767a0703a80d0fc331a13531829`。本地产物目录忽略于 Git，换机应重新生成。

当前不覆盖其他编码、common.c:utf8_in/utf8_in2、任意内部状态恢复或 JS UTF-16 string 的 paired/lone-surrogate 接入策略。该 C helper 的测试结果与 M01 C/JS 差分结果分别记录。没有开发 helper 时，常规协议测试明确 skip；强制 `test:oracle:unicode` 会失败，不静默跳过。

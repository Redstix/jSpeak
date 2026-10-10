# M02.1 标点属性与 clause type

`src/core/clause-type.js` 实现固定 eSpeak NG `readclause.c:clause_type_from_codepoint` 的代码点分类原语，提供 ReadClause 所需的 `CLAUSE` 位掩码。它不实现完整文本切分、标点读名或字典行为。

接口：

```js
import { CLAUSE, clauseTypeFromCodePoint, clausePropertyBits } from '../src/core/clause-type.js';
const attributes = clauseTypeFromCodePoint(0x3f); // CLAUSE.QUESTION
```

`clauseTypeFromCodePoint(cp)` 接收 uint32 整数，返回 C `int` clause 位掩码。负值、NaN、小数、超过 uint32 的数字和其他类型显式拒绝。`0x110000..0xffffffff` 对应上游无效 Unicode category `Ii`，原始属性为 0，因此返回 `CLAUSE.NONE`。`CLAUSE.NONE` 是 **0x4000，而非 0**。

`CLAUSE` 保留 `translate.h:211–243` 的全部 30 个宏，键名去掉 `CLAUSE_` 前缀。pause、intonation、type 和 option 是可组合的位字段，不能把完整返回值当成互斥 enum。包括 `QUESTION | EXCLAMATION` 在内的上游位运算应原样保留。

## 原始属性与算法分离

上游先调用 `ucd_lookup_category(cp)`、`ucd_properties(cp, category)`，再对 `properties & 0xFFF0000000000000` 做**完整值 switch**。JavaScript 移植保留该 switch，未序列化或查表返回 C clause 答案。

独立生成器 `tools/build-clause/export-properties.c` 仅链接固定上游 `categories.c` 与 `proplist.c`，为全部 1114112 个 Unicode 码点导出 `ucd_properties >> 52` 的原始高 12 位。它不链接 `readclause.c`，也不调用 `clause_type_from_codepoint`。Node 打包器将相同非零属性合并为稀疏闭区间；零属性缺省，不存放分类结果。

生成物 `data/clause/properties.js` 目前包含 128 个 `[start,end,top12]` 区间，TypedArray 占 **1536 字节**。模块初始化一次分配这张表及常量对象；1536 字节仅指表的 backing store，不包含 JS 对象、源码解析或运行时开销。查询是无临时数组分配的二分查找与 switch，不依赖宿主 Unicode、文件系统、BigInt 或异步 API。

`clausePropertyBits(cp)` 返回精确的 12 位原始属性；对应 C helper 的 `propertiesHigh >>> 20`。运行时最大属性值为 4095，不把 64 位属性装入 JS Number 再做位运算；所有 clause 常量/结果处于 32 位整型可精确表示范围。生成工具解析原头文件中的 64 位常量时使用 BigInt，仅在 Node 构建阶段运行。

容易误改的行为：

- `¿`/`¡` 返回 `SEMICOLON | OPTIONAL_SPACE_AFTER`。
- 亚美尼亚语问号/感叹号携带 `PUNCTUATION_IN_WORD`。
- `…` 携带 `SPEAK_PUNCTUATION_NAME | OPTIONAL_SPACE_AFTER`。
- `U+2029` 是 PARAGRAPH；`U+2028` 在该原语中仍为 NONE，行处理属于 ReadClause。
- `U+2048`/`U+2049` 同时带 QUESTION 和 EXCLAMATION 原始属性，原 switch 没有该完整组合，因此返回 NONE，不能擅自选择其中一种。

## 来源、构建与验收

固定 commit：`ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。完整源文件 SHA256、source fingerprint、原始导出 SHA256、生成模块 SHA256、常量和布局写入 `data/clause/manifest.json`。源为固定 ucd-tools 的 Unicode 11 数据与 eSpeak 扩展属性；不使用当前系统的 Unicode 版本。许可为 GPL-3.0-or-later，并保留仓库 `licenses/espeak-ng/COPYING.txt`、`COPYING.UCD.txt` 的相关条款和版权说明。

```sh
node tools/build-clause/build.mjs
node --test tests/clause-type.test.mjs
node tools/build-clause/verify.mjs
```

构建要求本机 C 编译器与干净、固定版本上游 checkout；默认单元测试直接检查已生成表，不要求构建 C。生成时严格校验 64 位 mask 与导出布局，常量提取只接受整数、既有宏名和按位 OR，未知表达式直接报错，不执行源文本。

独立验收由 `tools/oracle/clause.mjs` 调用上游真实 `clause_type_from_codepoint` 并导出 category/完整 property/真实返回值。`verify.mjs` 对全部 Unicode 码点同时比较原始 top12 与 JS clause 返回值，并追加 6 个 Unicode 外 uint32 边界；保存 C reference、JS/表/生成器/verifier 文件 SHA256 与结果。它不以本生成器的输出充当 C 算法参考。运行前需先构建独立 clause C helper；缺失或来源不符会失败，不能视为通过。

此原语通过不代表完整 M02 或任何发音、韵律、TTS 功能通过。固定profile的 `ReadClause` 支持切片另已实现并差分，范围见 [READ_CLAUSE](READ_CLAUSE.md)；字典/embedded和tokenizer等完整M02依赖仍待补齐。

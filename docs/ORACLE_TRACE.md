# M00 前端 Trace Oracle：实现与验证记录

2026-10-05：已实现可执行的前端观察切片；M00 仍未整体完成。新增源码补丁、隔离构建、严格 schema/比较器、语料生成与重放均在仓库内，原 `upstream/espeak-ng/` 与 `build/oracle/` 保留不变。

## 执行入口

```sh
npm run oracle:build
node tools/oracle/build-trace.mjs
node tools/oracle/generate-trace.mjs
node --test tests/trace.test.mjs
```

已有干净 baseline 时可直接从第二条开始。工具链要求 Node 24、Git、CMake、C/C++ 编译器；本次环境缺少构建工具，已安装 cmake/build-essential。新构建使用 GCC 13.3.0，linux x64。构建不访问系统音频、不安装 eSpeak、不修改 upstream checkout。

隔离源码：`build/oracle-trace/source/`；隔离构建：`build/oracle-trace/build/`。补丁增加 development-only helpers，在 `JSPEAK_TRACE_FILE` 指定文件逐事件写入；变量未设置时不输出，不改变合成状态。文件打开/写入失败以进程错误退出，避免静默丢失 trace。

## 本次证据

完整报告：[report.json](../artifacts/oracle-trace-wOIRDF/report.json)；上游测试：[upstream-tests.log](../artifacts/oracle-trace-wOIRDF/upstream-tests.log)、[JUnit](../artifacts/oracle-trace-wOIRDF/upstream-tests.xml)。这些位于忽略的本地产物目录；清理或换机后用命令重新生成，不将链接存在当作测试自动通过。

| 检查 | 实际结果 |
|---|---|
| 编译数据 | 全目录路径、长度和 SHA256 指纹 clean/instrumented 相同 |
| 输入语料 | 22 个既有 smoke + 12 个边界 + 16 个 seed `0x5eed1234` 语义变体，共 50 例 |
| 独立进程 | 每例 clean 两次、instrumented 两次，共 200 次 |
| 声学/CLI | 全部 phoneme mnemonic、完整 WAV bytes 精确相同；有文件者均为 PCM16 mono 22050Hz |
| 内部 trace | 两次独立插桩输出精确相同；共 3027 个事件、78 个 clause |
| 比较器单测 | 8/8，通过未知字段/版本/事件/位宽/NaN/非法序号/表链/不完整 clause 拒绝，异构事件/键顺序稳定首差，以及真实子进程 mismatch 非零退出 |
| 上游 CTest | 19/19，通过；总耗时 27.83s |
| 源码卫生 | `git -C upstream/espeak-ng status --porcelain` 为空；`git diff --check` 通过 |

本次上游测试包括 api、encoding、ieee80、readclause、BOM、cmd_options、dictionary、基数/序数、language-phonemes/pronunciation/replace、SSML、translate、variants、voices、crash、klatt 和文件执行位检查。MBROLA 由固定配置关闭；Windows data/installer 在上游 CMake 中未注册。通过这些测试不表示当前 JS 项目支持 SSML/其他语言/后端；它们用于验证插桩构建没有破坏上游既有行为。

来源指纹：

- upstream commit：`ba90c8e9f440ad544f674a790bb5f53878b6ffc5`
- 补丁 SHA256：`fae3393bacdc3576e0ea49747ea2afff9915c27b9b08b7f56d6125cba80f4e92`
- buildFingerprint：`e604099ad5e9c40cb9e104a98315a212818e9c0b7382373466612e18596124f4`
- 全量数据 fingerprint：`dacdc888cf04c84d65facb0c9c6d36ad9ca875a1c85bb4cfef9958effc54e880`
- report.json SHA256：`bcec767aaaaf847da56e3cbefe84e1ee905205987218d932ff251535093cee48`

## 重放、诊断与范围

```sh
node tools/oracle/generate-trace.mjs --skip-upstream --replay artifacts/oracle-trace-wOIRDF/smoke-000/trace.json
node tools/oracle/generate-trace.mjs --seed 1592594996 --fuzz-count 64
node tools/compare/trace.mjs expected.json candidate.json
```

失败输入以原 bytes 存入 `failure.json`，同一 replay 入口可直接消费。当前完整前端固定 seed corpus 是有效 UTF-8 的确定性组合；无效字节 fuzz 已在独立 Unicode 原语差分中实现，有界失败缩减入口见 [FUZZ](FUZZ.md)，完整前端异常尚未自动接入分类缩减。初始边界覆盖 BOM、空白、CRLF、组合字符、非 BMP、NUL、Unicode 空格、缩写标点、长词、跨 clause 文本及数字。

本次首次运行的严格 schema 捕获了插桩错误：上游 sbuf 开头含 NUL，使用 strlen 会丢失整个 tokenizer buffer。已按 `tr->clause_end` 的明确长度读取后重建并通过上述完整检查；未改变上游 tokenizer 行为。

当前能观察 decoder 返回值、ReadClause 输出、tokenizer word table、MakePhonemeList 之前的部分数字音素字段。详见 [TRACE_FORMAT.md](TRACE_FORMAT.md) 与 [SOURCE_MAPPING.md](SOURCE_MAPPING.md)。Unicode 原语已有独立 C 参考与 [M01 C/JS 差分](UNICODE.md)；字典/规则选择、词重音、完整音素属性、VM、韵律、DSP及任意内部边界状态重放仍未实现。这是后续 M02 的真实 C 参考起点，不是全文本发音移植完成证明。

## M01 Unicode primitive 参考增量

2026-10-05 新增的独立 helper 没有改变已有前端插桩、trace schema 或 baseline。新增构建入口 `node tools/oracle/build-unicode.mjs`，强制自检 `node tools/oracle/test-unicode.mjs`，JSON 单请求/批处理入口 `node tools/oracle/unicode.mjs < requests.json`。

本次报告：[Unicode report.json](../artifacts/oracle-unicode-0FsKwe/report.json)。结果：

- **1086** 个 UTF-8 三模式输入，**201991** 个 decoder step；所有 clean/instrumented C 输出精确一致。
- 包含原 22 例 smoke、NUL/BOM/完整与截断多字节/overlong/surrogate/错误 continuation、65536-byte 长输入、全部 256 个单字节和 64 个固定 seed `0x5eedb17e` 的无效字节变体。
- **543** 个分类边界/随机码点，在 dotless_i=false/true 下均匹配 clean/instrumented C。
- **1,114,112** 行，覆盖 0..0x10FFFF（含 surrogate）；两套 C 输出的分类、case、raw bracket、utf8_out 紧凑表精确一致。
- 新增协议测试 **4/4**：模式边界、上游特殊语义、JSON batch 顺序/重复性、错误输入与大小上限拒绝。

指纹：

- helperFingerprint：`eafacd1b3149485c3f9d48452f868beb4b264767a0703a80d0fc331a13531829`
- 全码点表 SHA256：`d6736af2f8bad7bcd1d1577ec14e4ca6c6e164c6534c265567b999a9a06d3053`
- Unicode report SHA256：`93a08bc7b3dfc40bae48f63ccb736292b2153c67ab9577df6a9d5caad87360d5`

这验证的是独立 C primitive 参考，不替代 M01 的 C/JS 差分报告。helper 直接调用固定库；JSON wrapper 不执行 Unicode 解码或分类算法；全码点 exporter 供独立差分使用。新 helper 的详细输入、EOF 契约和数字类型见 [TRACE_FORMAT.md](TRACE_FORMAT.md#独立-unicode-primitive-oracle-v1)。其他编码、utf8_in/utf8_in2、JS UTF-16 string 的 surrogate 接入策略均不在此 helper 契约内。自检失败保存固定 seed、当时请求及错误；提取 failure.json 的 request 可送入 JSON CLI 重放，尚无自动缩减。

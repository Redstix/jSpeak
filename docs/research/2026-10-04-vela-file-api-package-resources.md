# 包内资源读取根因调查 — 2026-10-04

## 问题

探针 0.2.0 实测：`file.readArrayBuffer({uri: '/common/probe.bin'})` 与 `.dat`、`.wav` 三者均返回 `202 invalid file type`；同 API 对 `internal://files/` 读写正常；`@system.audio` src `/common/tone.wav` 正常出声；三个文件确认在 RPK 包内（见 [0.2.0 设备结果](../device-results/2026-10-02-probe-0.2.0.md)）。

## 术语修正

目标平台是 **Vela JS 应用**（官方站点自名 "Xiaomi Vela JS 应用"，路径 `/vela/quickapp/`）。不是手机快应用联盟（quickapp.cn）规范，也不是 openvela 系统文档。项目文档统一用"Vela JS 应用"指称目标平台。

## 官方契约核对（A 级，2026-10-04 直接抓取原文）

来源：
- file API：<https://iot.mi.com/vela/quickapp/zh/features/data/file.html>
- URI/项目结构：<https://iot.mi.com/vela/quickapp/zh/guide/framework/project-structure.html>

### readText / readArrayBuffer

两者 uri 参数均为：**"本地文件路径，支持应用资源路径，例如：'/Common/demo.txt'"**。错误码：`202 参数错误`、`300 I/O 错误`、`301 文件不存在`。

→ 官方契约明确声称 readArrayBuffer 支持应用资源路径；设备行为与之冲突。

### writeText / writeArrayBuffer

uri 参数：**"本地文件路径，不支持资源文件路径和 tmp 分区"**。错误码 202/300。

### file.copy / file.move

- `copy`：srcUri 为**"源文件的 uri"（无限制条款）**；dstUri "不能是应用资源路径和 tmp 类型的 uri"。错误码 202/300。
- `move`：srcUri 与 dstUri 均标注"不能是应用资源路径和 tmp 类型的 uri"。

→ **"包内资源 → 复制到 internal://files" 在官方契约上有明确支撑**（copy 的 srcUri 不受资源路径限制，语义上自洽：复制不删除只读分区的源）。这是用户提供的另一 AI 调研（`docs/about-vela-app-res-and-file.md`）未覆盖的候选出口。设备是否实现该契约未测——探针 0.3.0 首要验证项。

### file.access

uri 为"目录或文件 uri"，无资源路径限制条款。文档未给出 access 在资源路径上的明确示例。

### URI 模型

| 资源类型 | URI | 只读 | 示例 |
|---|---|---|---|
| 应用资源 | `/path` | 是 | `/Common/header.png` |
| Cache | `internal://cache/path` | 否 | — |
| Files | `internal://files/path` | 否 | `internal://files/image/demo.png` |
| Mass | `internal://mass/path` | 否 | `internal://files/video/demo.mp4` 式 |
| Temp | `internal://tmp/path` | 是 | 系统动态生成 |

- "应用资源也作为一个特殊的只读分区进行处理。"
- Temp 分区："从外部映射的临时文件，只读，只能通过特定 API 获取（如 file.readText）。应用重启后无法访问。"
- URI 允许字符 `0-9a-zA-Z_-./%:`（不含引号），不能出现 `..`。
- 官方示例统一用**大写 `/Common/`**；本项目工具链打包为小写 `common/`（源目录名决定），`@system.audio` 已证实小写可用。

## 证据分级汇总

- **A 官方契约**：如上。
- **B 设备实测**：readArrayBuffer 包内三扩展名全 202；internal 读写/verify 正常；audio src 包内路径正常出声；readText、copy、access 在包内路径上**未测**。
- **B 社区实证**：MiaoReader（com.bandbbs.ebook，youshen2）把 `/common` 仅作静态资源引用（`<img src>`），全部文件 I/O 走 `internal://files/`（readText/writeText/readArrayBuffer/writeArrayBuffer/access/mkdir/delete/rmdir）——与"资源→internal"模式一致，但该应用数据来自外部导入，不构成 copy-from-package 的直接证据（来源：`docs/about-vela-app-res-and-file.md`）。
- **C+ 推断**（沿用户材料定性）：Redmi Watch 5 的 Vela runtime 对应用资源路径的 `system.file.readArrayBuffer` 存在实现缺失或额外类型限制；不能说是 Vela API 设计限制，因官方契约声称支持。

## 判别实验矩阵（探针 0.3.0，待构建）

| # | 实验 | 判别力 |
|---|---|---|
| B1 | `readText('/common/test.txt')`（512B ASCII） | 与 B2 联合：文本后端 vs 二进制后端 |
| B2 | `readArrayBuffer('/common/test.txt')` | B1 ✓ + B2 ✗ → readArrayBuffer 资源后端缺失；两者 ✓ → 扩展名类型化（仅 .bin/.dat/.wav 被拒）；两者 ✗ → 文件 API 资源支持整体缺失 |
| B3 | `access('/common/probe.bin')` | 资源路径在 file API 的可见性 |
| B4 | `copy('/common/probe.bin' → 'internal://files/…')` | **装载出口候选**；成功则 B5 校验 |
| B5 | B4 产物 readArrayBuffer + 全量 hash 与本地常量比对 | 复制保真性 |
| B6 | `readArrayBuffer('/Common/probe.bin')`（大写） | file API 的大小写敏感性（audio 已证实不敏感，file 未测） |
| B7 | internal 文件 `position/length` 部分读 + hash | 词典分页随机访问能力（0.2.0 只测过全量读） |

## 装载方案决策树（按矩阵结果）

1. **B4+B5 通过** → 首选出口：数据打包 `/common`，首启一次性复制到 `internal://files/`，运行期用 `readArrayBuffer(position, length)` 随机访问。需补测：Files 分区容量上限（官方语义"较小的永久文件"）、大文件复制耗时、应用重装/清数据后的再复制。
2. **B4 ✗ 但 B1 ✓** → 文本编码数据（词典转文本格式或 base64），代价为体积与解析耗时，需实测。
3. **全 ✗** → 构建期 JS 数据模块（必须测包体、启动峰值内存、解析耗时三指标）或 interconnect 外部导入。
- `system.zlib`（luoxe 记录：Smart Band 10 Pro / Watch S4 41mm 均 ✅，未公开 feature，RW5 未测）可用于压缩数据降低包体，若可用则与上述任一出口组合。

## 判别终局（2026-10-05 真机，probe 0.3.1）

C1 PASS（.txt 名 64KiB 二进制，PROBE_BIN_HASH 259309834 首次设备验证）→ **内容嗅探不存在**，校验仅基于扩展名；C2 PASS（256KiB，读+hash 2048ms）；C3 PASS（包内 `position/length` 切片 hash 一致）→ **决策树终态：装载出口 = 包内 .txt 直读**（无需复制、无需编码、支持分页随机访问）。C4/C5 FAIL（copy 对 .txt/.bin 包内源一律原生 `InternalError: invalid parameter`；构建身份经 0.3.1 独有行结构确认，`dstUri` 参数名正确）→ copy→internal 出口关闭；0.3.0 B4 歧义消解（两种构建结论相同）。C6 FAIL（access 包内路径一律 `invalid parameter :path`）。详见 [0.3.1 设备结果](../device-results/2026-10-05-probe-0.3.1.md)。

## 判别结果（2026-10-04 真机，probe 0.3.0）

B1/B2 PASS（.txt 512B，hash 975296040 跨端一致）；B6 与 0.2.0 基线复证 .bin 拒绝 202（大小写不敏感）→ 落入矩阵之外的新结论：**类型校验基于文件类型**，非资源路径整体缺失（修正本文 C+ 推断）。B3 access(.bin) FAIL `invalid parameter :path`；B4 copy(.bin→internal) FAIL `InternalError: invalid parameter`（含构建身份歧义：转录无法区分修复版被拒与修复前构建缺参，时间线指向修复版——0.3.1 引入构建戳并以 C5 复测消歧）；B7 internal 部分读 PASS（SLICE_HASH 一致）。决策树进入修正分支：首选"**文本扩展名直读**"出口（.txt 名二进制内容，无编码无复制），0.3.1 C1–C6 判定内容嗅探/尺度/包内部分读/copy(.txt 源)/copy(.bin 复测)/access(.txt)。详见 [0.3.0 设备结果](../device-results/2026-10-04-probe-0.3.0.md)。

## 参考材料

- 用户提供的另一 AI 调研：`docs/about-vela-app-res-and-file.md`（其 A/B/C 分级与本次官方原文核对一致；其未覆盖 file.copy）。
- luoxe 非官方 Vela 开发文档（youshen2 维护）：<https://docs.luoxe.cn/docs/vela/>——未公开 feature、机型可用性（无 RW5 列）、权限与兼容性（manifest 声明 ≠ 授权）。
- 本地工具链核查（exp-1）：aiot-toolkit 全系 node_modules 无 @system.file 类型定义/错误码表；manifest schema 无包内资源声明字段，`src/common/*` 由 `aiot build` 原样拷入 RPK。

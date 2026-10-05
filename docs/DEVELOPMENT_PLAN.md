# jSpeak 正式开发计划 — 2026-10-05 定稿

> 本计划在探针系列（0.1.0–0.3.1，四轮真机）完成后制定，是上下文压缩后的**执行恢复点**。执行前必读：`design/stages/AGENT_PROTOCOL.md`（12 条不可违反约束）、`docs/COMPATIBILITY_SPEC.md`、`docs/TRACE_FORMAT.md`、`docs/RUNTIME_PROFILE.md`、`docs/SOURCE_MAPPING.md`、`docs/STATUS.md`（当前状态）与 `docs/device-results/`（证据链）。

## 1. 目标与不变约束

- **目标**：eSpeak NG 纯 JS 行为兼容移植（无 WASM/原生模块/神经 TTS），最终运行于 Xiaomi Vela JS 应用（Redmi Watch 5，设备 API 1200，`ap / 0.0.0`）。上游 C 实现是唯一行为 oracle。
- **术语**：目标平台官方名称为 **Vela JS 应用**（iot.mi.com/vela/quickapp 站点自名），非手机快应用联盟规范、非 openvela。
- AGENT_PROTOCOL 全部约束有效，重申三条最常触发的：
  1. 不发明发音规则、不静默省略行为——不支持的必须报告并测试；
  2. 差分测试未通过前不做行为性优化；
  3. 核心代码不耦合 Vela/Node/DOM/文件系统 API。
- **不伪造验证结论**：已证实/未验证/不支持三态必须区分；探针微基准不等于 TTS RTF。

## 2. 设备事实基线（四轮真机，全部有据可查）

### 2.1 语言与运算语义（0.1.0/0.2.0 实证）

TypedArray(64KiB)/DataView(字节序)/Math.imul/32-bit 移位：全 PASS。计算 hash（65536 次异或移位）跨端一致 `437906867`（两轮复证）。

### 2.2 音频出口（已定案）

- `@system.audio` **只能文件播放**（src/stop/onplay/onended/onerror），**无原始 PCM 流式写入接口**——PCM streaming 路线在此平台不存在，不再探索。
- 路线：合成 → 完整 WAV 文件 → 播放。两级实证：
  - 包内预置 WAV 播放出声（0.1.0 用户确认约 2 秒嘟声）；
  - 运行期 JS 生成 WAV → 写入 `internal://files` → 全字节读回校验 → 播放 → ENDED → 用户确认双音听感顺序正确（0.2.0，64044 字节，SHA256 校验链完整）。
- 明确记录：这是**非流式**方案；短句预生成、长文本分段落文件是后续产品形态问题（M11/M13）。

### 2.3 文件 I/O（已定案）

- `internal://files`：readText/writeText/readArrayBuffer/writeArrayBuffer/delete 全 PASS（64KiB 实证，逐字节校验）。运行期产物（WAV 等）放这里。
- **包内资源读取的类型门槛**：`file.readArrayBuffer('/common/x.txt')` 可读；`.bin/.dat/.wav` 扩展名拒绝 `202 invalid file type`（大小写不敏感）；**校验仅看文件名扩展，无内容嗅探**（0.3.1 C1：.txt 名 + 纯二进制内容 64KiB 读取成功，hash 与本地逐字节一致）。
- **尺度与随机访问**（0.3.1）：256KiB 全量读 PASS（读+hash 2048ms，与 64KiB/454ms 近线性）；包内路径 `position/length` 部分读 PASS（2KiB 切片，hash 一致，129ms）。
- **关闭的出口**：`copy` 包内源→internal 一律原生 `InternalError: invalid parameter`（.txt/.bin 均拒，构建身份已确认）；`access` 包内路径一律 `invalid parameter :path`。官方契约与此差异记录在 `docs/research/2026-10-04-vela-file-api-package-resources.md`。

### 2.4 装载方案定案（ADR-2）

**包内 .txt 直读**：eSpeak 数据文件内容保持二进制原样，仅文件名使用 `.txt` 扩展打包进 RPK `common/`；小文件全量 `readArrayBuffer`，大词典用 `position/length` 分页随机访问。不需要 base64/文本编码，不需要 copy 缓存，不需要构建期 JS 数据模块。

### 2.5 性能基线（供后续对照，非 RTF 结论）

| 测量 | 数值 |
|---|---|
| 包内 64KiB 读+hash | 454ms |
| 包内 256KiB 读+hash | 2048ms |
| 包内 2KiB 切片读+hash | 129ms |
| 计算 65536 次分片（32×2048） | total 475ms；窗口和 67ms；max 4ms；首等 158ms；后续等待 p50/p95/max=8/9/9ms |
| 双音生成（2s 音频，63 片） | 534ms；maxSlice 77ms（未定位，非 eSpeak DSP） |
| internal 64KiB 写+全量读+部分读全链 | 1807ms |

### 2.6 未证事项（禁止默认成立）

>256KiB 单文件尺度；真实数据规模下的启动耗时与峰值内存；连续合成 RTF/欠载/取消延迟；峰值 heap；长时稳定性与重复运行增长；Files 分区容量上限（官方语义"较小的永久文件"）。

## 3. 架构决策记录（ADR 摘要）

- **ADR-1 音频**：完整 WAV 文件播放（运行期生成 → internal → `@system.audio`）。PCM streaming 在此平台无 API 路线，已关闭。
- **ADR-2 装载**：包内 .txt 直读 + `position/length` 分页（见 2.4）。
- **ADR-3 隔离**：核心纯 JS（typed arrays/整数 ID/复用缓冲，避免热路径对象分配）；Vela API 只出现在 `apps/` 适配层与探针。
- **ADR-4 验证**：C oracle 差分是最终裁判；trace 按 `docs/TRACE_FORMAT.md` envelope；探针数据只进 `docs/device-results/` 并带证据等级。
- **ADR-5 交付纪律**：探针/应用构建带**构建戳**（页头显示，generate-assets 生成 `src/build-stamp.js`，gitignore，README 维护 stamp→SHA256 映射）；dist/ 不入 git，SHA256 留痕于文档；**当前会话模型不支持图片输入**——用户结果以逐行转录为准；探针侧已知措辞瑕疵：copy 失败后清理对未创建文件显示 "301 leftover"，应表述为"无需清理"（copy 出口已关闭，无需修复）。

## 4. 阶段计划（对齐 M00–M16；关键门 = M06/M10/M12/M14/M16）

原始阶段设计在 `design/espeak-ng-js-stage-designs.zip`（未解包每阶段 DESIGN.md——恢复后第一件事补齐）。执行某阶段前必须读对应 DESIGN.md；ZIP 内无则按 `design/stages/README.md` 的 gate 定义先补写 DESIGN.md 再实现。**不提前实现后续阶段**；跨阶段依赖建最小接口。

### M00 Oracle 收尾（当前：CLI smoke 已过，内部插桩未做）

已完成：上游锁 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`（profile：en-us/175/50/100/UTF-8/`-D`，CMake Release 静态）；22 例 CLI smoke 两遍一致（空输入不生成 WAV 已显式记录）；PCM16/WAV 比较器与严格 WAV 解析器；构建 stamp 校验绑定上游 commit/选项/产物 hash。

剩余：
- **M00a 内部 trace 插桩**：按真实源码观察点（对照 `docs/SOURCE_MAPPING.md`）在 C 侧输出结构化 trace（envelope 见 TRACE_FORMAT），配 schema 校验器。观察点候选：译码入口、TranslateWord/LookupDict2/字典读取、SetWordStress、音素输出级、Wavegen 入口。
- **M00b 语料扩充**：22 例 → 结构化语料（边界字符、多子句、数字/标点/缩写、长短句梯度），每例两遍一致 + trace 稳定。
- **M00c trace 消费端**：JS 侧重放/对比 harness（为 M06 差分服务；比较器已有，缺 trace 级）。

### D1 真实数据装载管线（探针→迁移合流点；M01 的设备侧前置）

- D1.1 从 oracle 构建产物提取 en-us 真实数据文件（en_dict、音素表等），记录每个文件的字节长度与 SHA256。
- D1.2 打包器（tools/）：数据以 `.txt` 扩展名复制进 app 包 `src/common/`（**内容二进制原样，绝不转码**），生成清单文件（打包名→原文件→hash）。
- D1.3 设备装载校验（probe 0.4.0，复用现有探针模式）：全量装载 + hash 校验 + 分页装载 + 耗时记录。**Gate：实测 >256KiB 尺度、真实启动耗时**。
- D1.4 内存观察：装载后保守内存探针（不做 OOM 极限测试）。
- 注意：若 en_dict >256KiB 且全量读受限，分页读已证明可行（C3），风险低。

### M01–M06 Phonemizer（文本→音素；M06 = 关键门）

- M01 音素表/数据结构加载（消费 D1 管线产物），JS 数据访问层。
- M02 字典查找（en_dict 编译格式解读，严格按上游 reader 语义，逐字段对照）。
- M03 字母→音素规则（enrules）。
- M04 重音/元音/语调（SetWordStress 等——差分要求最严区段，trace 级对比）。
- M05 文本规范化（数字/标点/特殊形式）。
- **M06 门**：文本→音素全链路，C/JS trace 差分在扩充语料上全绿，独立可测。未过门不得进入 M07。

### M07–M10 DSP（合成；M10 = 关键门）

M07 波形框架（上游 sample source/klatt 结构）→ M08 音素→参数 → M09 PCM16/16kHz/mono 输出级 → **M10 门**：音素/文本→PCM 差分（比较容差按 COMPATIBILITY_SPEC；WAV hash 级优先，必要时采样级）。
从 M10 起所有设备基准必须记录 RUNTIME_PROFILE 规定的完整清单（RTF、首音延迟、maxSlice、队列水位、欠载、取消延迟、重复运行增长）；双音 maxSlice 77ms 异常片在此阶段定位。**设备实测前不承诺实时可用**。

### M11–M12 Vela 集成（M12 = 关键门）

M11 适配层：WAV 文件出口（0.2.0 已证路线）、会话/取消/生命周期（探针已证模式：token 隔离迟到回调、scratch 清理契约）。M12 门：真机播放完整合成语音（用户听感确认）。

### M13–M16 生产化

M13 长文本/内存策略（有界输入、分片合成、资源释放）；M14 资源优化（**仅在差分全绿后**：包体、启动、内存，基于真实数据基线）；M15 稳定性（长时/重复/前后台）；M16 上游同步流程（锁 commit 再同步规则）。

## 5. 压缩后恢复点——立即执行顺序

1. **解包阶段设计**：从 `design/espeak-ng-js-stage-designs.zip` 提取每阶段 DESIGN.md 到 `design/stages/`（原始 ZIP 保留不动；内容不改；单独 commit）。与 `design/speak-patch.md` 一并核对其角色。
2. **D1 真实数据装载管线**（第 4 节规格；probe 0.4.0 模式成熟，可派 fixer 复用会话 `ses_ef9c7375cffeMzWMku2lNGAISE`——其上下文含全部探针工程模式）。
3. **M00a trace 插桩**（tools/oracle 侧，与 D1 不同目录，可并行派发）。
4. 每完成一步：更新 `docs/STATUS.md`、必要证据进 `docs/device-results/`、独立复跑测试后 commit（`work/bootstrap` 分支，无 remote，Co-Authored-By: Claude Code）。

### 工程事实速查

- 分支 `work/bootstrap`（main 停在根提交 016fd82）；无 remote/push；提交习惯 `docs:`/`feat:` 前缀。当前 HEAD 系列：`e12f287`(0.3.1 结果) ← `e88ae9e`(0.3.1 交付) ← `ebeeed2`(0.3.0 结果) ← `54e896b`(0.3.0 交付)。
- 测试：仓库根 `npm test`（42 项全过；pretest 自动生成探针 stamp/assets）。Oracle：`npm run test:oracle`。探针构建：`npm run probe:build` → `apps/vela-probe/dist/org.jspeak.probe.debug.<ver>.rpk`（dist/ 被 gitignore，SHA256 手动留痕文档）。
- 探针常量：PROBE_BIN_HASH=259309834；TEST_TXT_TEXT/BYTES_HASH=975296040；SLICE_HASH=1037292089；BIG_TXT_HASH=534463728（设备已全部验证）。
- Vela API 权威文档：`https://iot.mi.com/vela/quickapp/zh/features/data/file.html`、`.../features/other/audio.html`、URI 模型 `.../guide/framework/project-structure.html`。社区参考：`https://docs.luoxe.cn/docs/vela/`（youshen2 维护，非官方逆向文档；MiaoReader `github.com/youshen2/com.bandbbs.ebook` 为重负载 Vela JS 应用实证参考）。
- aiot-toolkit 2.0.5 / @aiot-toolkit/jsc 1.0.9（用户已授权安装使用）；构建依赖 14 advisories（3 low/11 high）已知，不盲目升级。
- `apps/vela-probe/user_result/` 是用户截图目录（gitignored）；当前会话模型**不能读图片**，结果让用户逐行转录，模板：版本头（含构建戳）+ 每行状态+关键数字。

### 协作与委派模式（orchestrator 执行本计划时沿用）

- 有界实现 → @fixer（探针/工具线；可复用会话）；代码/文档搜索 → @explorer；外部 API 疑问 → @librarian（注意平台是 Vela JS 应用，别查成 quickapp.cn/openvela）；架构/高风险审阅 → @oracle。
- **审查纪律**：writer 完成后 orchestrator 必须独立复跑测试 + 校验产物（先例：0.3.0 审查抓出 `dstUri` 参数名错误——官方契约参数名与实现不一致，单测 mock 跟着错误实现走，测不出来；这类设备契约 bug 是本项目的典型风险）。
- 并行 lane 只在写范围不重叠时派发；fixer 产出不自行 commit，由 orchestrator 审查后提交。

## 6. 验证纪律（不可违反）

1. Oracle 是唯一行为裁判；差分不过 = 阶段不算完成，无论本地测试多绿。
2. 设备证据只进 `docs/device-results/`，带证据等级（官方契约 A / 设备实测 B / 社区 B / 推断 C+）与原始转录。
3. 微基准与探针耗时数据不作 RTF 结论；实时可用性只有 M10 后的完整真机基准可证。
4. 交付物（RPK）必须可追溯：构建戳 + SHA256 留痕 + 对应代码 commit。
5. 每个行为迁移有确定性测试或显式记录的例外（AGENT_PROTOCOL 第 12 条）。
6. 文档存在 ≠ 功能完成；harness 自检 ≠ C/JS 兼容通过。

## 7. 风险登记

| 风险 | 状态 | 缓解 |
|---|---|---|
| en_dict 可能 >256KiB | 未证 | D1 实测；分页读已证明可行（C3） |
| maxSlice 77ms 异常（双音观察） | 未定位 | M10 真实 DSP 基准时定位；若持续影响连续合成调度设计 |
| Files 分区容量（"较小永久文件"语义） | 未证 | M11 验证运行期 WAV 大小上限 |
| 差分严格区段（SetWordStress 等）成本高 | 预期 | M00a trace 插桩先行，M04 用 trace 级对比 |
| toolkit advisories | 已知不升级 | 记录在 THIRD_PARTY_NOTICES.md |
| 平台文档与实现差异（copy/access 先例） | 已发生 | 一切设备行为以实测为准；官方契约只作参照 |

## 8. 本计划之外

- 不做：设备密钥提取、签名绕过、自动极限压力测试、未经差分的性能优化。
- 产品级功能（音色/多语言/语速 UI）在 M16 前不进入范围；首发单 voice（en-us）。
- 上游同步（M16）前不 rebase 上游。

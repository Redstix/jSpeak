# jSpeak 交接入口 — 2026-10-05 修订版

本仓库正在进行 eSpeak NG 纯 JS 行为兼容移植，目标为 Redmi Watch 5 的 Xiaomi Vela JS 应用。**正式执行基线是 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)**；本文件只保存恢复顺序和操作要点。

## 当前状态

- 六轮设备记录（0.1.0–0.4.1）已归档。0.4.0确认600104B真实文件、898009B候选驻留及22050Hz包内/完整文件两路出声；0.4.1增量写入/头回填、读回/播放/清理及听感已通过。
- C Oracle 已构建；22 例 smoke 两遍一致。2026-10-05 审查复跑 `npm test` 42/42，通过不代表 C/JS 兼容。
- M00 部分前端 Trace Oracle 已实现并通过50例重复/插桩对照和19项CTest；尚无JS phonemizer或合成器。D1/A1 0.4.0设备结果已核对，0.4.1精确写缓冲修复后9/10复测通过；M01 固定 UTF-8/分类/编码原语已实现并通过 C/JS 差分。
- M00–M16 共 17 份阶段 DESIGN 已在 `8f8d39e` 中提交，本轮与原 ZIP 逐份比较一致；**不要重新解包或建立重复提交**。
- 旧计划的阶段重命名已撤销；M01=Unicode、M08=音素 VM、M11=有界运行时、M15=中文/其他语言。M15 首发延期，稳定性另列 S1。
- 当前 Oracle WAV 与 `phondata` 头均为 **22050Hz**；16000Hz 是旧设备探针参数。22050Hz短句设备播放已确认；WAV分块写入及头回填在0.4.1复测通过。
- M02.1 ReadClause/标点属性支持切片已验收：639输入=598完整exact+41登记缺口，1341次clause返回；全1114112码点属性/type exact；Node 128/128、0 skip。完整M02的词切分与字典/embedded依赖未完成，见[M02.1记录](build-results/2026-10-05-m02-clause.md)。
- 后续实现已推进：M02真实标点服务集成990输入=989 exact/7390词条+1原C越界，0服务依赖缺口；直接ReadClause864输入/1695返回全exact。见[M02.2记录](build-results/2026-10-05-m02-text-services.md)。M03固定en字典8399请求/7920lookup/524transpose exact，415共享context核对，见[M03记录](build-results/2026-10-05-m03-dictionary.md)。M04词级正式差分1372组=1370 exact+2原C UB；M05/M06整句到pre-MakePhonemeList 68组原CLI输入、99子句、712次Word2调用、3409音素项全exact；M07完整MakePhonemeList、CalcPitches与CalcLengths 99子句、3430行两阶段全exact；M08音素VM 8200/8200 exact；M09 Generate高层事件99子句、19994事件全exact，见[CLAUSE_TRANSLATION](CLAUSE_TRANSLATION.md)、[MAKE_PHONEME_LIST](MAKE_PHONEME_LIST.md)、[PROSODY](PROSODY.md)、[GENERATE_EVENTS](GENERATE_EVENTS.md)与`artifacts/phoneme-interpreter-MrD6Ky/report.json`。
- M10前两个PCM切片已通过：pause/marker在2个纯空白整句、308样本上与原C WAV完全一致；20条独立PlayWave命令、26694样本逐点exact，见[WAVE_GENERATOR](WAVE_GENERATOR.md)与[M10记录](build-results/2026-10-06-m10-wave-pause.md)。
- `.txt` 是已选装载通道；898009B候选整体驻留和分块组装均已测通，默认先全读驻留。完整reader初始化及最终数据预算未测，有界分页缓存尚未实现。

## 必读顺序

1. [最终实施计划](DEVELOPMENT_PLAN.md) 与 [当前状态](STATUS.md)。
2. [AGENT_PROTOCOL](../design/stages/AGENT_PROTOCOL.md) 的 12 条约束及当前阶段 DESIGN。
3. [兼容性](COMPATIBILITY_SPEC.md)、[Trace](TRACE_FORMAT.md)、[运行时](RUNTIME_PROFILE.md)、[源码映射](SOURCE_MAPPING.md)。
4. 相关 `docs/device-results/` 原始证据及 [Vela 文件 API 调研](research/2026-10-04-vela-file-api-package-resources.md)。

原 ZIP、阶段 DESIGN 和 `design/speak-patch.md` 是历史设计/评审材料，角色与冲突处理见最终计划 §1；不以历史材料中的示意函数名当成已核验源码映射。

## 当前交付与恢复工作

probe0.4.0：`apps/vela-probe/dist/org.jspeak.probe.debug.0.4.0.rpk`，stamp `B261005T065730`，SHA256 `68479bf28bf36e2949c34e173086e58fb3ecc63c6b9b3cbf1ccbbd371d8c2908`。主代理已核验RPK内数据/音频/许可和构建戳，首轮72项单测通过；后续真机OCR和听感已归档为[第五轮](device-results/2026-10-05-probe-0.4.0.md)。[本地构建记录](build-results/2026-10-05-probe-0.4.0.md)与[探针步骤](../apps/vela-probe/README.md)。

当前修复包：`apps/vela-probe/dist/org.jspeak.probe.debug.0.4.1.rpk`，stamp `B261005T075402`，SHA256 `22353261d791b03eaf34283b03a1757cb77cc162c742842b57fe1ab1d2446604`。103/103测试与RPK解包核验通过；9/10已报告读回/播放/清理成功，用户确认“清晰，完整，一致”，见[第六轮](device-results/2026-10-05-probe-0.4.1.md)。该次转录未包含READY页头；交付身份见[0.4.1交付](build-results/2026-10-05-probe-0.4.1.md)。

后续 M01 与 Unicode 缩减入口已集成，主代理复验 **100/100 Node 测试、0 skip**，2430 个解码case与全1114112码点 C/JS exact；新增代码未进入既有RPK，见 [M01 验收记录](build-results/2026-10-05-m01-unicode.md)。

1. **D1 数据依赖继续核验**：打包器与source lock已实现，六个候选文件898009字节，383文件来源清单保留；额外语料证实hy/ko/ar/hi词典未纳入。`closureComplete:false`不得静默改为true。
2. **A1修正版真机**：0.4.0的139316/79236B长度可由整backing写入模型复现，不能宣布API不支持。0.4.1对每次write提供精确长度缓冲，9/10均读回46424B一致、onended、清理通过，用户确认清晰完整一致。后续实现有界PCM文件队列；D1的685ms hash峰值另轮调查。
3. **M02→M09接续**：内部scanner/tokenizer/embedded、固定en词典、音素表、词重音、TranslateWord3/WithBounds、Word2紧凑列表、整句pre-MakePhonemeList调度、完整MakePhonemeList输出、CalcPitches/CalcLengths、音素VM与Generate高层事件均已闭合到当前语料；继续M10 PCM/DSP和原队列调度，见STATUS；不能把单模块通过宣称完整phonemizer已完成。完整规则集成/DSP观察点仍未完成。
4. 设备反馈等待期间推进 Node 正确性工作；前端主线 M02→M11，之后 M11→M12→M13→M14/S1，M16 维护演练纳入首发。

未取得设备结果的任务保留“待真机”；不因本地 mock 通过而越过设备门。各项实现完成后更新 STATUS 和证据，计划落盘本身不算功能完成。

## 仓库与操作纪律

- 沿用 `work/bootstrap`，无 remote；不配置 remote、不 push。修订前参考 HEAD 为 `8335095`；恢复时重新运行 `git status --short` 和 `git log -1`，不要假定工作树干净。
- 本轮计划落盘前本文件是未跟踪文件；是否已经提交以实际 Git 状态为准。实施提交有界，贡献者署名据实，不照搬历史 agent 身份。
- 核心 `src/` 不 import Vela/Node/DOM；系统 API 在 `apps/` 适配层，C 构建/转换工具在 `tools/`。
- 目标官方名称是 **Xiaomi Vela JS 应用**；参考 `iot.mi.com/vela/quickapp`，不要套用手机快应用联盟或 openvela 系统 API。
- 文件参数按官方契约核验，再以设备实测判断支持。先例：copy 参数应为 `dstUri`；错误实现与 mock 一起写错时测试也会全绿。
- 不依赖包内源 copy/access；不把一次 2KiB 切片成功当成完整分页缓存已可用；不把 `.txt` 二进制读通推广到未测扩展名。
- 自检后复核关键契约、测试及 RPK 内容。交付记录版本、可见构建戳、SHA256、代码 commit/必要 diff；设备反馈包含版本头、每行状态/关键数字、实际听感。
- 使用当前环境可用的证据读取方式；照片可以留档，关键结果保留逐行转录。历史 agent 会话 ID 和能力限制不是执行前提。
- 不提取设备密钥、不绕过签名、不做自动极限压力测试；已知 toolkit advisories 见 THIRD_PARTY_NOTICES，不盲目升级。
- 用户明确要求持续自主推进：阶段完成/QQ通知都不是停工点，只在真正需要用户干预时暂停。不同阶段的完成/失败/需决策事项通过 Hermes 发QQ通知，消息以 `[Codex]` 开头，不发进度闲聊。本会话未暴露 Hermes MCP，但本机 `hermes send` 可用，`hermes send --list qqbot` 已确认授权目标；调用 `--to` 指定目标并检查实际投递结果。目标 ID 不写入源码分发材料。

## 命令与产物

- `npm test`：Node集成测试；pretest会生成stamp/assets。构建后复测可用`node --test tests/*.test.mjs`避免改变交付stamp。
- `npm run oracle:build`：构建固定参考程序；`npm run test:oracle`：C 自身重复性检查。
- `npm run probe:build`：构建探针；产物在 `apps/vela-probe/dist/`。
- `npm run oracle:trace:build` / `npm run test:oracle:trace`：隔离插桩构建与C对照；`npm run data:verify`校验候选数据；`npm run probe:source`生成实际源代码交付副本。
- `npm run oracle:unicode:build` / `npm run test:oracle:unicode`：独立C Unicode参考构建/自检；`npm run unicode:build`：生成固定UCD表；`npm run test:unicode`：M01 C/JS全量差分；`npm run fuzz:minimize -- ...`：有界失败缩减，见[FUZZ](FUZZ.md)。
- `npm run oracle:clause:build` / `npm run test:oracle:clause -- --trace-dir <已有trace目录>`：独立C ReadClause/属性参考与桥接自检；`npm run clause:properties:build` / `npm run test:clause:properties`：原始property生成/全码点差分；`npm run test:clause`：固定profile ReadClause差分，例外绑定输入和签名，新例外须审查。
- `build/`、`dist/`、`artifacts/`、`apps/vela-probe/user_result/` 被忽略；代码/manifest/证据留痕仍需维护，不能只保留机器上的生成物。

## 已交付构建与基准

| 项目 | 值 |
|---|---|
| 上游 commit | `ba90c8e9f440ad544f674a790bb5f53878b6ffc5` |
| probe 0.2.0 RPK SHA256 | `6430760d759d453a7f033ad0017db2e91517b41b34a4a8a102ee0e03e0ad093d` |
| probe 0.3.0 RPK SHA256 | `da260c6df3e947f93b015d3e19cdb90a25ba9e551edb996765204b8dd84a7d55` |
| probe 0.3.1 RPK SHA256 | `d93fe1c6826f9eeccc81b9f5c9a3a74909318e0a7aa90805e30f8d6720e550f7` |
| probe 0.3.1 构建戳 | `B261005T013207`；代码 `e88ae9e` |
| 探针 hash | PROBE_BIN=259309834；TEST_TXT=975296040；SLICE=1037292089；BIG_TXT=534463728 |
| 性能观察，非 TTS RTF | 64KiB 读+hash 454ms；256KiB 2048ms；2KiB 切片 129ms；计算 maxSlice 4ms；双音生成 534ms，maxSlice 77ms 未定位 |

历史 copy 失败后的“301 leftover”是措辞瑕疵：目标不存在，无残留。这不改变 copy 路线关闭的结论，也无需为已关闭的路线单独重发探针。

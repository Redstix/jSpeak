# jSpeak 交接入口 — 2026-10-14 修订版

本仓库正在进行 eSpeak NG 纯 JS 行为兼容移植，目标为 Redmi Watch 5 的 Xiaomi Vela JS 应用。**正式执行基线是 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)**；本文件只保存恢复顺序和操作要点。

**本次交接（2026-10-14）**：另一台机器上的另一个 agent 接手，方式是 `git clone` 后在本地继续。交接时点核实结论：无人值守流水线已停止，最后一站在 **2026-10-11 11:38** 结束；此后（10-12 起）无任何 codex 会话、无新提交；工作树干净，全部分支已 push。接手前先读 §0 与 §2。

## 0. 在另一台机器上继续（clone 后先做这些）

clone 之后**没有** `dist/`、`build/`、`artifacts/`、`upstream/`、`node_modules/`（全部在 `.gitignore` 内）。这不是交付物丢失，按下面命令重建即可。交付身份以 §6 记录的 SHA256 为准，不以"本机曾经有过那个文件"为准。

环境要求：

- Node **>= 24**（本轮构建用 `v24.21.0` linux/x64）。
- C/C++ 工具链 + **CMake**（构建固定版本 C Oracle / 全部差分参考）。
- 网络可达 `github.com` 与 npm registry。`apps/` 层的 devDependencies（`aiot-toolkit 2.0.5`、`@aiot-toolkit/jsc 1.0.9`）是**出可安装 RPK 的必需项**，核心测试不需要它们。
- 离线/受限网络：先在有网机器上 `npm run probe:source`，用产出的 `espeak-ng.git.bundle` 恢复上游，见 [SOURCE_BUNDLE.md](SOURCE_BUNDLE.md)。

```sh
git clone https://github.com/Redstix/jSpeak.git && cd jSpeak
git checkout perf/quickjs-vela-optimization      # 当前最新分支，见 §2 分支拓扑

npm run oracle:build            # 按 upstream.json 自动 clone 上游并 detached checkout 固定 commit
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm ci --prefix apps/vela-tts   --registry=https://registry.npmjs.org
npm test                        # 集成测试；pretest 会重生成 stamp/assets（都是 gitignore 产物）
npm run tts:profiles            # 重建 0.5.1 A/B/C 三档 RPK（clone 后没有任何现成 RPK）
```

交接时点（2026-10-14）在本机跑出的基线，供新机对照：`npm test` **278/278 通过、0 fail、0 skip**（约 30.8s，Node v24.21.0）；测试覆盖数与 STATUS 记录一致，说明 clone 后的仓库自带语料足以跑通集成测试（`artifacts/` 类前置只影响 `compare` 系列差分入口，按 §7 末条先跑对应 `oracle:*:build`）。

两点必须知道：

- `tools/oracle/build.mjs` 会**拒绝**在上游 checkout 与 `upstream.json` 的固定 commit 不一致、或上游工作树不干净时构建。要换上游版本须另立变更，不要就地移动这个锁。
- 重新构建会生成**新的可见构建戳**，不承诺与既有 debug RPK 的 ZIP 字节相同。"是不是同一份东西"由 §6 的 SHA256/构建戳 + `npm run data:verify` 判定。

## 1. 必读顺序

1. [最终实施计划](DEVELOPMENT_PLAN.md) 与 [当前状态](STATUS.md)。**STATUS 优于本文件**；本文件只讲怎么恢复、怎么继续。
2. [AGENT_PROTOCOL](../design/stages/AGENT_PROTOCOL.md) 的 12 条约束及当前阶段 DESIGN。
3. [兼容性](COMPATIBILITY_SPEC.md)、[Trace](TRACE_FORMAT.md)、[运行时](RUNTIME_PROFILE.md)、[源码映射](SOURCE_MAPPING.md)。
4. 相关 `docs/device-results/` 原始证据及 [Vela 文件 API 调研](research/2026-10-04-vela-file-api-package-resources.md)。

原 ZIP、阶段 DESIGN 和 `design/speak-patch.md` 是历史设计/评审材料，角色与冲突处理见最终计划 §1；不以历史材料中的示意函数名当成已核验源码映射。

## 2. 交接时点状态（2026-10-14 02:37 UTC 实测核实）

| 项 | 事实 |
|---|---|
| 权威分支 / HEAD | `perf/quickjs-vela-optimization` @ `9fbbe75`（已 push，与 origin 同步） |
| 工作树 | 干净，无未提交改动 |
| 分支拓扑 | `perf/...` = `work/bootstrap`(`576c5d0`) + 2 个 M14 提交（`0` 左 `2` 右，即 work/bootstrap 无独有提交）；`work/vela-performance`(`9e54b74`) 是已放弃的早期性能实验；`main`(`016fd82`) 是历史存档 |
| 流水线 | **已停止**。最后一个 jSpeak codex 会话结束于 2026-10-11 11:38；10-12/13/14 无 jSpeak 会话、无提交 |
| 阻塞门 | 0.5.1 A/B/C 真机验收（只有用户能关，见 §4） |
| 已就绪产物 | 0.5.1 三档 RPK 在本机 `apps/vela-tts/dist/`（gitignore，需重建），身份见 §6 |

流水线为什么静默停下：本机的「jSpeak 流水线看门狗」cron 任务已不在 cron 表中，而 Codex 阶段的 report 文件写在 `~/.hermes/cache/scratch/` —— 该目录 **idle 24h 即被 prune**，report 会一并消失。看门狗已不在、report 又留不住，整条链停了三天没有任何一处能报出来。已写进 [STATUS](STATUS.md) 未完成项：**持久产物不要放 scratch**。

## 3. 现在该做什么（不依赖用户的队列）

按最终计划的顺序，未完成且**不需要设备**的部分：

1. **M12 收口**：集成文本→命令计划尚未与 C Oracle 对齐（JS 22809 样本 vs C 23190，首个差异在样本 1384）。英文端到端做到 C/JS exact 才算 M12 完成。
2. **M13 数据最小化**：尚未开始。按完整依赖关系裁剪、冻结生产格式与构建 profile，须给出裁剪前后目标语料 trace/PCM 不变。
3. **M15 剩余**：`cmn` 前端仍未实现 —— `TranslateClause`、ideograph/tone tokenizer、`MakePhonemeList`/`Generate`/`Wavegen` 参数化、端到端 C/JS exact。已落地的是数据/profile 与 `CalcPitches_Tone` 函数级切片，**不等于中文可用**。用户 2026-10-11 已明确 M15 不再延期（以 STATUS 为准，最终计划里的"延期"措辞是旧的）。
4. **M14/S1 完整验收**：本轮只做了启动解析/打包减法；设备启动、heap、RTF、稳定性仍未验收。
5. **M16 维护演练**：隔离环境跑通上游同步流程并输出差异/资源报告，不能只有说明文档。
6. 基础设施：若新机继续无人值守，重建看门狗 + 把 report 落盘位置移到 scratch **之外**（§2 那个教训的直接修复）。

## 4. 设备门（只有用户能关，agent 不得代宣）

- **0.5.1 A/B/C 待验收**：判定 0.5.0「启动闪退 / 手表重启」根因，并给出音质/资源取舍档。
  建议顺序：先复现 0.5.0 闪退作对照 → 按 A→B→C 安装，每档**只打开核对页头、不点击**，确认是否闪退后再做动作验收。
  回报模板与逐项字段见 [0.5.1 设备待验收](device-results/2026-10-11-tts-0.5.1-profiles.md)（A 档含数据/合成/写入/读回/播放/听感/清理；B/C 只测启动与播放）。
- 0.5.0 亦有待验收记录：[设备](device-results/2026-10-11-tts-0.5.0.md)、[构建](build-results/2026-10-11-tts-0.5.0.md)。
- 纪律：**真机听感与"启动不再闪退"只能由用户确认**；构建与静态校验通过一律写「待用户真机验收」。`onended` 只证明播放事件，不证明听感。

## 5. 仓库与操作纪律

- 远端 `origin = https://github.com/Redstix/jSpeak.git`（private，HTTPS + `gh` 凭据）。已推送分支：`main`、`work/bootstrap`、`work/vela-performance`、`perf/quickjs-vela-optimization`。
- 提交信息用**中文**风格；署名据实；**不加** `Co-Authored-By` / AI trailer；**不改** author/committer；**不 force push、不改写历史**。
- 不动 `work/bootstrap` 上的既有提交；新工作另开分支或续在 `perf/quickjs-vela-optimization` 上；`main` 只是历史存档。
- 核心 `src/` 不 import Vela/Node/DOM；系统 API 在 `apps/` 适配层，C 构建/转换工具在 `tools/`。
- 目标官方名称是 **Xiaomi Vela JS 应用**；参考 `iot.mi.com/vela/quickapp`，不要套用手机快应用联盟或 openvela 系统 API。
- 文件参数按官方契约核验，再以设备实测判断支持。先例：copy 参数应为 `dstUri`；错误实现与 mock 一起写错时测试也会全绿。
- 不依赖包内源 copy/access；不把一次 2KiB 切片成功当成完整分页缓存已可用；不把 `.txt` 二进制读通推广到未测扩展名。
- 自检后复核关键契约、测试及 RPK 内容。交付记录版本、可见构建戳、SHA256、代码 commit/必要 diff；设备反馈包含版本头、每行状态/关键数字、实际听感。
- 使用当前环境可用的证据读取方式；照片可以留档，关键结果保留逐行转录。历史 agent 会话 ID 和能力限制不是执行前提。
- 不提取设备密钥、不绕过签名、不做自动极限压力测试；已知 toolkit advisories 见 THIRD_PARTY_NOTICES，不盲目升级。
- 用户要求持续自主推进：阶段完成/通知都不是停工点，只在真正需要用户干预时暂停。**但**单个阶段仍 fail-closed（不做并发抢模型）；通知以 `[Codex]` 开头、不发进度闲聊；通知目标 ID 不写入源码与分发材料。
- 本机无人值守脚本**不在仓库内**（原在 `~/.hermes/scripts/`），新机若沿用需自行重建；语义见 §7 末段。

## 6. 已交付构建与基准

| 项目 | 值 |
|---|---|
| 上游 commit | `ba90c8e9f440ad544f674a790bb5f53878b6ffc5` |
| probe 0.2.0 RPK SHA256 | `6430760d759d453a7f033ad0017db2e91517b41b34a4a8a102ee0e03e0ad093d` |
| probe 0.3.0 RPK SHA256 | `da260c6df3e947f93b015d3e19cdb90a25ba9e551edb996765204b8dd84a7d55` |
| probe 0.3.1 RPK SHA256 | `d93fe1c6826f9eeccc81b9f5c9a3a74909318e0a7aa90805e30f8d6720e550f7` |
| probe 0.3.1 构建戳 / 代码 | `B261005T013207` / `e88ae9e` |
| probe 0.4.0 RPK SHA256 | `68479bf28bf36e2949c34e173086e58fb3ecc63c6b9b3cbf1ccbbd371d8c2908` |
| probe 0.4.1 RPK SHA256 | `22353261d791b03eaf34283b03a1757cb77cc162c742842b57fe1ab1d2446604` |
| 探针 hash | PROBE_BIN=259309834；TEST_TXT=975296040；SLICE=1037292089；BIG_TXT=534463728 |
| 性能观察，非 TTS RTF | 64KiB 读+hash 454ms；256KiB 2048ms；2KiB 切片 129ms；计算 maxSlice 4ms；双音生成 534ms，maxSlice 77ms 未定位 |
| **0.5.1-A** | `apps/vela-tts/dist/org.jspeak.tts.debug.0.5.1-a.rpk`，630242 B，解包 1316326 B，SHA256 `3eb4f87de58685eda4080f7bf802531f5bdd5118768b71b83d7807970c2977b0`，戳 `B261011T112426`，代码 `b5c40a5` |
| **0.5.1-B** | `...0.5.1-b.rpk`，44621 B，解包 84334 B，SHA256 `24f8cc0ba2867115a3b25d187a6db131fe04c04cb4d352a46fa5368661cf7b0e`，11025Hz 预计算档 |
| **0.5.1-C** | `...0.5.1-c.rpk`，37810 B，解包 72940 B，SHA256 `a06f0cc7a14da0b8f9a967c4b5ab383c2ed82333af0302fc1d7b807dd2a32a37`，5512Hz 预计算档 |
| 0.5.0 RPK | 781367 B，解包 2971643 B；启动解析 JS 1731654 B（闪退待判定的对照物） |

三档音质/资源逐项量化差异、各项优化前后数据、Node 合成基准见 [0.5.1 profiles 构建记录](build-results/2026-10-11-tts-0.5.1-profiles.md)。

历史 copy 失败后的"301 leftover"是措辞瑕疵：目标不存在，无残留。这不改变 copy 路线关闭的结论，也无需为已关闭的路线单独重发探针。

## 7. 命令与产物

- `npm test`：Node 集成测试；pretest 会生成 stamp/assets。构建后复测可用 `node --test tests/*.test.mjs` 避免改变交付 stamp。
- `npm run oracle:build`：构建固定参考程序；`npm run test:oracle`：C 自身重复性检查（**不是** C/JS 兼容测试）。
- `npm run probe:build`：构建探针（`data:build` + assets + aiot build），产物在 `apps/vela-probe/dist/`。
- `npm run tts:profiles`：构建 0.5.1 A/B/C 三档 TTS 包，产物在 `apps/vela-tts/dist/`。
- `npm run oracle:trace:build` / `npm run test:oracle:trace`：隔离插桩构建与 C 对照；`npm run data:verify` 校验候选数据；`npm run probe:source` 生成实际源代码交付副本（离线恢复用）。
- `npm run oracle:unicode:build` / `npm run test:oracle:unicode` / `npm run unicode:build` / `npm run test:unicode`：M01 全码点 C/JS 差分。
- `npm run oracle:clause:build` / `npm run test:clause`：独立 C ReadClause 参考与固定 profile 差分（例外绑定输入和签名，新例外须审查）；`npm run clause:properties:build` / `npm run test:clause:properties`：全码点原始属性差分。
- `npm run language:cmn:build` / `npm run language:cmn:verify`：cmn 数据包生成/校验；`npm run oracle:cmn-tone:build` / `npm run test:cmn-tone`：Mandarin tone pitch 13 例 exact。
- `npm run benchmark:vela-startup -- <rpk>`：启动解析/装载代理；`npm run benchmark:vela-synthesis`：Node 合成 RTF；`npm run fuzz:minimize -- ...`：有界失败缩减，见 [FUZZ](FUZZ.md)。
- `build/`、`dist/`、`artifacts/`、`apps/vela-probe/user_result/` 被忽略；代码/manifest/证据留痕仍需维护，不能只保留机器上的生成物。
- 差分测试依赖的前置：需要固定语料/artifacts 的 compare 入口（如 `test:clause-translation`、`test:phoneme-make`、`test:prosody`、`test:generate-events`）要先跑对应的 `oracle:*:build` 生成 `artifacts/` 目录再测，命令与目录名以 package.json 为准。

本机（2026-10-11 那一轮）无人值守流水线的语义，供新机重建参考：单阶段一个单元（`systemd-run --user --unit=codex-<slug>` 带内存帽；本机约 1G 内存，给 600MB 帽）；全局模型槽用 `flock` 保证同一时刻只有一个 codex 走本机 LiteLLM 桥；阶段间 fail-closed 接力（只等前一阶段的 report 文件，超时或前序失败即退出，绝不"等不到就自己开跑"）；被 429 打断时续用同一 thread 重试。**脚本与 report 一律放 `~/.hermes/scripts/` 等持久目录，不要放 scratch。**

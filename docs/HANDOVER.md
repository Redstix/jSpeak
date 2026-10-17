# jSpeak 交接入口 — 2026-10-17 修订版

本仓库正在进行 eSpeak NG 纯 JS 行为兼容移植，目标为 Redmi Watch 5 的 Xiaomi Vela JS 应用。**正式执行基线是 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)**；本文件只保存恢复顺序和操作要点。

**本次交接（2026-10-17）**：0.5.3-A 已由用户真机确认启动、固定英文合成/播放与清晰听感；B/C 预合成档由用户取消并已从产品构建移除。当前交付身份为 `0.6.0-en` 与 `0.6.0-cmn` 两个 A 档完整 JS 合成 RPK；en-us 与 cmn 的固定语料 PCM 均已在 Node 与 C Oracle 逐点闭合，设备验收待用户确认。0.5.3 三档历史记录保留，B/C 仅作已退役证据。

## 0. 在另一台机器上继续（clone 后先做这些）

clone 之后**没有** `dist/`、`build/`、`artifacts/`、`upstream/`、`node_modules/`（全部在 `.gitignore` 内）。这不是交付物丢失，按下面命令重建即可。交付身份以 §6 记录的 SHA256 为准，不以"本机曾经有过那个文件"为准。

环境要求：

- Node **>= 24**（本轮构建用 `v24.21.0` linux/x64）。
- C/C++ 工具链 + **CMake**（构建固定版本 C Oracle / 全部差分参考）。
- 网络可达 `github.com` 与 npm registry。`apps/` 层的 devDependencies（`aiot-toolkit 2.0.5`、`@aiot-toolkit/jsc 1.0.9`）是**出可安装 RPK 的必需项**，核心测试不需要它们。
- 离线/受限网络：先在有网机器上 `npm run probe:source`，用产出的 `espeak-ng.git.bundle` 恢复上游，见 [SOURCE_BUNDLE.md](SOURCE_BUNDLE.md)。

```sh
# 仓库默认分支是 work/bootstrap（落后 2 个提交），必须显式指定分支
git clone -b perf/quickjs-vela-optimization https://github.com/Redstix/jSpeak.git
cd jSpeak

npm run oracle:build            # 按 upstream.json 自动 clone 上游并 detached checkout 固定 commit
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm ci --prefix apps/vela-tts   --registry=https://registry.npmjs.org
npm test                        # 集成测试；pretest 会重生成 stamp/assets（都是 gitignore 产物）
npm run tts:build               # 重建 0.6.0-en 与 0.6.0-cmn A-only RPK（clone 后没有任何现成 RPK）
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

## 2. 交接时点状态（2026-10-17 06:00 UTC 实测核实）

| 项 | 事实 |
|---|---|
| 权威分支 | `perf/quickjs-vela-optimization`；0.5.3 运行时代码与 profiles 构建提交为 `243a3a404228b57acd170657df0819803e397f69`，0.6.0 A-only 提交见 M1 构建记录 |
| 工作树 | 本轮文档提交后应干净；`dist/` 为 gitignore，须按 §0 重建 |
| 分支拓扑 | `perf/...` 在 `work/bootstrap`(`5c1d358`) 之后持续追加 M14 提交；`work/vela-performance`(`3028ac8`) 是已放弃的早期性能实验；`main`(`4ebefcb`) 是历史存档 |
| 流水线 | **已停止**。最后一个 jSpeak codex 会话结束于 2026-10-11 11:38；10-12/13/14 无 jSpeak 会话、无提交 |
| 阻塞门 | ~~0.5.3 A/B/C 真机验收~~ → **A 档已由用户确认通过（清晰 Hello world）；B/C 用户决定取消**；下一版只保留 A 档，见 §4 |
| 已就绪产物 | 0.6.0-en 与 0.6.0-cmn A-only RPK 在本机 `apps/vela-tts/dist/`（gitignore，需重建），身份见 §6 |

流水线为什么静默停下：本机的「jSpeak 流水线看门狗」cron 任务已不在 cron 表中，而 Codex 阶段的 report 文件写在 `~/.hermes/cache/scratch/` —— 该目录 **idle 24h 即被 prune**，report 会一并消失。看门狗已不在、report 又留不住，整条链停了三天没有任何一处能报出来。已写进 [STATUS](STATUS.md) 未完成项：**持久产物不要放 scratch**。

## 3. 现在该做什么（不依赖用户的队列）

按最终计划的顺序，未完成且**不需要设备**的部分：

1. **真机验收**：用户安装 `0.6.0-en` 与 `0.6.0-cmn`，确认启动、固定短语合成/播放、听感、连续 10/20 次、长文本、停止/重启和设备页数字。Agent 不得代宣。
2. **M12/M15 Node 收口已完成**：en-us 固定 `Hello world.` 23,190 样本、cmn 固定 30 例 29 exact + 1 设计性 unsupported、JS PCM 29/1；不得再把旧 22,809 样本/首个差异 1384 当作当前状态。
3. **M13 数据最小化**：尚未开始。按完整依赖关系裁剪、冻结生产格式与构建 profile，须给出裁剪前后目标语料 trace/PCM 不变。
4. **M14/S1 完整验收**：Node 合成基准与 100 次会话/长输入/背压/取消重启已复跑；设备启动、heap、RTF、稳定性仍未验收。进一步算法优化必须先证明 int32/舍入/resume 等价并有前后基准。
5. **M16 维护演练**：隔离环境跑通上游同步流程并输出差异/资源报告，不能只有说明文档。
6. 基础设施：若新机继续无人值守，重建看门狗 + 把 report 落盘位置移到 scratch **之外**（§2 那个教训的直接修复）。

## 4. 设备门（只有用户能关，agent 不得代宣）

- **0.5.3-A 已通过（2026-10-17 用户确认）**：用户原话「a档rpk真机测试通过，有清晰hello，world声音」。只记录到启动/固定英文合成/播放/听感通过；未提供逐行数据，设备 CPU/heap/RTF 仍不可测。
- **B/C 档取消**：用户明确「预合成的有什么意义，不要了」。下一版构建只产 A 档；B/C 未做真机验收，不补测、不再推广。
- 旧记录（对照用）：0.5.0 闪退待判定记录仍在 [设备](device-results/2026-10-11-tts-0.5.0.md)、[构建](build-results/2026-10-11-tts-0.5.0.md)。
- 纪律：**真机听感与"启动不再闪退"只能由用户确认**；构建与静态校验通过一律写「待用户真机验收」。`onended` 只证明播放事件，不证明听感。

## 5. 仓库与操作纪律

- 远端 `origin = https://github.com/Redstix/jSpeak.git`（**公开仓库**，HTTPS + `gh` 凭据；默认分支是 `work/bootstrap`，clone 时按 §0 用 `-b perf/quickjs-vela-optimization`）。已推送分支：`main`、`work/bootstrap`、`work/vela-performance`、`perf/quickjs-vela-optimization`。
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
| probe 0.3.1 构建戳 / 代码 | `B261005T013207` / `9545c64` |
| probe 0.4.0 RPK SHA256 | `68479bf28bf36e2949c34e173086e58fb3ecc63c6b9b3cbf1ccbbd371d8c2908` |
| probe 0.4.1 RPK SHA256 | `22353261d791b03eaf34283b03a1757cb77cc162c742842b57fe1ab1d2446604` |
| 探针 hash | PROBE_BIN=259309834；TEST_TXT=975296040；SLICE=1037292089；BIG_TXT=534463728 |
| 性能观察，非 TTS RTF | 64KiB 读+hash 454ms；256KiB 2048ms；2KiB 切片 129ms；计算 maxSlice 4ms；双音生成 534ms，maxSlice 77ms 未定位 |
| **0.5.2-A** | `apps/vela-tts/dist/org.jspeak.tts.debug.0.5.2-a.rpk`，629948 B，解包 1315658 B，SHA256 `7a9ec2e090e37a6b2b52863abb0851a6a3bbaac31d7b7102374c82ec1cffc773`，戳 `B261015T045913`，构建代码 `0921387` |
| **0.5.2-B** | `...0.5.2-b.rpk`，44623 B，解包 84341 B，SHA256 `4dbc588ceb6c7e6de7e24dfbcfdec88bfb0dd98daebc7afe731263d62d2578ae`，11025Hz 预计算档 |
| **0.5.2-C** | `...0.5.2-c.rpk`，37814 B，解包 72939 B，SHA256 `8fcfe3ff231d0f333b0961227bb9f0d88ee6c071ca4f3bfb9e888617d0d843c7`，5512Hz 预计算档 |
| **0.6.0-en（当前）** | `apps/vela-tts/dist/org.jspeak.tts.debug.0.6.0-en.rpk`，635685 B，解包 1338207 B，SHA256 `635a6c1465d7746b07cedf6a49473e17d50fabe76ac33056154238e6ec3ae8d2`，戳 `B261017T125827`，versionName/Code `0.6.0-en`/17，数据 898009B |
| **0.6.0-cmn（当前）** | `apps/vela-tts/dist/org.jspeak.tts.debug.0.6.0-cmn.rpk`，1066129 B，解包 2736927 B，SHA256 `918fe6ac0b3b9a3c02eebf0ed5321b491c64be3122164964497113e31f5f4822`，戳 `B261017T125827`，versionName/Code `0.6.0-cmn`/18，数据 2295161B |
| **0.5.3-A（已用户验收）** | `apps/vela-tts/dist/org.jspeak.tts.debug.0.5.3-a.rpk`，630005 B，解包 1315752 B，SHA256 `2359f7f7ab853cba35df2d4a70db61a6072cb40d27a45b438844c1101001340e`，戳 `B261015T092946`，构建代码 `243a3a4` |
| 0.5.0 RPK | 781367 B，解包 2971643 B；启动解析 JS 1731654 B（闪退待判定的对照物） |

A-only 构建见 [0.6.0 A-only 构建记录](build-results/2026-10-17-tts-0.6.0-a-only.md) 与 [0.6.0 en+cmn 收口记录](build-results/2026-10-17-tts-0.6.0-cmn.md)。0.5.3 B/C、0.5.1/0.5.2 的三档数字为历史记录，产品路线已退役，不得按当前构建入口重建或验收。

历史 copy 失败后的"301 leftover"是措辞瑕疵：目标不存在，无残留。这不改变 copy 路线关闭的结论，也无需为已关闭的路线单独重发探针。

## 7. 命令与产物

- `npm test`：Node 集成测试；pretest 会生成 stamp/assets。构建后复测可用 `node --test tests/*.test.mjs` 避免改变交付 stamp。
- `npm run oracle:build`：构建固定参考程序；`npm run test:oracle`：C 自身重复性检查（**不是** C/JS 兼容测试）。
- `npm run probe:build`：构建探针（`data:build` + assets + aiot build），产物在 `apps/vela-probe/dist/`。
- `npm run tts:build`：构建 0.6.0-en 与 0.6.0-cmn 两个 A 档完整 JS 合成 RPK，产物在 `apps/vela-tts/dist/`；不产 B/C 预合成档。可选 `-- --reuse-stamp --reuse-existing-rpk` 只补缺失包。
- `npm run oracle:trace:build` / `npm run test:oracle:trace`：隔离插桩构建与 C 对照；`npm run data:verify` 校验候选数据；`npm run probe:source` 生成实际源代码交付副本（离线恢复用）。
- `npm run oracle:unicode:build` / `npm run test:oracle:unicode` / `npm run unicode:build` / `npm run test:unicode`：M01 全码点 C/JS 差分。
- `npm run oracle:clause:build` / `npm run test:clause`：独立 C ReadClause 参考与固定 profile 差分（例外绑定输入和签名，新例外须审查）；`npm run clause:properties:build` / `npm run test:clause:properties`：全码点原始属性差分。
- `npm run language:cmn:build` / `npm run language:cmn:verify`：cmn 数据包生成/校验；`npm run oracle:cmn-tone:build` / `npm run test:cmn-tone`：Mandarin tone pitch 13 例 exact。
- `npm run benchmark:vela-startup -- <rpk>`：启动解析/装载代理；`npm run benchmark:node-synthesis`：en+cmn 5×25 成对 Node 基准；`npm run stress:node-synthesis`：100 会话/长输入/背压/取消重启；`npm run fuzz:minimize -- ...`：有界失败缩减，见 [FUZZ](FUZZ.md)。
- `build/`、`dist/`、`artifacts/`、`apps/vela-probe/user_result/` 被忽略；代码/manifest/证据留痕仍需维护，不能只保留机器上的生成物。
- 差分测试依赖的前置：需要固定语料/artifacts 的 compare 入口（如 `test:clause-translation`、`test:phoneme-make`、`test:prosody`、`test:generate-events`）要先跑对应的 `oracle:*:build` 生成 `artifacts/` 目录再测，命令与目录名以 package.json 为准。

本机（2026-10-11 那一轮）无人值守流水线的语义，供新机重建参考：单阶段一个单元（`systemd-run --user --unit=codex-<slug>` 带内存帽；本机约 1G 内存，给 600MB 帽）；全局模型槽用 `flock` 保证同一时刻只有一个 codex 走本机 LiteLLM 桥；阶段间 fail-closed 接力（只等前一阶段的 report 文件，超时或前序失败即退出，绝不"等不到就自己开跑"）；被 429 打断时续用同一 thread 重试。**脚本与 report 一律放 `~/.hermes/scripts/` 等持久目录，不要放 scratch。**

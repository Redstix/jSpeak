# Implementation status — 2026-10-02

## 已完成

- Git 原始资料基线；工作分支 `work/bootstrap`，无 remote/push。
- 原始阶段文档解包到 `design/stages/`，内容未改。
- 兼容性、trace envelope、运行时门槛、源码映射规则草案。
- PCM16 比较器、严格 WAV 解析器及差异/格式边界测试。
- 固定 eSpeak NG `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，本地 CMake Release 静态参考程序和数据构建成功。
- CLI smoke：22 输入，每例两个独立进程，音素文本与 WAV 哈希一致。空输入不生成 WAV 的行为显式记录。
- Vela 探针 0.1.0：能力、设备信息、64KiB 资源、分片计算、文件测试音、取消/生命周期清理。
- `npm test`：31 项单测通过；包含 PCM/WAV、探针能力、分片计时、设备端双音生成、内部文件生命周期和取消清理。
- 探针 0.2.0 已构建并完成真机测试：包内 bin/dat/WAV 对照、内部文件写入读回、分离首次调度延迟、设备 JS 生成双音后写文件播放。
- 首轮真机截图确认基础能力通过，用户确认约 2 秒测试音（仅适用于 0.1.0 预置 WAV）。
- 真机计算 hash `437906867` 两轮均与本地一致。结果见 [首轮](device-results/2026-10-02-probe-0.1.0.md) 与 [第二轮](device-results/2026-10-02-probe-0.2.0.md) 设备结果。
- 第二轮真机证实：内部文件二进制 I/O 可用（64KiB bin 写入后全字节读回一致；64044 字节运行期生成 WAV 同样 verify 通过）；JS 生成双音 WAV 播放收到 ENDED 事件，用户确认听到低音—停顿—高音、顺序正确。
- 包内资源 bin/dat/wav 三类均 readArrayBuffer 失败 `202 invalid file type`；同 API 读内部 bin/wav 成功。失败已收敛到包内资源路径，非扩展名问题。
- 分片计算 #1：total 475ms，测量窗口累计 67ms，maxSlice 4ms，首次调度等待 158ms，后续等待 p50/p95/max = 8/9/9ms。无双音的 #2/#3 独立测量证据。
- JS 双音生成：total 534ms / 63 片 / 2s 音频，maxSlice 77ms（原因未定位；非 eSpeak DSP，不代表合成 RTF）。
- 包内资源根因调查（2026-10-04，官方契约直接核对）：readText/readArrayBuffer 明文支持应用资源路径；write 系列明文排除资源路径；**file.copy 的 srcUri 无限制条款**——“包内→internal 复制”成为首要候选装载出口；readText/copy/access 的包内行为设备未测。判别矩阵与决策树见 [调研记录](research/2026-10-04-vela-file-api-package-resources.md)。术语修正：目标平台为 Vela JS 应用（官方站点自名，非手机快应用联盟规范）。
- 探针 0.3.0 已构建：文件 API 判别矩阵 7 行（B1 包内 .txt readText / B2 .txt readArrayBuffer / B3 access / B4 copy→internal / B5 复制读回校验 / B6 大写 /Common/ / B7 internal position/length 部分读）+ 4 个 hash 校验常量；`npm test` 40 项全过。审查发现并修复 copy 参数名错误（官方契约为 `dstUri`，初版实现误传 `uri`，真机上会使 B4 恒 202、误导出口结论）。交付 RPK SHA256 `da260c6df3e947f93b015d3e19cdb90a25ba9e551edb996765204b8dd84a7d55`（dist/ 不入 git，以此为准；0.3.0 重建清空 dist，0.2.0 磁盘产物已移除，其出处以提交 `883bd7f` 与文档记录为准）。

## 已知限制

- 尚无 JS phonemizer、合成器或 C/JS 差分兼容结果。
- M00 仅完成 CLI reference smoke；内部 trace 插桩、schema 校验器、完整上游语料、fuzz 基础设施仍待实现。
- 探针仍只验证文件播放路线；原始 PCM streaming、真实 DSP RTF、峰值 heap 均未证实。内部完整 WAV 文件现为已部分验证的音频出口，但不能包装成 streaming。
- 包内资源读取路径受限（bin/dat/wav 均 202）：本地核查 RPK 确认文件在包内、`@system.audio` src 可播放包内 WAV，限制在 file API 读取包内路径；词典/音素表等包内静态数据的装载机制尚未解决。
- ENDED 事件不等于实际出声；双音听感已由用户确认，但该原则对后续事件类证据仍然适用。
- maxSlice 77ms 异常片未定位；8–9ms 定时读数涉时钟分辨率/定时器语义，不作硬实时保证。
- Node/mock 测试不能验证 UX 真机渲染、系统 API 支持或实际出声。
- Vela 构建依赖安装报告 14 项 advisories（3 low、11 high），未盲目升级破坏 toolkit；见 THIRD_PARTY_NOTICES.md。
- 未执行完整上游 C 测试套件或模拟器；尚无合成性能验证。

## 下一步

1. 用户真机运行探针 0.3.0「文件API判别」节（B1–B7），据结果走[装载方案决策树](research/2026-10-04-vela-file-api-package-resources.md)：B4+B5 通过 → 包内复制出口；B4 ✗ 而 B1 ✓ → 文本编码数据；全 ✗ → 构建期 JS 数据模块或 interconnect 导入。
2. 核验上游源码观察点与调用顺序，补内部 Trace Oracle、音素表数据加载和阶段映射。
3. 推进 phonemizer 与代表性 DSP 重放切片；真实 DSP 基准保留首次等待、分片测量窗口与总耗时，定位 77ms 异常片。设备实测前不承诺实时可用。

不以文档存在代替功能完成；不以 harness 自检代替 C/JS 兼容通过。

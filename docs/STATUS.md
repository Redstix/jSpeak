# Implementation status — 2026-10-02

## 已完成

- Git 原始资料基线；工作分支 `work/bootstrap`，无 remote/push。
- 原始阶段文档解包到 `design/stages/`，内容未改。
- 兼容性、trace envelope、运行时门槛、源码映射规则草案。
- PCM16 比较器、严格 WAV 解析器及差异/格式边界测试。
- 固定 eSpeak NG `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，本地 CMake Release 静态参考程序和数据构建成功。
- CLI smoke：22 输入，每例两个独立进程，音素文本与 WAV 哈希一致。空输入不生成 WAV 的行为显式记录。
- Vela 探针 0.1.0：能力、设备信息、64KiB 资源、分片计算、文件测试音、取消/生命周期清理。
- `npm test`：19 项单测通过；包括比较器、WAV、探针计算及 mock 生命周期测试。
- `npm run probe:build`：debug RPK 构建成功；首轮真机截图确认基础能力通过，用户确认约 2 秒测试音。
- 真机计算 hash `437906867` 与本地一致；资源读取失败 `202 invalid file type`。见 [首轮设备结果](device-results/2026-10-02-probe-0.1.0.md)。

## 已知限制

- 尚无 JS phonemizer、合成器或 C/JS 差分兼容结果。
- M00 仅完成 CLI reference smoke；内部 trace 插桩、schema 校验器、完整上游语料、fuzz 基础设施仍待实现。
- 探针只验证文件播放路线；原始 PCM streaming、真实 DSP RTF、峰值 heap 均未证实。
- Node/mock 测试不能验证 UX 真机渲染、系统 API 支持或实际出声。
- Vela 构建依赖安装报告 14 项 advisories（3 low、11 high），未盲目升级破坏 toolkit；见 THIRD_PARTY_NOTICES.md。
- 未执行完整上游 C 测试套件或模拟器；真机仅完成首轮基础测试，尚无合成性能验证。

## 下一步

1. 首轮反馈已收到并归档；下一轮定位 `readArrayBuffer` 文件类型错误。
2. 验证设备 JS 生成 WAV、内部文件写入与播放，并拆分首调度/计算/后续调度时间。
3. 核验上游源码观察点与调用顺序，补内部 Trace Oracle、音素表数据加载和阶段映射。
4. 推进 phonemizer 与代表性 DSP 切片；设备实测前不承诺实时可用。

不以文档存在代替功能完成；不以 harness 自检代替 C/JS 兼容通过。

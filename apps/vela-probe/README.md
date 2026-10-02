# jSpeak 设备探针 0.2.0

目标：Redmi Watch 5，432×514，`designWidth: 432`。本版不是 TTS，不含 eSpeak 数据或合成器。

首轮 0.1.0 的基础能力和包内测试音已由真机确认；资源读取返回 `202 invalid file type`，见 [首轮记录](../../docs/device-results/2026-10-02-probe-0.1.0.md)。0.2.0 是定位问题的对照实验，不能把构建成功视为设备问题已修复。

## 本机构建

```sh
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build
```

产物：`apps/vela-probe/dist/org.jspeak.probe.debug.0.2.0.rpk`。包名保持 `org.jspeak.probe`，versionCode 增加为 2。保留旧 RPK，安装后核对页面标题与结果中版本。

使用 aiot-toolkit 开发签名。由用户自行安装到自己的设备；不提供设备密钥提取。重建包含时间及签名元数据，RPK 整包哈希不承诺重复构建相同；以每次交付的 SHA256 为准。

## 本轮优先测试

1. **包内资源对照**：依次读取 `/common/probe.bin`、相同字节的 `probe.dat`、已知可播放的 `tone.wav`。前三项结果分别显示；bin/dat 校验全部 64KiB，WAV 只校验头部与长度。单项 3 秒超时后继续下一项。
2. **内部文件写入/读回**：生成 64KiB 数据，使用 `internal://files/jspeak-probe-020-<time>-<sequence>.bin`。先 `file.get` 确认不存在，再写入，读回逐字节对比，完成后删除。请截图 check/write/read 错误、总结果和清理结果。
3. **分片计算**：连续手动运行 3 次，保留最近 3 个槽位。32 片 × 2048 运算，预期 hash `437906867`。记录 total、分片 sum/max、首次等待 firstWait，以及后续 31 次等待的 p50/p95/max。每片间主动等待 10ms；sum 也受 Date.now 精度影响，**均不是 TTS RTF**。
4. 降低设备音量，点 **预置测试音** 作旧路径对照，仍应为两秒连续嘟声。
5. 点 **JS生成双音并播放**。声音由设备 JS 生成，**不是包内音频**：低音约 0.8 秒 → 静音约 0.4 秒 → 高音约 0.8 秒。流程是分片生成完整 WAV → 内部文件写入 → 全字节读回核验 → 播放 → 删除。请回报有没有听到两个不同音高及中间停顿，并截图生成、write/read、播放和清理结果。
6. 播放中停止、切到后台再返回、再次测试。报告是否真正停止，有无残留声音、崩溃或长期 BUSY。

能力检查和设备信息仍保留。设备信息 `ap / 0.0.0` 只视为 API 返回值，不当成真实型号/固件；请从系统设置补充固件号（若方便）。

## 安全边界与取消

- 不自动探测 OOM，不长时间循环施压，不读取个人文件。
- 每个内部测试使用专有唯一临时文件名；若已存在则拒绝覆盖。只删除本次尝试创建的文件。
- 写/读 I/O 不能通过 JS 定时器真正中断。取消后等待在途 I/O 回调再清理，不提前复用其 buffer；待回调期间拒绝发起新的内部文件测试，显示 BUSY。
- 若操作永远没有回调，需要退出应用后重试；可能残留专有临时文件，不能承诺异常断电/退出下自动清理。删除失败会显示 leftover URI。
- 停止播放器后才请求删除 WAV。若设备音频 API 异步释放文件导致删除失败，记录错误而不声称清理成功。
- 全流程 10 秒没有完成则记录 FAIL timeout 并停止。若系统事件循环被阻塞，定时器自身也会延后，不是硬实时 watchdog。

## 结果解释

- `PASS`：对应语义核验成功；不代表全链路都通过。
- `FAIL check`：内部文件存在性查询失败或发现同名文件，尚未尝试写入。
- `FAIL write/read`：对应步骤失败，保留原始错误。不能直接归因签名或扩展名。
- `BUSY`：上次文件 I/O 或清理尚未返回；稍后重试。
- `CANCELLED`：主动停止或被下一测试替换。
- `PLAY/ENDED event`：仅音频事件，仍需用户确认实际出声。
- `PCM streaming UNVERIFIED`：这仍是完整文件播放，不是原始 PCM streaming，不验证连续小文件无缝播放。

## 反馈模板

```text
版本（页面标题需为0.2.0）：
设备固件（系统设置）：
包内 .bin / .dat / WAV 各项结果：
内部文件 check/write/read/清理：
计算 #1/#2/#3 截图：
预置连续嘟声：是/否
JS生成双音：是否听到低音—停顿—高音：
JS生成/write/read/音频事件/清理截图：
停止及前后台切换：
重复测试 / 是否长期BUSY：
```

照片可继续放 `user_result/`，该目录仅本地保留、不提交 Git；结果摘要写入 `docs/device-results/`。

## API 依据

查阅于 2026-10-02：

- https://iot.mi.com/vela/quickapp/zh/features/other/audio.html — `@system.audio`、`src`、`play/stop`、`onplay/onended/onerror`。
- https://iot.mi.com/vela/quickapp/zh/features/data/file.html — `get`、`readArrayBuffer`、`writeArrayBuffer`、`delete`；write.buffer / read.success.buffer 均为 Uint8Array；缺失文件错误 301。
- 项目自带 `vela-rpk-dev/SKILL.md` — CLI 流程、设备尺寸、UX 基本组件。

Node mock 测试只验证本地逻辑，不能替代 Vela 渲染、系统 API 或音频硬件验证。

# jSpeak 设备探针 0.3.0

目标：Redmi Watch 5，432×514，`designWidth: 432`。本版不是 TTS，不含 eSpeak 数据或合成器。

0.2.0 实测：`file.readArrayBuffer` 对包内 `/common/probe.bin`、`.dat`、`.wav` 全部返回 `202 invalid file type`；同一 API 对 `internal://files/` 读写正常；`@system.audio` 播放包内 WAV 正常。官方契约声称 readArrayBuffer 支持应用资源路径（见 [调研记录](../../docs/research/2026-10-04-vela-file-api-package-resources.md)）。0.3.0 的唯一目的：判别 `@system.file` 对"包内应用资源路径"的真实行为边界，并验证"包内资源 copy 到 internal"这一候选数据装载出口。构建成功不代表设备问题已修复。

## 本机构建

```sh
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build
```

产物：`apps/vela-probe/dist/org.jspeak.probe.debug.0.3.0.rpk`。包名保持 `org.jspeak.probe`，versionCode 增加为 3。保留旧 RPK，安装后核对页面版本头 `READY 0.3.0`。

使用 aiot-toolkit 开发签名。由用户自行安装到自己的设备；不提供设备密钥提取。重建包含时间及签名元数据，RPK 整包哈希不承诺重复构建相同；以每次交付的 SHA256 为准。

## 本轮核心：文件API判别（7 行）

点 **5 文件API判别** 依次运行 B1–B7；每行显示 PASS/FAIL 与耗时，单行 3 秒超时（B7 写入 64KiB 需更久，9 秒）。每行回答的问题：

| 行 | 操作 | 回答的问题 |
|---|---|---|
| B1 readText .txt | `readText({uri:'/common/test.txt'})`，512 字节 ASCII | 文本读取后端是否支持包内资源路径 |
| B2 readAB .txt | `readArrayBuffer({uri:'/common/test.txt'})` | 与 B1 联合判别：B1✓+B2✗ → 仅二进制读取缺失；两者✗ → 扩展名类型化或资源支持整体缺失 |
| B3 access .bin | `access({uri:'/common/probe.bin'})` | 包内资源路径在 file API 的可见性 |
| B4 copy→internal | `copy({srcUri:'/common/probe.bin', dstUri:'internal://files/jspeak-probe-030-<时间戳>-<序号>-c.bin'})` | **数据装载出口候选**：包内资源能否复制到 internal（官方契约 copy.srcUri 无资源路径限制） |
| B5 copy读回 | 对 B4 产物全量 readArrayBuffer，校验长度 65536 且 hash | 复制保真性；B4 失败时本行记 SKIPPED |
| B6 大写 /Common | `readArrayBuffer({uri:'/Common/probe.bin'})` | file API 的大小写敏感性（audio 已证实不敏感，file 未测） |
| B7 internal部分读 | 写 64KiB 确定性 pattern 到 scratch 后 `readArrayBuffer({uri, position:1024, length:2048})` 并校验 hash | internal 分区随机访问（position/length）能力；若设备忽略参数会读回全量并记 hash 不符 |

校验用 hash 常量（Node 对真实文件本地计算，与设备端 `hashBytes` 同一函数）：

- `PROBE_BIN_HASH = 259309834` — `probe.bin` 全量 65536 字节。
- `TEST_TXT_TEXT_HASH = 975296040` / `TEST_TXT_BYTES_HASH = 975296040` — `test.txt` 512 字节（纯 ASCII 下文本与字节 hash 相同）。
- `SLICE_HASH = 1037292089` — B7 pattern 的 bytes[1024..3072]。

设备上的预期成功值：B1 `PASS len=512 hash=975296040`；B2/B6 `PASS bytes=… hash=…`（与常量比对）；B5 `PASS hash=259309834`；B7 `PASS hash=1037292089`。B1/B2/B3/B6 记录的是观测值，请与上述常量对照后回报。

B4/B5 通过 → 首选装载出口成立（数据打包 `/common`，首启复制到 `internal://files/`，运行期 position/length 随机访问）；B4 失败但 B1 成功 → 文本编码出口；全部失败 → 构建期 JS 数据模块或外部导入。详见调研记录的决策树。

## 保留的其他测试

1. **能力检查**：TypedArray/DataView/Math.imul/32-bit shift 四行，仍应全 PASS。
2. **设备信息**：`model / osVersionName / API` 仅视为 API 返回值，请从系统设置补充固件号（若方便）。
3. **包内资源对照**：0.2.0 的三项 readArrayBuffer（小写 `/common/` 的 .bin/.dat/.wav）保留，用于与 B6 大写结果和 0.2.0 记录直接对比。
4. **分片计算**：连续手动运行 3 次，32 片 × 2048 运算，预期 hash `437906867`。记录 total、分片 sum/max、firstWait 及后续等待 p50/p95/max；**均不是 TTS RTF**。

0.2.0 的预置音频播放与 JS 双音行已移除（能力已确认，本版无音频播放）；`src/tone.js` 保留在仓库中不参与页面。

## 安全边界与取消

- 不自动探测 OOM，不长时间循环施压，不读取个人文件。
- B4 产物与 B7 scratch 均为专有唯一临时文件名（`jspeak-probe-030-<时间戳>-<序号>…`）；copy 前先 `file.get` 确认目标不存在，拒绝覆盖。只删除本次尝试创建的文件。
- B7 沿用 scratch 写入模式：写 → 全字节读回核验 → 部分读。写/读 I/O 不能通过 JS 定时器真正中断；取消后等待在途 I/O 回调再清理；待回调期间发起新测试会显示 BUSY。B4 复制在途时取消同样等复制回调返回后再删除产物。
- 文件API判别整节有 35 秒兜底 watchdog（单行超时之和上限约 27 秒）；若系统事件循环被阻塞，定时器自身也会延后，不是硬实时 watchdog。
- 若操作永远没有回调，需要退出应用后重试；可能残留专有临时文件。删除失败会显示 leftover URI（copy 失败后的清理尝试若报 `301`，通常表示产物文件从未创建）。

## 结果解释

- `PASS`：对应语义核验或观测记录成功；不代表全链路通过。
- `FAIL <code> <message>`：该 API 调用失败，保留原始错误码（如 `202 invalid file type`）。
- `FAIL hash 不符 len=…`：读取成功但内容与常量不一致（B7 上 len 为全量长度说明设备忽略了 position/length 参数）。
- `SKIPPED`：前置步骤（B4）失败，本行未执行。
- `FAIL Error: UNSUPPORTED <member>`：设备上不存在该 API 成员（如 copy/access/readText），按失败记录不中断后续行。
- `BUSY`：上次文件 I/O 或清理尚未返回；稍后重试。
- `CANCELLED`：主动停止或被下一测试替换。

## 截图建议

1. 页面顶部版本头 `READY 0.3.0`（证明版本）。
2. **文件API判别** 整节：B1–B7 全部 7 行 + `B7 scratch 路径/write/read` + `临时文件清理` + `会话 DONE`。单屏放不下时分两屏截，确保 B4/B5/B6/B7 可见。
3. 若 B4/B5 通过：截图 `B4 copy→internal` 的产物 URI 行与 `B5 copy读回` 的 hash 行（装载出口成立的直接证据）。
4. 重复点 5 文件API判别 第二次的结果（确认无残留 BUSY、临时文件可重复创建删除）。

## 反馈模板

```text
版本（页面版本头需为 READY 0.3.0）：
设备固件（系统设置）：
B1 readText / B2 readArrayBuffer(.txt)：
B3 access / B6 大写 /Common（hash 与常量对照）：
B4 copy→internal / B5 copy读回（hash）：
B7 部分读（hash，len 是否为 2048）：
B7 scratch write/read/清理 + 是否残留 BUSY：
重复运行第二次结果：
```

照片可继续放 `user_result/`，该目录仅本地保留、不提交 Git；结果摘要写入 `docs/device-results/`。

## API 依据

查阅于 2026-10-04（详见 [调研记录](../../docs/research/2026-10-04-vela-file-api-package-resources.md)）：

- https://iot.mi.com/vela/quickapp/zh/features/data/file.html — `readText`/`readArrayBuffer` uri "支持应用资源路径，例如 '/Common/demo.txt'"（错误码 202/300/301）；`writeText`/`writeArrayBuffer` 不支持资源路径；`copy` srcUri 无限制、dstUri 不能是资源路径；`access` 无资源路径限制条款；缺失文件错误 301。
- https://iot.mi.com/vela/quickapp/zh/guide/framework/project-structure.html — URI 模型（应用资源 `/path` 只读、`internal://files` 可写）、允许字符与 `..` 禁令；官方示例用大写 `/Common/`。
- https://iot.mi.com/vela/quickapp/zh/features/other/audio.html — `@system.audio`（0.2.0 已验证包内路径播放）。
- 项目自带 `vela-rpk-dev/SKILL.md` — CLI 流程、设备尺寸、UX 基本组件。

Node mock 测试只验证本地逻辑与常量，不能替代 Vela 渲染、系统 API 或文件系统行为验证。

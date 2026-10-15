# jSpeak Vela TTS 测试 0.5.2 profiles

本轮在 `perf/quickjs-vela-optimization` 上继续 M14：在不改变 A 档 22050Hz/PCM16 输出的前提下，减少 QuickJS 初始化对象、页面模块与合成期重复分配。A 档保留固定英文 `Hello world.` 的 JS 数据装载、文本合成、有界 PCM、WAV 写入/读回和播放路径；B/C 档仍为预计算播放档，用于隔离启动资源和采样率取舍。

## 构建身份

构建代码 commit：`c37504c63cf04d301fe91df6bbf738a8a86e6277`；构建戳：`B261015T045913`。

| 档位 | RPK | RPK B | 解包 B | SHA256 | versionName / Code |
|---|---|---:|---:|---|---|
| A | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.2-a.rpk` | 629948 | 1315658 | `7a9ec2e090e37a6b2b52863abb0851a6a3bbaac31d7b7102374c82ec1cffc773` | `0.5.2-a` / 11 |
| B | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.2-b.rpk` | 44623 | 84341 | `4dbc588ceb6c7e6de7e24dfbcfdec88bfb0dd98daebc7afe731263d62d2578ae` | `0.5.2-b` / 12 |
| C | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.2-c.rpk` | 37814 | 72939 | `8fcfe3ff231d0f333b0961227bb9f0d88ee6c071ca4f3bfb9e888617d0d843c7` | `0.5.2-c` / 13 |

## 资源与音质边界

- A 档启动解析 360630B（0.5.1-A 为 361297B，-667B / -0.184613%），启动 I/O 0B，首次点击仍整读 898009B。A 输出仍为 22809 样本 / 45662B / 22050Hz / PCM16，SHA256 `fc94cec17a566cdc2fe06be15b0df4b227406c05646b0343f0b5f6e1008ea6d1`，未改变采样率、量化或合成算法。
- B/C 启动解析 4696B / 4697B，JS 文件读取 0B；音频为 11025Hz / 5512Hz PCM16。B/C 的零阶重构 SNR 分别为 16.913dB / 10.719dB，峰值误差 4540 / 9832，完整量化见构建报告。
- 目标为 Redmi Watch 5 的 Xiaomi Vela JS 应用；用户已告知运行引擎为 QuickJS。固件版本、QuickJS 版本、设备 heap 峰值和真机启动/听感仍待用户验收，不能由 Node/mock 结果代替。

## 验收

1. 依次安装 A、B、C；每档先只打开核对页头 `READY 0.5.2-X B261015T045913`，不要先点击。
2. A 点击 **合成 / 播放**，记录六个数据 PASS、合成、写入、读回、播放、清理、听感、第二次运行和前后台。
3. B/C 点击 **播放**，记录 onplay/onended、是否听到英文、清晰度/失真/截断，以及第二次运行。
4. 回报模板见 `docs/device-results/2026-10-15-tts-0.5.2-quickjs-optimization.md`。

# Runtime profile and device gate

## 状态

设备目标 Redmi Watch 5；布局尺寸为 432×514，designWidth 432。两轮真机已确认被测 TypedArray/DataView/Math.imul/shift 语义、包内 WAV 出声（0.1.0 用户确认）与计算 hash 跨端一致；API 返回 `ap / 0.0.0 / API1200`，真实固件与引擎仍不明确。

第二轮真机结果（`docs/device-results/2026-10-02-probe-0.2.0.md`）：内部文件二进制 I/O 可用——64KiB `.bin` 与 64044 字节运行期生成 `.wav` 均写入后全字节读回一致；JS 生成双音 WAV 播放收到 ENDED 事件（人工双音听感待确认）。内部完整 WAV 文件因此成为已部分验证的音频出口，但不构成 streaming 能力。包内资源 bin/dat/wav 三类 readArrayBuffer 均失败 `202 invalid file type`，而内部 bin/wav 成功：限制收敛在包内资源路径，词典等静态数据装载方案仍待核验。完整可用内存和实时合成能力尚未验证；简单正弦生成 534ms/2s 不属于 eSpeak DSP 基准。

## 隔离

核心仅接收数据与显式上下文，不 import Node、DOM、Vela。Node 用于工具/测试，系统音频/文件 API 仅在适配层。构建用语法转换不能补齐不存在的运行时 API。

必测候选：ArrayBuffer、Uint8Array、Int16Array、Uint32Array、DataView、字节序读写、有符号转换、Math.imul、基本定时调度。支持某个 API 必须检验其行为，不只检验 typeof。BigInt、Promise、TextEncoder 不默认成为核心依赖。

## 第一版探针

全部手动启动，先显示静态标题与版本。默认短任务、小缓冲，支持停止和页面销毁清理。

- 能力测试逐项 PASS / FAIL / UNSUPPORTED。
- 分配测试只验证保守大小可用，不自动探测 OOM 边界，不声称测得峰值 heap。
- 计算测试记录实际工作量、耗时、分片间隔；不是 TTS RTF。
- 文件播放记录 API 事件，用户确认是否实际有声；调用成功不等于听到了声音。
- 未证实原始 PCM 输入时写明“PCM streaming 未验证”，文件播放不可代替此项。
- 系统 API 拒绝可能有多种原因，不能未经排查归咎签名；不提取设备密钥。

## 流式契约（实现前必须落实）

适配层明确 copy/retain 的缓冲所有权；retained 缓冲确认归还前禁止复用。使用有界队列，满则暂停生成，消费后恢复。每次 render 有有限工作预算，主动让出事件循环。取消使用会话代号隔离迟到回调，停止后释放队列与音频资源。

合成完成与播放完成是不同事件。不同 chunk 大小拼接输出须一致；取消后新会话不得继承旧随机/滤波/音素状态。

PCM 有界不代表总内存有界。输入文本、code points、clause、音素及 WavePlan 均需单独设定容量和超限策略；禁止静默截断。容量依据真机测试确定。

## 产品门槛

当前资源 0.5–3 MB、RAM 2–5 MB 仅为待验证目标，不是结果。连续播放至少需要长期生成速度快于消费速度；单一平均 RTF < 1 不保证无欠载。

真机基准必须记录：固件、构建号、数据规模、冷/热初始化、首音延迟、持续合成 RTF、最大分片阻塞、队列水位、欠载、取消延迟、可测的峰值内存、重复运行增长。具体产品通过阈值在代表性 DSP 切片后确认；没有阈值与证据时不能宣称实时可用。

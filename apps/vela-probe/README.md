# jSpeak 设备探针 0.4.1

目标：Redmi Watch 5，432×514，`designWidth:432`，API1200。此版包含固定上游的真实数据候选集及 Oracle 英文 WAV，**尚未包含 JavaScript TTS 合成器**。Node 测试与 RPK 构建通过均不代表真机数据装载或播放通过。

页面必须显示 `READY 0.4.1 B<yyMMdd>T<HHmmss>`；回报结果同时抄下构建戳。包名 `org.jspeak.probe`，versionCode 6。旧版 C1–C6 copy/access 判别已移出页面，历史结果保留在 `docs/device-results/`；能力检查、设备信息和 32 片计算保留。计算 hash 仍为 `437906867`，不是 TTS RTF。

## 构建与身份

```sh
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build
```

真实数据由根级数据打包工具生成 `src/data-assets.js` 和 `src/common/espeak/`，不手工编辑；构建必须使用完整生成物，不能以假数据替代。产物路径：`apps/vela-probe/dist/org.jspeak.probe.debug.0.4.1.rpk`。根级 `npm test` 的探针测试注入独立的小型 fixture，不要求本机先构建 C Oracle。

构建戳由 `tools/generate-assets.mjs` 生成；每次交付需记录 RPK SHA256 与对应构建戳。开发签名和时间元数据使 RPK 整包哈希不承诺重复构建一致；数据 payload 与 manifest 另有可复现校验。安装由用户在自己的设备上完成。

本次修正：所有 WAV 写入参数均使用起点为 0、底层长度等于有效长度的 Uint8Array；D1 计量按模式单独保留。固定数据和 Oracle WAV 不变。旧版 0.4.0 的设备结果见[本轮真机记录](../../docs/device-results/2026-10-05-probe-0.4.0.md)。本版构建身份与本地验收见[0.4.1 构建记录](../../docs/build-results/2026-10-05-probe-0.4.1.md)。

本次交付构建戳 **B261005T075402**，RPK **893379 字节**，SHA256 **`22353261d791b03eaf34283b03a1757cb77cc162c742842b57fe1ab1d2446604`**。

RPK 内含上游许可文本；对应源码副本通过 `npm run probe:source` 生成，索引位于 `artifacts/probe-0.4.1-sources/manifest.json`。其中记录实际未提交源码身份，不把当前 HEAD 当成已包含全部改动。

## D1 数据实验

候选集目前是 `en_dict`、`phondata`、`phonindex`、`phontab`、`intonations` 与 `lang/gmw/en-US` 六项，总计 898009 字节。manifest 标记 `closureComplete:false`，因此驻留成功不能证明英文 profile 的全部间接依赖已经闭合。页面显示上游 commit 和数据 fingerprint 前缀，完整身份和各文件 SHA256 见生成 manifest。

| 按钮 | 实际操作 | 记录重点 |
|---|---|---|
| 4 两大文件全读 | 分别读取 en_dict 182152 字节、phondata 600104 字节，逐文件长度与 hash32 校验 | 两行结果、每行 I/O/hash/total |
| 5 分页/边界/EOF | 32768 字节顺序分页，每页校验；再测跨页、高于 256KiB 的偏移、末尾窗口、精确 EOF | 页数/字节数；所有边界行；原始错误 |
| 6 候选集全读驻留 | 六项逐个全读并校验，保持此前文件的字节缓冲同时存活，完成后释放引用 | verifiedResident、livePeak、总耗时 |
| 7 分块组装驻留 | 六项通过校验的页组装为完整缓冲，再核对整文件 hash，候选集同时驻留后释放 | 页读取与组装耗时；相对全读的差异 |

正常范围读取先校验 manifest 边界，越界不会进入系统调用。精确 EOF 另发 `position:byteLength,length:1` 诊断请求：空返回显示 `PASS empty`；系统报错显示 `OBSERVED <原始code/message>`，不把 EOF 错误当成完整读取成功；非空返回为 FAIL。manifest 的零长度 EOF 描述只用于边界检查，不把 `length:0` 的平台默认语义当成证据。

每个文件或窗口失败单独记录；后续独立文件继续。单个系统调用 15 秒未返回则终止该节，并保持在途状态；必须等真实回调返回才能重新运行。页面整节另有 180 秒软超时。失败数据不会交给合成核心；此版没有合成核心消费者。

所有 hash32 使用 `probe.hashBytes`，初值 **0**，每字节 XOR 后执行 xorshift32，按 JS 有符号 32 位溢出；每次最多处理 4096 字节，再通过 10ms 定时器让出事件循环。它是诊断校验，**不是 SHA256**。每页及窗口期望值在 manifest 中预生成，host/RPK 的完整性用 SHA256 独立验证。

`D1 whole/scan/resident/assemble 计量` 分别保留，`D1 本轮` 同时显示模式；0.4.0 共用计量行，不可按它在页面上的位置归属模式。字段：

- `io`：发出系统调用至回调的累计墙钟耗时，包含系统调度；与 hash 分开。
- `hash`：同步 hash 分片累计耗时；不包含片间等待。
- `assemble`：组装缓冲分配和页复制的同步耗时。
- `total`：整节墙钟时间，包含调度等待；这是数据诊断初始化成本，不是 TTS 初始化成本。
- `maxHashCopy`：被计时 hash、组装分配/复制片段的最大耗时；**不是整段 JS 或整页阻塞的上限**；被计时段内发生的 GC/抢占会计入墙钟，段外的系统 API、UI 和等待未覆盖。保留按钮 3 的 maxSlice 调查历史 77ms 异常。
- `livePeak`：探针可见字节缓冲的 backing-store 长度累计峰值；只统计读入、组装及显式保留缓冲，不是进程 heap，不包含原生 I/O 的副本与 JS/manifest/UI 对象。`heap不可测` 必须原样记录。

候选总量硬上限 2MiB；这是本诊断保护值，不是已验证设备容量。没有 OOM 自动探测，不会为了寻找极限不断增大数据。

## A1 音频实验

按钮 8–11 **分别手动启动**；每次先通过 `.txt` 资源路径读取 Oracle WAV，校验 canonical 44 字节头、PCM16/单声道/22050Hz、采样数及 hash32。当前资产是约 1.05 秒的 `Hello world` 英文语音（46424 字节 / 23190 个样本），最终以 manifest 为准。

| 按钮 | 路线 | 成功含义 |
|---|---|---|
| 8 包内 22050Hz 语音 | `.txt` 字节校验后播放打包的同字节 `.wav` URI | 观察包内路径播放事件与实际听感 |
| 9 append / 头回填 | 写 44 字节占位头 → 每片最多 16384 字节 append PCM → position 0 回填最终头 → 全量读回逐字节比较 → 播放 | append 和头覆盖共同可用 |
| 10 position / 头回填 | 写占位头 → 非零 position、append false 写 PCM 块 → position 0 回填头 → 完整比较 → 播放 | 非零位置写与头覆盖共同可用 |
| 11 有界短句整写 | 完整短句 WAV 一次写入 → 完整比较 → 播放 | 有上限的短句缓冲后备路线 |


0.4.0 的 append/position 长度失败与把完整底层 46424 字节写出相符。本版每次进入写接口前，必要时将视图复制到精确长度缓冲，包含 13612 字节末块和 44 字节最终头；前一写回调完成前不会复用该缓冲。`write` 行显示 ACK、len/backing/offset，ACK 仅表示 API 回调，整文件 readback 才判 PASS。`copy/maxCopy` 记录准备写缓冲的累计/最大同步耗时。修正后设备已返回两项46424B全字节一致、onended、清理通过，用户确认“清晰，完整，一致”，见[第六轮记录](../../docs/device-results/2026-10-05-probe-0.4.1.md)。

9/10 不假定覆盖会保留文件尾部。若写头时平台截断文件，完整读回会显示 `FAIL len=44 expected=…`，不会播放。任何字节不符均显示首个错误 offset，并清理本次产物。系统播放 `onplay/onended` 仅记录为 `EVENT`；是否听见清晰英文必须由用户记录，代码不会凭事件自动判定听感。上限为 256KiB WAV，尚未验证长句、连续实时生成或无缝播放。

如 9/10 失败而 11 通过，只能确认有界整写路线。是否需要增加“原始 PCM 临时文件→新 WAV 封装”路线由实际失败证据决定；本版没有实现双文件封装。

## 取消、清理与复测

每个 A1 写入目标为唯一名称 `internal://files/jspeak-probe-041-<timestamp>-<sequence>.wav`，创建前 `file.get` 必须确认不存在（301）。拒绝覆盖已有目标；只清理本次尝试写入的文件。不使用 `file.copy`，不读取个人文件。

停止、页面隐藏或销毁都会停止音频并取消 JS 分片。系统文件 I/O 不能真正取消；若写入或读回仍在途，必须等真实回调再删除，期间新测试显示 `BUSY`。超时也不能假定原生操作已经结束。错误回调重复或迟到不允许重新启动后续步骤。

删除同样有 15 秒软超时。删除失败/超时显示 `leftover:` URI；永不回调的原生操作可能需要退出重开应用，此时可能残留专有临时文件。探针不会扫描并批量删除历史文件。所有 watchdog 依赖 JS 事件循环，不能视为硬实时保证。

本次最小复测：确认 0.4.1 构建戳后，只运行按钮 **9、10**，每项回传 write/readback/播放/清理和听感；若成功，两次都应读回 46424 字节完全相等。无需重抄已核对的 0.4.0 D1/8/11 全部日志。按钮 7 的性能复测可另轮进行。

完整探针步骤（需要时）：

1. 拍下页面 `READY 0.4.1 <stamp>`，记录系统设置中的固件版本。
2. 先运行 1、2、3；按钮 3 可重复三次，记录 maxSlice、firstWait 和后续等待分位数。
3. 重开应用后运行 4，标记为“启动后首次”；再次运行 4 标记为“同会话重复”。首次不保证系统文件缓存冷，必须保留此区别。
4. 手动运行 5、6、7，逐行抄录。运行 6/7 期间只测当前固定候选集，不做容量扩张。
5. 分别运行 8、9、10、11，记录 source/readback/播放/清理行和听感；失败保留完整 code/message。
6. 在 D1 分片、A1 写入/读回阶段分别尝试停止；再手动重启，记录 BUSY 是否在原生回调后解除。另测前后台切换。重复成功路径一次，确认未持续残留文件或 BUSY。

## 反馈模板

```text
READY 0.4.1 <stamp>：
RPK SHA256（交付记录）：
设备 / 固件：
能力与 3 次计算 maxSlice / firstWait：
D1 whole 首次 / 同会话重复（逐文件 io/hash/total）：
D1 scan（逐文件页数/字节数；跨页/高偏移/末尾/EOF）：
D1 resident（verifiedResident + 全部计量）：
D1 assemble（verifiedResident + 全部计量）：
A1 packaged（source / 播放事件 / 听感）：
A1 append（write / readback / 播放 / 清理 / 听感）：
A1 position（write / readback / 播放 / 清理 / 听感）：
A1 buffered（write / readback / 播放 / 清理 / 听感）：
取消 / 重启 / 前后台 / 第二次运行：
失败原始 code/message 与 leftover URI：
```

## 官方 API 与本地验证范围

2026-10-05 核对官方 Vela JS 文件 API：<https://iot.mi.com/vela/quickapp/zh/features/data/file.html>。

`readArrayBuffer` 的 `position` 默认起点、缺省 `length` 读至 EOF，回调 `buffer` 是 Uint8Array；`writeArrayBuffer.buffer` 必须是 Uint8Array，`position` 默认 0，`append:true` 忽略 position。文档没有明确“覆盖时保留尾部”的语义，因此本版用实际完整读回来判断。另兼容读取返回 ArrayBuffer，写入始终传 Uint8Array。

Node mock 覆盖正常/截断式写入、整底层缓冲写入、忽略读取偏移/长度、损坏数据、预存文件拒绝、缺失 API、在途取消、超时、迟到/重复回调和清理。它验证探针逻辑，不能替代设备文件系统行为、渲染和听感验证。旧版探针结论见 [0.3.1 记录](../../docs/device-results/2026-10-05-probe-0.3.1.md)。

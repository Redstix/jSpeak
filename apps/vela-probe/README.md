# jSpeak 设备探针 0.3.1

目标：Redmi Watch 5，432×514，`designWidth: 432`。本版不是 TTS，不含 eSpeak 数据或合成器。

0.3.0 真机结果（见 [第三轮记录](../../docs/device-results/2026-10-04-probe-0.3.0.md)）：B1/B2 包内 `.txt` 直读 PASS 且 hash `975296040` 跨端一致；B6 大写 `/Common/probe.bin` 仍 `202` → "invalid file type" 是**基于文件名类型的校验**，不是资源路径整体拒绝；B3 access(.bin) FAIL `InternalError: invalid parameter :path`；B4 copy(.bin 源) FAIL `copy JS InternalError: invalid parameter`（含构建身份歧义）；B7 internal position/length 部分读 PASS（64KiB 全链 1807ms）。

0.3.1 的目标：判定数据装载出口的最后一轮（C1–C6），并用**构建戳**机制永久消除"装了哪个构建"的歧义。构建成功不代表设备问题已修复。

## 构建戳

`tools/generate-assets.mjs` 每次生成 `src/build-stamp.js`（UTC 时间戳，格式 `B<yyMMdd>T<HHmmss>`，14 字符，不入库）。页面版本头显示 `READY 0.3.1 <stamp>`——回报结果时**必须抄下 stamp**，与下表 SHA256 对照，证明装的是哪个构建。

| stamp（页面版本头） | RPK SHA256 |
|---|---|
| B261005T013207 | d93fe1c6826f9eeccc81b9f5c9a3a74909318e0a7aa90805e30f8d6720e550f7 |

构建后把新行填入上表（`sha256sum apps/vela-probe/dist/org.jspeak.probe.debug.0.3.1.rpk`）。0.3.0 交付 RPK SHA256 `da260c6d…`（见第三轮记录）无页面标识，是构建身份歧义的来源；0.3.1 起每行构建都绑定 stamp。

## 本机构建

```sh
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build
```

`npm run probe:build` 先跑 generate-assets（新 stamp）再构建。`npm test` 通过根 pretest 按需生成资产与 stamp，clone 后直接跑不因缺生成物而挂。产物：`apps/vela-probe/dist/org.jspeak.probe.debug.0.3.1.rpk`。包名保持 `org.jspeak.probe`，versionCode 4。

使用 aiot-toolkit 开发签名。由用户自行安装到自己的设备；不提供设备密钥提取。重建包含时间及签名元数据，RPK 整包哈希不承诺重复构建相同；以每次交付的 SHA256 + stamp 为准。

## 本轮核心：装载判别（6 行）

点 **4 装载判别** 依次运行 C1–C6；每行显示 PASS/FAIL 与耗时，单行 3 秒超时（C2 读 256KiB 给足 5 秒），整节 35 秒兜底 watchdog。每行回答的问题：

| 行 | 操作 | 回答的问题 |
|---|---|---|
| C1 bin.txt直读 | `readArrayBuffer({uri:'/common/bin.txt'})`，64KiB **二进制内容**（与 probe.bin 逐字节相同） | 0.3.0 的 `.txt` PASS 是真 ASCII 还是只看扩展名——内容嗅探 vs 扩展名校验。预期 `PASS len=65536 hash=259309834` |
| C2 big.txt直读 | `readArrayBuffer({uri:'/common/big.txt'})`，256KiB 二进制（固定 seed xorshift） | "文本扩展名直读"出口的尺度：数百 KB 单文件直读可行性与耗时。预期 `PASS len=262144 hash=534463728` |
| C3 包内部分读 | `readArrayBuffer({uri:'/common/bin.txt', position:1024, length:2048})` | 包内资源路径是否支持 position/length 随机访问（决定可否不整读驻留）。预期 `PASS hash=1037292089`；len 为 65536 说明设备忽略了参数 |
| C4 copy .txt源 | `copy({srcUri:'/common/bin.txt', dstUri:'internal://files/jspeak-probe-031-<ts>-1-c1.bin'})` → 读回校验 → 删除 | copy 出口（.txt 被接受类型的源）：0.3.0 的 copy 失败可能只是源类型被拒，.txt 源可能可行。子行 copy/读回/清理 |
| C5 copy .bin源 | 同 C4，源 `/common/probe.bin`，dst `…-2-c2.bin` | B4 复测：构建戳 + 修复后 dstUri 参数名，**错误文本本身即价值**——若仍 `invalid parameter` 则为设备原生层对资源 srcUri 的真实拒绝 |
| C6 access .txt | `access({uri:'/common/bin.txt'})` | access 对被接受类型（.txt）的包内路径行为（0.3.0 只测了 .bin 的 `invalid parameter :path`） |

C4/C5 使用与 0.3.0 相同的 copyFile 机制与修复后的 `dstUri` 参数名；copy 前先 `file.get` 确认目标不存在；成功后读回校验（预期 hash `259309834`）再删除；C4 与 C5 相互独立，C4 失败不影响 C5。

校验用 hash 常量（Node 对真实文件本地计算，与设备端同一 `hashBytes` 函数）：

- `PROBE_BIN_HASH = 259309834` — `probe.bin`/`bin.txt` 全量 65536 字节。
- `BIG_TXT_HASH = 534463728` — `big.txt` 全量 262144 字节。
- `SLICE_HASH = 1037292089` — pattern 的 bytes[1024..3072]。
- `TEST_TXT_TEXT_HASH = 975296040`（0.3.0 已跨端一致）。

## 保留的其他测试

1. **能力检查**：TypedArray/DataView/Math.imul/32-bit shift 四行，仍应全 PASS。
2. **设备信息**：`model / osVersionName / API` 仅视为 API 返回值，请从系统设置补充固件号（若方便）。
3. **分片计算**：连续手动运行 3 次，32 片 × 2048 运算，预期 hash `437906867`。记录 total、分片 sum/max、firstWait 及后续等待 p50/p95/max；**均不是 TTS RTF**。

0.3.0 的文件API判别 B1–B7 与 0.2.0 的包内资源对照（.bin/.dat/.wav）已移除——其问题已由 0.2.0 + B6 回答（readArrayBuffer 对 .bin/.dat/.wav 类型校验拒绝，.txt 通过）。资产文件 probe.bin/probe.dat/tone.wav/test.txt 保留在包内不动。`src/tone.js` 保留在仓库中不参与页面。

## 安全边界与取消

- 不自动探测 OOM，不长时间循环施压，不读取个人文件。
- C4/C5 产物均为专有唯一临时文件名（`jspeak-probe-031-<时间戳>-<序号>…`）；copy 前先 `file.get` 确认目标不存在，拒绝覆盖。只删除本次尝试创建的文件。
- C4/C5 流程：copy → 全量读回 hash 校验 → 删除。copy/读回 I/O 不能通过 JS 定时器真正中断；取消后等待在途回调再清理；待回调期间发起新测试会显示 BUSY。读回失败（含 hash 不符）仍会删除产物。
- 每行 3 秒（C2 5 秒）单行超时，整节 35 秒兜底 watchdog；若系统事件循环被阻塞，定时器自身也会延后，不是硬实时 watchdog。
- 若操作永远没有回调，需要退出应用后重试；可能残留专有临时文件。删除失败会显示 leftover URI（copy 失败后的清理尝试若报 `301`，通常表示产物文件从未创建）。

## 结果解释

- `PASS`：对应语义核验成功；不代表全链路通过。
- `FAIL <code> <message>`：该 API 调用失败，保留原始错误文本（如 `202 invalid file type`、`InternalError: invalid parameter`）。
- `FAIL copy JS <error>`：file.copy **同步抛出**的原生错误（经 JS 包装，code=JS）——与回调式失败（`FAIL copy 202 …`）区分，这正是 0.3.0 B4 歧义的教训。
- `FAIL verify len=… hash=…`：读取成功但长度/hash 与常量不符（观测值一并显示便于诊断）。
- `FAIL hash 不符 len=…`（C4/C5 读回）：复制产物内容与源不一致。
- `FAIL Error: UNSUPPORTED <member>`：设备上不存在该 API 成员，按失败记录不中断后续行。
- `BUSY`：上次文件 I/O 或清理尚未返回；稍后重试。
- `CANCELLED`：主动停止或被下一测试替换。

## 截图建议

1. 页面顶部版本头 `READY 0.3.1 <stamp>`（证明版本与构建身份，**必须可读**）。
2. **装载判别** 整节：C1–C6 全部 6 行 + `C4 copy/读回/清理` + `C5 copy/读回/清理` + `会话 DONE`。单屏放不下时分两屏截，确保 C4/C5/C6 可见。
3. 若 C4/C5 通过：截图 copy 产物 URI 行与读回 hash 行（copy 出口成立的直接证据）。
4. 若 C4/C5 失败：截图完整错误文本（此行价值就在错误本身）。
5. 重复点 4 装载判别 第二次的结果（确认无残留 BUSY、临时文件可重复创建删除）。

## 反馈模板

```text
版本（页面版本头 READY 0.3.1 <stamp>，请抄下 stamp）：
设备固件（系统设置）：
C1 bin.txt直读（hash）：
C2 big.txt直读（hash + 耗时）：
C3 包内部分读（hash，len 是否为 2048）：
C4 copy .txt源（copy/读回/清理，错误原样）：
C5 copy .bin源（copy/读回/清理，错误原样）：
C6 access .txt：
重复运行第二次结果：
```

照片可继续放 `user_result/`，该目录仅本地保留、不提交 Git；结果摘要写入 `docs/device-results/`。

## API 依据

查阅于 2026-10-04（详见 [调研记录](../../docs/research/2026-10-04-vela-file-api-package-resources.md)）：

- https://iot.mi.com/vela/quickapp/zh/features/data/file.html — `readText`/`readArrayBuffer` uri "支持应用资源路径"（错误码 202/300/301）；`copy` srcUri 无限制、dstUri 不能是资源路径；`access` 无资源路径限制条款；缺失文件错误 301。
- 0.3.0 真机实测（[第三轮记录](../../docs/device-results/2026-10-04-probe-0.3.0.md)）——`.txt` 可读、`.bin/.dat/.wav` 类型校验拒绝、access/copy 错误形态、B7 position/length PASS。
- https://iot.mi.com/vela/quickapp/zh/guide/framework/project-structure.html — URI 模型；官方示例用大写 `/Common/`。
- 项目自带 `vela-rpk-dev/SKILL.md` — CLI 流程、设备尺寸、UX 基本组件。

Node mock 测试只验证本地逻辑与常量，不能替代 Vela 渲染、系统 API 或文件系统行为验证。

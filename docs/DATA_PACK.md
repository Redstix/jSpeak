# D1 数据包与 A1 参考音频

本工具把固定、未插桩的 C 构建产物按原始字节打包为设备探针资源。它尚未实现 JS 字典 reader，也没有通过真机装载或播放验收。`scope: en-us-candidate-probe`、`closureComplete: false` 是刻意保留的限制：该候选集用于 D1 的真实容量测试，不能作为完整英文产品数据包直接交付。

## 生成与校验

```sh
npm run oracle:build
node tools/build-data/build.mjs
node tools/build-data/verify.mjs
node --test tests/data-pack.test.mjs
```

生成器必须显式运行；导入模块不会启动 C、写文件或生成数据。普通单元测试使用 fixture，不依赖 C 构建。默认输出：

- `apps/vela-probe/src/common/espeak/`：6 个原始数据文件的 `.txt` 映射、两份相同 WAV、`manifest.json`、`provenance.json`、`candidate-comparison.json`。
- `apps/vela-probe/src/data-assets.js`：`export var DATA_ASSETS`，仅含 ES5 兼容的 JSON 数据。页面无需解析大份来源清单。

`verify.mjs` 可接收 RPK 解包后的 `common/espeak` 目录路径，再次核验实际封装字节。它核对外部 manifest、已审阅 source lock、完整来源指纹、PCM 格式、音频重复文件及页/窗口校验。它不负责解析 RPK、证明签名或核实设备已经运行该包。

生成器拒绝脏上游、错误 commit、变化的构建参数/可执行文件/CMake cache、变化的数据快照、缺文件、符号链接、重复映射和输出目录中的意外旧文件。输出确定性以同一构建快照为条件；构建指纹含机器相关的可执行文件和 CMake cache，数据指纹单独计算。`source-lock.json` 记录已审阅的原始数据身份，不能为绕过失败自动更新。

## 当前候选集

固定上游：`ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。6 个数据文件总计 **898009 字节**，包括 257 字节的 en-US voice 元数据。文件长度不是运行时峰值内存。

| 原始路径 | 包内路径 | 字节数 | 保留原因 |
|---|---|---:|---|
| `en_dict` | `en_dict.txt` | 182152 | en translator 字典 |
| `intonations` | `intonations.txt` | 2584 | 完整共享声调资源 |
| `lang/gmw/en-US` | `lang__gmw__en-US.txt` | 257 | 固定 voice 元数据 |
| `phondata` | `phondata.txt` | 600104 | 完整共享波形及相关资源 |
| `phonindex` | `phonindex.txt` | 48856 | 完整音素指令索引 |
| `phontab` | `phontab.txt` | 64056 | 全部音素表和继承关系 |

候选数据指纹：`4a2f7ca4bc939c8bb4ca2ce101b6f661ecd213622fec6cfa7327322feb2fd645`。每文件 SHA256 与全部 383 个来源文件身份记录在 lock/provenance 中。仅改扩展名和映射，不追加二进制头、不转码、不裁剪共享文件。

`manifest.json` 包含 magic `JSPEAK_RAW_DATA`、schema 版本 1、上游 commit、构建指纹、完整来源数据指纹、候选数据指纹、profile、长度、SHA256、包内 URI、页及窗口。数据指纹是按 `sourcePath` 排序的 `{sourcePath, byteLength, sha256}` 数组经紧凑 JSON 序列化后的 SHA256。源二进制版本保留：`phondata` 前 4 字节 little-endian 为 `0x014801`，随后 4 字节采样率为 22050。

## 依赖证据及未完成项

静态核查入口均位于固定上游：

- `src/libespeak-ng/voices.c:LoadVoice`：首个 `language en-us` 截取 `en`，选择 en translator 和 `en_dict`；`phonemes en-us` 另选音素表，voice 文件的 `dictrules`、stress、replace 等原样保留。
- `phsource/phonemes`：`en-us` 继承 `en`，继承 `base1`，继承 `base`。没有 flatten 或按文件名猜测可删除的共享资源。
- `src/libespeak-ng/synthdata.c:LoadPhData`：读取完整 phontab、phonindex、phondata 和 intonations，并核对版本。
- `src/libespeak-ng/dictionary.c:LoadDictionary`：拼接字典路径并驻留字节，D1 分块读取不等同于异步分页字典实现。
- `src/libespeak-ng/translate.c:SetAlternateTranslator`、`translateword.c` 字符读法：纯文本 en-us 也可能选择其他 translator 并加载其他字典。
- `src/libespeak-ng/langopts.c:LoadConfig`：可选 config 能定义 tone/soundicon；本固定构建没有该文件，来源清单记录缺席，不能从全局系统目录引入配置。

生成时在临时目录恢复 6 个原名，使用显式 `--path` 启动同一固定 C 程序，与完整数据目录比较音素字符串及 WAV。原有 22 条 smoke 语料全部一致且无诊断是生成器的硬条件。另加 8 条文字系统样本，保留全部原始输出、SHA256 和规范化路径后的 stderr。

本轮 **30 条中 26 条一致**。亚美尼亚文、韩文、阿拉伯文和印地文发生差异，分别暴露缺失的 `hy_dict`、`ko_dict`、`ar_dict`、`hi_dict`。这证实候选集不完整，而非宣布这些输入不属于目标。其他尚未触发的字典依赖仍未排除。`provenance.json` 保留完整 383 文件清单、保留项和逐文件排除原因；其余字典标为动态依赖未解决，仅在有界设备探针中暂不装载。生产数据闭包必须继续补齐静态与动态证据，并增加差分回归。未确认缺失资源时不得进入产品核心或静默退化。

## 设备校验契约

`files` 中每项包含 `{id, sourcePath, packagePath, uri, byteLength, sha256, hash32, pages, windows}`。URI 为 `/common/espeak/<packagePath>`。`pages` 顺序连续，块大小 **32768 字节**，末页按实际剩余长度；`windows` 覆盖开头、跨页、高于 256KiB 的偏移、文件末尾和精确 EOF。较短文件不生成不存在的高偏移窗口。

每段校验从 seed 0 重置；对每个无符号字节执行：

```js
state ^= byte;
state ^= state << 13;
state ^= state >>> 17;
state ^= state << 5;
```

结果是带符号 int32，与现有 `probe.js:hashBytes` 完全相同。它仅用于设备诊断，**不是 SHA256**。每文件 SHA256 在桌面生成和 RPK 解包核验时使用。校验算法及初值同时写入 manifest。

合法区间要求非负安全整数，`position <= byteLength` 且 `length <= byteLength - position`；精确 EOF 描述为 `{position: byteLength, length: 0, hash32: 0}`。设备额外发起 EOF 处长度 1 的探索读时，必须记录实际短读或错误，不能将其描述成满足完整读取契约。负数、非整数及越界在适配层先拒绝。

## A1 参考音频

固定文本 `Hello world`，固定 profile `en-us / 175 / 50 / 100 / UTF-8 / -D`。生成器以两个独立 C 进程生成 WAV，检查整文件相同，并用严格 PCM reader 验证：

- PCM16，单声道，**22050Hz**，23190 个样本。
- WAV 共 **46424 字节**，44 字节标准头。
- SHA256：`a10febc9b504c155d06f1656007536eb9ca85295c75d42fa0ddfedf15be97396`。
- 设备诊断 hash32：`1657481278`。

`oracle.wav` 供包内路径播放能力探测；`oracle-wave.txt` 是同一文件的原样副本，供已证明可读的扩展名路径获取字节，随后写入 internal WAV 再播放。导出的 `audio` 同时包含 `uri`、`dataUri`、长度/hash、采样率、样本数、`headerLength:44` 和 `dataOffset:44`。不依赖设备能从 `.wav` 路径读二进制。

0.4.0设备OCR已核对，用户亦确认两次播放相同、较清晰：该候选的全读/分页/偏移/EOF/整读与组装驻留，以及22050Hz包内和完整WAV播放已通过。详见[设备记录](device-results/2026-10-05-probe-0.4.0.md)。这不证明完整依赖闭包、reader初始化、heap/容量上限或实时性能；0.4.1修正视图缓冲后的append/position与头回填已全字节读回、播放、清理和听感通过，见[第六轮](device-results/2026-10-05-probe-0.4.1.md)。

许可及对应源码交付见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。本工具没有修改上游源码或 `build/oracle`。

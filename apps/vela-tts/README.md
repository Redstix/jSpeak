# jSpeak Vela TTS 测试 0.5.1 profiles

本轮在 `perf/quickjs-vela-optimization` 上针对 0.5.0 启动闪退做 M14 启动资源优化，并交付 A/B/C 三档 RPK。A 档保留固定英文 `Hello world.` 的 JS 数据装载、文本合成、有界 PCM、WAV 写入/读回和播放路径；B/C 档是围绕启动崩溃隔离的预计算播放档，直接播放由 A 档同一 JS 输出降采样得到的 WAV，不再在设备上运行合成器。

## 构建

```sh
npm run data:build
npm run data:verify
npm ci --prefix apps/vela-tts
npm run tts:profiles
```

`tts:profiles` 会生成同一构建戳下的三个 RPK，执行 manifest、页面、资产、版本与 SHA256 校验，并把完整身份写入 `apps/vela-tts/dist/profiles.json`。

## 交付身份

| 档位 | RPK | 字节 | SHA256 | versionName / Code | 构建戳 |
|---|---|---:|---|---|---|
| A | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.1-a.rpk` | 630242 | `3eb4f87de58685eda4080f7bf802531f5bdd5118768b71b83d7807970c2977b0` | `0.5.1-a` / 8 | `B261011T112426` |
| B | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.1-b.rpk` | 44621 | `24f8cc0ba2867115a3b25d187a6db131fe04c04cb4d352a46fa5368661cf7b0e` | `0.5.1-b` / 9 | `B261011T112426` |
| C | `/home/rd/dev/jSpeak/apps/vela-tts/dist/org.jspeak.tts.debug.0.5.1-c.rpk` | 37810 | `a06f0cc7a14da0b8f9a967c4b5ab383c2ed82333af0302fc1d7b807dd2a32a37` | `0.5.1-c` / 10 | `B261011T112426` |

构建代码 commit：`b5c40a557cfe66152d5b934cb55838c86f6003f7`。完整解包字节分别为 A 1316326B、B 84334B、C 72940B。

## 启动资源

- 0.5.0 交付包实测启动需解析 1731654B JS；源码审计证明 `onInit` 不调用 `readArrayBuffer`，启动 I/O 为 0B。898009B 候选数据只在首次点击合成时整读。因此“启动期整包读数据”不是 0.5.0 启动闪退的已证根因；1.73MB 页面 JS 解析是当前最强证据指向。
- A 档 production minify 后启动解析 361297B（0.5.0 的 20.87%），启动 I/O 仍为 0B，首次点击仍读 898009B。
- B/C 档启动解析分别为 4695B / 4697B（A 的 1.299% / 1.300%），JS 文件读取为 0B。两档的预计算 WAV 分别为 22854B / 11450B，是 A 档 45662B 输出的 50.05% / 25.08%。
- B/C 档解析量低于用户要求的 1/2、1/4 上限；这不是设备峰值测量，Vela heap、固件和 JS 引擎身份仍未核实。

## 静态边界

- A 档保持 PCM16 / mono / 22050Hz，未改变 M08–M11 合成算法；`npm test` 278/278 通过，`npm run data:verify` 通过。
- A 档现有 JS 输出仍是 22809 样本 / SHA256 `fc94cec17a566cdc2fe06be15b0df4b227406c05646b0343f0b5f6e1008ea6d1`；它仍未对齐 C Oracle 的 23190 样本，首个差异仍在样本 1384。
- B 档为 11025Hz/16bit，C 档为 5512Hz/16bit；只做 2:1 / 4:1 分组平均抗混叠降采样，不改量化位宽。
- B/C 档是预计算播放档，不是完整文本 TTS 运行时；它们用于隔离启动资源和验证低采样率可播放性。

## 验收

1. 先安装 0.5.0 旧包复现启动闪退/重启，再卸载。
2. 依次安装 A、B、C；每次打开只核对页头 `READY 0.5.1-X B261011T112426`，不要先点击。
3. A 点 **合成 / 播放**，记录六个数据 PASS、合成、写入、读回、播放、清理、听感、第二次运行和前后台。
4. B/C 点 **播放**，记录 onplay/onended、是否听到英文、清晰度/失真/截断，以及第二次运行。
5. 真机若仍闪退，按 A→B→C 的差异回报；这能区分“约 360KB JS 解析仍超限”与“页面/平台其他问题”。

# jSpeak Vela TTS 0.6.0 A-only（en + cmn）

当前产品入口只构建 A 档完整 JS 合成，同时提供英文与普通话语料包；不再提供 B/C 预生成 WAV 或降采样播放档。B/C 的 0.5.x 记录仅保留为历史证据，用户已于 2026-10-17 取消该路线。

## 构建与验收

```sh
npm run tts:build
```

产物（均不打包预生成音频）：

- `apps/vela-tts/dist/org.jspeak.tts.debug.0.6.0-en.rpk`
- `apps/vela-tts/dist/org.jspeak.tts.debug.0.6.0-cmn.rpk`
- `apps/vela-tts/dist/profiles.json`

`npm run tts:build -- --reuse-stamp --reuse-existing-rpk` 可在同一构建戳下只重建缺失语言包；默认命令会重建两者。构建器逐例校验固定参考 PCM：en `Hello world.` 为 23,190 样本，cmn `你好，世界。` 为 32,822 样本；两者分别等于对应 C Oracle。

| 项 | 0.6.0-en | 0.6.0-cmn |
|---|---|---|
| versionName / Code | `0.6.0-en` / 17 | `0.6.0-cmn` / 18 |
| RPK 字节 / 解包字节 | 635685B / 1338207B | 1066129B / 2736927B |
| SHA256 | `635a6c1465d7746b07cedf6a49473e17d50fabe76ac33056154238e6ec3ae8d2` | `918fe6ac0b3b9a3c02eebf0ed5321b491c64be3122164964497113e31f5f4822` |
| 构建戳 / metadata | `B261017T125827` / `2026-10-17T13:42:10.056Z` | `B261017T125827` / `2026-10-17T13:42:32.092Z` |
| 数据文件 / 数据字节 | 6 / 898009B | 6 / 2295161B |
| 启动解析 JS | 383121B | 384675B |
| 首次点击整读 | 898009B | 2295161B |

设备页头在运行时由 `DATA_ASSETS` 组成，显示为 `READY <versionName> A <buildStamp>`；安装后先仅打开核对页头，确认不闪退后测试。

## 设备页测试区

A 档页面固定提供：

- `合成 / 播放`：固定 `Hello world.` / `你好，世界。`，写入、读回、播放。
- `连续 10 次`、`连续 20 次`：同一会话重复合成，不播放；显示次数、elapsed min/median/max、样本数、音频时长、RTF(avg)。
- `长文本`：将固定短语扩到约 2K 字符，仅合成不播放。
- `停止 / 清理`：停止播放与合成并删除本次生成的 WAV。

RTF 定义为 `合成耗时 / 音频时长`（平均耗时口径）。设备 CPU、heap、QuickJS 版本和连续峰值不可测/未知；页面只报告可观察的墙钟与合成结果，不外推设备 CPU。

## 验收边界

- Node：`node --test tests/*.test.mjs` 279/279；en full wavegen 67/67 exact；cmn 差分 29 exact + 1 设计性 unsupported（`[[en-us]]` 动态英文词典）。
- 设备：`0.6.0-en` 与 `0.6.0-cmn` 均**待用户真机验收**。历史 0.5.3-A 的英文听感不能推广到新包，也不能代表中文。
- 构建记录与真机回报模板见 `../../docs/build-results/2026-10-17-tts-0.6.0-cmn.md` 与 `../../docs/device-results/2026-10-17-tts-0.6.0-en-cmn.md`。

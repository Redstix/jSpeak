# jSpeak Vela TTS 0.6.0 A-only

当前产品入口只构建 A 档完整 JS 合成，不再提供 B/C 预生成 WAV 或降采样播放档。B/C 的 0.5.x 记录仅保留为历史证据，用户已于 2026-10-17 取消该路线。

## 构建与验收

```sh
npm run tts:build
```

产物：`apps/vela-tts/dist/org.jspeak.tts.debug.0.6.0-en.rpk`

| 项 | 值 |
|---|---|
| versionName / Code | `0.6.0-en` / 17 |
| RPK 字节 / 解包字节 | 630034B / 1315832B |
| SHA256 | `dbdb820b137ef4329970411ac83f76cb7a3fdd264639de44d1e54dfb3ba9f2f7` |
| 构建戳 | `B261017T055725` |
| 页头 | `READY 0.6.0-en A B261017T055725` |

安装后先仅打开核对页头；确认不闪退后点击 **合成 / 播放**。回报模板见 `docs/device-results/2026-10-17-tts-0.6.0-a-only.md`。设备 CPU、heap、RTF、固件版本和 QuickJS 版本不可测/未知；真机结果只能由用户确认。

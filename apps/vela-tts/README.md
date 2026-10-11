# jSpeak Vela TTS 测试 0.5.0

目标是在 Redmi Watch 5 上做 M12 最小端到端验证：固定英文 `Hello world.` 经 JS 数据装载、文本合成、有界 PCM 运行时、完整 WAV 写入、读回校验，最后交给 `@system.audio` 播放。页面显示 `READY 0.5.0 <stamp>`。

## 构建

```sh
npm run data:build
npm run data:verify
npm ci --prefix apps/vela-tts
npm run assets --prefix apps/vela-tts
npm run build --prefix apps/vela-tts
```

`data:build` 会生成 `src/common/espeak/` 与 `src/data-assets.js`；两者不入 Git。构建使用 `apps/vela-probe/node_modules` 的同一 toolkit 依赖，不升级依赖。

## 交付身份

| 项 | 值 |
|---|---|
| 包名 / 版本 | `org.jspeak.tts` / 0.5.0, versionCode 7 |
| 可见构建戳 | `B261011T085505` |
| RPK | `dist/org.jspeak.tts.debug.0.5.0.rpk` |
| SHA256 | `c1e4bf4f60e8f9a3827fd603b0c16e3e8011a652eac5b8935eae3e6a87cbf078` |

## 静态边界

- 数据候选集六文件 898009B，`data:verify` 通过；`closureComplete:false` 保持。
- Node 集成测试能生成 canonical PCM16/mono/22050Hz WAV。
- M10/M11 的固定波形与有界运行时测试仍通过；本轮新增的文本→命令集成路径尚未逐点对齐 C Oracle，`Hello world.` 的 JS PCM 为 22809 样本，C 参考为 23190 样本，首个差异在样本 1384。因此不能宣称 M12 PCM exact。
- 文件写入/读回/播放、前后台与听感必须真机验收。

## 验收步骤

1. 安装 RPK 后打开应用，核对页头 `READY 0.5.0 B261011T085505`。
2. 点 **合成 / 播放**，等待依次出现：六个数据 PASS、`合成 PASS`、`写入 PASS`、`读回 PASS all equal`、`EVENT onplay/onended`。
3. 记录是否听到清晰英文 `Hello world`；ENDED 或 onended 不等于听感通过。
4. 点 **停止 / 清理**，确认 `清理 PASS`；前后台切换后再运行一次。
5. 回报完整 `流程`、`合成`、`写入`、`读回`、`播放`、`清理` 与听感；失败时保留原始 code/message。

# Wave Generator 首个 PCM 切片

`src/core/wave-generator.js` 对应原 `wavegen.c:WavegenFill2/PlaySilence/PlayWave` 的固定 en-us pause、marker 与独立 wave sample 子集。输入是 `Generate` 的命令计划，输出 PCM16 mono，不输出 WAV。

## 接口

```js
const generator = createWaveGenerator({ sampleRate: 22050 });
const result = generator.synthesize(commands);
// result.samples 是 Int16Array
```

`fill(commands, output)` 支持有界输出和 resume；`synthesize(commands)` 是便利包装。当前支持：

- `WCMD_PAUSE`：按原 `PlaySilence` 生成样本，保留 5500 项 echo ring、head/tail wrap 和 16 位截断。
- `WCMD_MARKER`：不产生 PCM。
- `WCMD_WAVE`：按原 `PlayWave` 读取 `phondata` 中的 8/16 位采样，保留 consonant/general amplitude 缩放、echo、16 位截断和 bounded resume。

其他命令显式抛出 `WAVE_GENERATOR_UNSUPPORTED`，不静默跳过。

## 验证

```sh
node tools/compare/wave-generator-pause.mjs
node tools/compare/wave-generator-wave.mjs
```

- 两个纯空白整句输入，C WAV 与 JS PCM 完全一致。
- 共 308 个样本，均为原始 pause 输出。
- 报告：`artifacts/wave-generator-pause-YznUH0/report.json`
- 20 条独立 `WCMD_WAVE` 命令，26694 个样本逐点一致。
- PlayWave 报告：`artifacts/wave-generator-wave-z9om1o/report.json`

当前切片不包含 voiced source、formant、spect、WAVE2 混合、非零 echo 或完整英文句子合成。

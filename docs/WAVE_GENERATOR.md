# Wave Generator M10

`src/core/wave-generator.js` 对应固定上游 `wavegen.c` 的 en-us PCM 后端。输入是完整 `Generate` 逻辑命令计划、en-us voice 状态与 `phondata`，输出 PCM16 mono；不输出 WAV。

## 接口

```js
const generator = createWaveGenerator({
  sampleRate: 22050,
  voice,
  phondataBytes,
  randomSeed: 1,
});
const result = generator.synthesize(commands, { chunkSize: 4096 });
```

`fill(commands, output)` 使用调用方提供的有限 PCM chunk 并保留 resume 状态。`synthesize` 是便利包装：固定 4096 样本工作 chunk，最终返回值本身随结果长度增长。波形工作状态为固定大小：5500 项 echo ring、2×400 项谐波谱、30 项低频插值和 9 组 formant/breath 状态。

固定 profile 已支持：

- `WCMD_PAUSE`、`WCMD_MARKER`
- `WCMD_WAVE`、`WCMD_WAVE2`
- `WCMD_SPECT`、`WCMD_SPECT2`
- `WCMD_AMPLITUDE`、`WCMD_PITCH`、`WCMD_EMBEDDED`

命令观察器用 `frameIndex` 引用同一 result 内的 frame 表；JS 端解析 `frameIndex` 与 `frames`，不复制重复 frame。

首发 profile 未使用的命令仍显式抛出 `WAVE_GENERATOR_UNSUPPORTED`：`WCMD_KLATT`、`WCMD_KLATT2`、`WCMD_VOICE`、`WCMD_MBROLA_DATA`、`WCMD_FMT_AMPLITUDE`、`WCMD_SONIC_SPEED`、`WCMD_PHONEME_ALIGNMENT`。不静默回退为简化振荡器。

## 语义边界

- 保留 C 的 32-bit wrap、截断除法、`Math.imul` 乘法、有符号移位、double 插值、Flutter 表、roughness 调制、AGC、glottal reduction、WAVE2 循环 offset 和 deterministic random 状态。
- en-us 当前语料的 echo 与 breath 幅度为零；非零 echo、非零 breath/随机滤波分支已实现但未被本次 exact 语料覆盖，不能据此宣称已验收。
- C 观察器仅为本轮捕获完整逻辑命令把 `N_WCMDQ` 扩为 4096；原 170 项运行时队列的满队 resume 与消费调度仍属 M11。

## 验证

```sh
npm run oracle:generate-commands:build
npm run test:wave-generator:pause
npm run test:wave-generator:wave
npm run test:wave-generator:full
node --test tests/wave-generator.test.mjs
```

- pause/marker：2 case、308 样本 exact。
- PlayWave：22 条命令、29521 样本 exact。
- 完整 profile：67 个非空输入、99 clause、15449 条命令、6344247 样本 exact；1/7/64/1323/4096 样本块拼接均一致。
- 完整报告：`artifacts/wave-generator-full-msu0hu/report.json`

详见 [M10 完整验收](build-results/2026-10-10-m10-wave-full.md)。

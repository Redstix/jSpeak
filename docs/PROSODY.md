# en-us 韵律与时长

`src/core/calc-pitches.js` 和 `src/core/calc-lengths.js` 分别对应原 `intonation.c:CalcPitches` 与 `setlengths.c:CalcLengths` 的固定 en-us 路径。输入是 `MakePhonemeList` 的完整 `PHONEME_LIST` arena，输出仍写回同一 arena。

## 接口

```js
const pitches = createPitchCalculator(selectedTable);
const pitched = pitches.calculate(list, count, clauseType);

const lengths = createLengthCalculator(selectedTable);
const result = lengths.calculate(pitched.list, pitched.count, {
  list: embeddedCommands,
  index: 0
});
```

`clauseType` 是原 `tone_out` 中的 0–4。`embeddedCommands` 来自 ReadClause/tokenizer 的真实 embedded list；当前固定语料没有 `EMBED_S`，若有 speed 命令会显式拒绝，不把它静默当作默认速度。

## 固定数据

`data/prosody/profile.js` 保存 en-US voice 的实际参数：

- `stressAmps = [17,16,19,19,19,19,21,19]`
- `stressLengths = [140,120,190,170,0,0,255,300]`
- `lenSpeeds = [87,80,78]`
- `maxAmpEoc = 19`
- `max_lengthmod = 500`
- `lengthen_tonic = 20`
- `long_stop = 100`
- `stress_flags = 8`
- `word_gap = 0`

`data/prosody/tunes.js` 保存 `intonations` 中 en-US 默认使用的 0–3 号 tune。运行时不解析 `phsource` 或 `intonations` 二进制。

## 原行为

- `CalcPitches` 使用 syllable 表、默认 tune、head/nucleus/tail 梯度和 clause type。
- `CalcLengths` 使用真实 phoneme 表的 `lengthMod`、`stdLength`、`phflags` 和邻居行，不使用平均时长。
- 保留跨子句的进程级 arena 残留；同一 maker 实例必须连续使用。
- `word2-extra-7` 的原始差分曾暴露 C 全局 `embedded_list` 初始化残留。观察器现在显式注入每个子句的真实 embedded list，避免把初始化残留误当成当前子句行为。

## 验证

```sh
node tools/compare/prosody.mjs artifacts/oracle-clause-word2-2pOOA5
```

- 99 个真实 CLI 子句，`CalcPitches` 和 `CalcLengths` 两阶段全部 exact。
- 3430 个完整 `PHONEME_LIST` 行一致。
- 比较 `count`、`phcode`、`stresslevel`、`wordstress`、`tonePh`、`sourceix`、`synthflags`、`length`、`env`、`type`、`prepause`、`amp`、`newword`、`pitch1/2`、`stdLength`、`phontabAddr`、`soundParam`、`tonePhData`。
- 报告：`artifacts/prosody-EBNBA5/report.json`

此结果不包含 `Generate`、DSP 或音频输出。

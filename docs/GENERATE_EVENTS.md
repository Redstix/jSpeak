# Generate 高层合成事件

`src/core/generate-events.js` 对应原 `synthesize.c:Generate` 的固定 en-us 高层事件边界。输入是 `CalcLengths` 后的完整 `PHONEME_LIST`，输出是一组有序 `SoundEvent`，尚未生成最终 PCM。

## 接口

```js
const planner = createGenerateEventPlanner(phonindexBytes, selectedTable);
const events = planner.plan(phonemeList, count, { list: embeddedCommands });
```

事件包含：

- `generate.begin` / `generate.end`
- `phoneme`
- `pause`
- `amplitude`
- `pitch`
- `sample3`
- `spect2`
- `startSyllable`
- `endPitch`
- `marker`
- `embedded`

`spect2` 记录原调用参数：音素 code/type、`which`、modulation、FMT/WAV 地址与幅度、标准时长、transition、二级 FMT、`length_mod` 和 `synthflags`。该边界不展开 frame 队列，也不生成 PCM。

## 原语义

- 使用真实 `InterpretPhoneme` 与共享 `WORD_PH_DATA`；每次 `plan` 对应原 `Generate(resume=false)` 的 worddata 重置。
- 保留 stop、fricative、vstop、vfricative、nasal、liquid 和 vowel 分支的调用顺序。
- 保留 `SFLAG_NEXT_PAUSE` 状态突变、canonical envelope 指针等价、prev 音素 `VWLSTART` 写回 `fmtAddr`，以及 stop 的 `pd_DONTLENGTHEN`。
- 第二个终止 pause 的 `ph` 指针是 `phonPAUSE_SHORT`，虽然 `phcode` 仍为 `phonPAUSE`；事件按指针 code 记录。

## 观察器边界

`tools/oracle/generate-events-build.mjs` 生成 observed `synthesize.c`，并强制预包含一个把 `N_WCMDQ` 从 170 放大到 4096 的 `synthesize.h`，同时重编译 `wavegen.c`。这使 C 观察器输出**完整逻辑事件计划**，不被原 170 项命令队列的满队 resume 截断。

这是一个有意的观测边界，不是宣称产品运行时已放大队列。原 `N_WCMDQ=170` 的有界调度、queue-full 后的重复当前音素、消费与 resume 仍属于后续运行时阶段，尚未验收。

## 验证

```sh
node tools/compare/generate-events.mjs artifacts/oracle-clause-word2-2pOOA5
```

- 99 个真实 CLI 子句全部 exact。
- 19994 个高层合成事件一致。
- 报告：`artifacts/generate-events-uhdGD0/report.json`

该结果证明 M09 的逻辑 WavePlan 生成，不证明 M10 PCM、原队列调度或设备实时性。

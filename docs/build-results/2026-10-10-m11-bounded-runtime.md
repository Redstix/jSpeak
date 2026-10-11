# 2026-10-10 M11 有界运行时记录

固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`、en-us、PCM16 mono、22050Hz。本轮实现命令计划到 PCM 的有界运行时；完整文本到命令计划的 Vela 适配仍在 M12。

## 实现

- 新增 `src/core/synthesis-runtime.js`：原 170 项命令窗口、4096 样本 PCM chunk、最多 4 个在途 PCM 缓冲，默认 PCM 队列上界 32768 字节。
- `onAudio` 后缓冲归消费者所有，必须调用 `release()`；池耗尽进入显式 backpressure，释放后恢复调度。新会话在旧缓冲未释放前拒绝启动。
- 输入/中间状态上限为 65536 输入字节、16384 code points、256 clauses、100000 条中间命令；超限抛 `SYNTHESIS_RUNTIME_CAPACITY`，不截断。
- 调度由适配层注入 scheduler，核心不依赖 Node/DOM/Vela API；每次 pump 最多产出一个 PCM chunk 并主动返回事件循环。
- 取消立即清空命令窗口并通知 command source `cancel()`；完成同样释放上游 source。迟到 scheduler 回调因会话状态退出。
- `wave-generator.fill` 增加可选 command window，不影响默认完整数组行为；67 例 M10 全量 PCM 仍逐点 exact。

## 可复现命令

```sh
node --test tests/synthesis-runtime.test.mjs tests/wave-generator.test.mjs
npm run benchmark:synthesis-runtime
node --max-old-space-size=1024 tools/compare/wave-generator-full.mjs artifacts/wave-generator-full-m11-20261010
npm test
```

## 验收结果

| 项目 | 结果 | 证据 |
|---|---|---|
| 慢消费者 | PASS：2 块池耗尽、backpressure 1 次、释放后恢复 | `tests/synthesis-runtime.test.mjs` |
| 1 秒输出 | PASS：22050 样本、6 chunks、队列命令峰值 2 | benchmark report |
| 30 秒输出 | PASS：661500 样本、162 chunks、PCM 池仍为 4 块/32768B | benchmark report |
| 长输入/长命令流 | PASS：5001 条命令、命令窗口峰值 170、输出 5000 样本 | benchmark report |
| 取消重启 | PASS：取消后命令队列 0；释放后新会话完整输出 100000 样本 | unit test |
| 重复合成 | PASS：100 sessions、每会话 1000 样本、无状态串扰 | benchmark report |
| 超限显式错误 | PASS：inputBytes 65537 超过 65536，state=error、队列 0 | benchmark report |
| 缓冲所有权 | PASS：未释放 outstanding chunk 时拒绝新会话；重复释放失败 | unit test |
| 资源回收 | PASS：完成/取消调用 source.cancel，命令窗口清零；PCM 池按释放复用 | unit test |

2026-10-11 复跑：Node 24.21.0 基准实测取消时延 `0.130656ms`（单次，非设备阈值）；100 次会话 heapUsed before/after 为 `6505680/6058016` bytes，会话间最大观察值 `7802304` bytes。连续 heap 峰值不可测，记未知；该基准使用 pause 命令，不代表真实 DSP RTF。

## 差分回归

- 2026-10-11 复跑 `npm test`：266/266，0 fail，0 skip。
- 接入运行时后的 M10 全量 C/JS PCM：67/67 exact，99 clause、15449 命令、6344247 样本；命令窗口峰值 170，池峰值不超过 4。
- 复跑 M00–M10 当前有效差分/自检入口：unicode、clause、tokenizer、clause translation、phoneme make、CalcPitches、prosody、Generate events、pause/Wave/全量 Wavegen、dictionary、rules、word ending、word、number、derived、phoneme encode、phoneme list、read-clause names、accent、character names、text、phoneme table、word stress 均 PASS。
- 本轮修复 `tools/compare/calc-pitches.mjs` 少传 embedded count 的历史 harness 输入错误；修复后 CalcPitches 99/99 exact。
- 既有 `npm run test:letter-names` 当前在 U+00BC 触发显式 `DICTIONARY_UNSUPPORTED:unrelated-clause-end-comparison`，未能作为 PASS 使用。本轮未修改该核心路径；当前有效的 character-name/accent/read-clause gates 均 PASS。该历史自检缺口不因 M11 记为通过。

## 未完成

- M12 才连接完整文本、数据装载、有界运行时、WAV 写入和真机播放；本轮不宣称完整文本→PCM 已集成。
- Node/mock 不证明 Vela 事件循环、文件 I/O、播放生命周期或设备 heap；设备容量与文件队列仍未测。
- 非 pause 波形 CPU、持续 RTF、首音延迟、设备取消时延和连续 heap 峰值未知。
- 输入容量由 command source 报告并由运行时强制；M12 的完整前端 source 也必须逐段报告，不能整文本驻留。

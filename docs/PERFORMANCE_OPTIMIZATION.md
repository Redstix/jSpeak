# Vela performance branch status

执行时间：2026-10-11。分支：`work/vela-performance`，基线提交：`d997d9e`。本页记录本轮零音质损失的共享 Wavegen 优化；**Node 数字不能外推为 Vela/QuickJS 实测结果**。

## 优化项

1. `src/core/wave-generator.js` 在 `playSpect` 热循环中缓存 `sinTable`、两套 harmonic spectrum、peak harmonic/height 数组和 echo buffer，减少每样本重复对象/数组寻址。
2. `advanceParameters` 每个峰只取一次 `peaks[ix]` 引用，避免同一对象字段更新期间重复索引。
3. `src/core/wave-command-planner.js` 把 `setRms` 使用的 200 项平方根表提升为模块常量，消除每次调用的数组分配。
4. `readFrame` 不再写冗余 `ffreq0..ffreq6` own properties；每个帧对象减少 7 个未消费字段，同时保留原有 `ffreq` 数组语义。

以上均为调度与对象形状优化，不改变上游采样率、滤波、随机、整数/浮点运算或 PCM 舍入。

## 基准

新增固定基准：

```sh
npm run benchmark:wave-generator -- --runs 5
```

范围是 M10 的 67 个真实命令计划、99 clause、15,449 条 Generate 命令、6,344,247 个 PCM 样本，输出 chunk 固定 4,096 样本。它只计时纯 JS `WaveGenerator.synthesize`，不计时 C Oracle 生成命令，也不计时 Vela 文件 I/O。

| 指标 | 基线 `d997d9e` | 本分支 | 变化 |
|---|---:|---:|---:|
| median 总耗时 | 7,523.686ms | 7,065.694ms | -6.09% |
| median 吞吐 | 843,236.60 samples/s | 897,894.38 samples/s | +6.48% |
| fastest 总耗时 | 7,013.515ms | 6,356.150ms | -9.38% |
| slowest 总耗时 | 9,479.466ms | 11,161.601ms | 噪声，不作为结论 |

基线在临时 detached worktree 中使用同一新基准脚本和同一 Oracle 数据运行，避免用不同计时路径比较。每边各 5 轮；median 为第 3 轮。slowest 基线 9.48s、优化 11.16s 说明本机有明显调度噪声，因此只把 median 作为方向性 Node 结果，不作为 Vela 通过门。

优化分支最终验收前又复跑一组 5 轮：median 6,381.780ms（994,118.79 samples/s），fastest 5,506.284ms，slowest 7,790.628ms。相对基线 median 为 -15.18%。由于两个 5 轮批次的 median 相差约 9.6%，本页以同批保守结果 -6.09% 作为方向性结论，不复跑数字不作为 Vela 通过门。

## 正确性

```sh
npm run test:wave-generator:full
```

结果：

- 67/67 cases exact。
- 99 clause、15,449 commands、6,344,247 samples。
- chunk sizes 1/7/64/1323/4096 拼接一致。
- bounded runtime command→PCM exact。
- profile 外后端仍显式 unsupported。

因此本分支在该固定 en-us profile 上没有可测音质损失；PCM 是逐点 exact，而不是“听感近似”。

## 资源结论

- `setRms` 每次调用少分配一个 200 项数组；实际调用次数与 Vela heap 峰值未测。
- 每个命令规划 frame 少 7 个冗余 own properties；这是结构性对象形状减少，不等价于已测 heap 节省。
- `WaveGenerator.bufferProfile()` 保持 echo/harmonic/low-harmonic 工作缓冲不变，`outputLengthDependent=false`。
- 未改变 PCM chunk、命令队列或在途 PCM 池容量。

## 未验证/未知

- Vela/QuickJS RTF、冷/热启动、首音、maxSlice、取消延迟：未验证/未知。
- 真实设备 heap 峰值：不可测/未知。
- 文件 I/O 与播放队列水位：未测。
- M12 完整文本→命令仍未 C/JS exact；本页优化只覆盖已验收的命令→PCM共享层。
- cmn JS 前端未实现，因此没有中文 Vela 合成性能结果。
- M13 数据裁剪未执行；`cmn` 数据包仍为 2,295,161B 原始候选。

## 下一步

在 Vela/QuickJS 上复测同一固定命令→PCM 语料，记录纯合成 RTF、maxSlice 和可测内存；再基于实测决定是否需要流式 WAV 写入、分页数据装载或进一步帧对象扁平化。任何后续优化都必须继续以 C/JS PCM exact 为通过条件。

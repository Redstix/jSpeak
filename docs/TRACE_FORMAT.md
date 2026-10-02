# Trace envelope — draft v1

这是待实现的契约，不表示内部插桩已经存在。

每个 trace 使用 JSON envelope：

```json
{
  "schemaVersion": 1,
  "stage": "phoneme-before-prosody",
  "caseId": "ascii-001",
  "reference": {
    "upstreamCommit": "<full commit hash>",
    "buildFingerprint": "<sha256>",
    "dataFingerprint": "<sha256>",
    "profileId": "<explicit voice and parameters>"
  },
  "input": {},
  "initialState": {},
  "events": [],
  "finalState": {}
}
```

- `stage` 是源码核验后的观察点，不是随意的函数名。
- 事件带单调序号；字段定义需含类型、位宽、有符号性和单位。
- 音素 ID 必须带表身份，不能将不同表相同数字误判为相同音素。
- 时间使用明确的整数 sample index 或规定的上游单位，不混用毫秒。
- 禁止地址、墙钟时间和无序容器遍历顺序影响比较。
- 初始状态必须足够重放该边界；voice、邻居、随机状态等不能隐含在进程全局。
- 大体积 PCM 独立保存，以路径、格式、sampleCount 和 SHA256 引用。
- 比较器先拒绝元数据不兼容，再报告首个语义分歧；不静默跳过未知字段/版本。
- 每个失败种子保存、缩减并进入回归集。有效语义差分与无效字节健壮性 fuzz 分开运行。

待核验观察点：解码、clause、词典/规则选择、韵律前音素、mutation、时长/音高决策、合成命令、波形状态。不要用示意观察点声称完整覆盖上游内部行为。

# Implementation status

## 已完成

- Git 原始资料基线；工作分支 `work/bootstrap`，无 remote/push。
- 原始阶段文档解包到 `design/stages/`，内容未改。
- 兼容性、trace envelope、运行时门槛、源码映射规则草案。
- PCM16 比较器：精确匹配、首个分歧、长度差、最大/RMS 误差、归一化相关性；无自动对齐或静音裁剪。
- `npm test`：6 项比较器单测通过，包括故意差异、空/静音、长度差、格式错误和完整 PCM16 差值。仅为比较器自检。

## 当前约束

- 执行环境要求用户明确授权从 `https://github.com/espeak-ng/espeak-ng` 获取并构建外部 C 代码，当前未执行。
- 尚未锁定上游、构建 C oracle 或生成 golden。
- 尚无 JS phonemizer、合成器或真实差分测试。
- Vela 探针尚未构建；没有 RPK 或真机结果。

## 下一步

1. 授权后锁定上游与构建选项，完成最小 Oracle 和可重复样例。
2. 按本地 Vela 技能构建设备探针，先核验官方 API。
3. 用户回传真机结果后收敛运行时能力与音频路线。
4. 以源码观察点推进音素表基础设施、phonemizer 和代表性 DSP 切片。

不以文档存在代替功能完成；不以 harness 自检代替 C/JS 兼容通过。

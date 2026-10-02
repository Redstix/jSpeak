


---

1. 最大的问题：它高估了“逐阶段迁移”的可行性

整个方案看起来非常漂亮：

M00 Oracle
 ↓
M01 Unicode
 ↓
M02 Segmentation
 ↓
M03 Dictionary
 ↓
M04 Translation
 ↓
M05 Phoneme
 ↓
M06 Phonemizer
 ↓
M07 Prosody
 ↓
M08 Phoneme VM
 ↓
M09 Synthesis
 ↓
M10 PCM

问题是：

eSpeak NG 并不是一个天然按这个边界分层的程序。

这些边界是我们为了方便移植而人为划出来的。

真实 eSpeak 内部存在大量：

语言规则
 ↕
phoneme
 ↕
prosody
 ↕
voice
 ↕
phoneme table
 ↕
synthesis

相互影响。

例如 M07 写：

> PhonemeList -> SynthesisPlan



听起来很干净。

但真实情况很可能是：

phoneme processing
 ├─ 修改 phoneme
 ├─ 插入 phoneme
 ├─ 修改 length
 ├─ 查询前后 phoneme
 ├─ 读取 stress
 ├─ 读取 voice
 └─ 触发 synthesis state

所以实际迁移过程中一定会出现：

“这个东西应该属于 M07，
但 C 里面实际上是在 M08 的某个函数里完成的。”

这不是 bug。

这是迁移边界和原始架构边界不一致的问题。

我的建议

不要把：

M07
M08
M09

当成“源码模块边界”。

应该把它们定义成：

> 可验证的行为边界。



也就是说：

C implementation
       │
       ├── arbitrary internal structure
       │
       ▼
┌─────────────────────────┐
│ JS compatibility layer  │
├─────────────────────────┤
│ Observable contract     │
└─────────────────────────┘

否则 Coding Agent 最后会花大量时间纠结：

> “这个函数到底属于哪个阶段？”



而不是实现功能。


---

2. 第二个大问题：Oracle 思路是对的，但目前的 Oracle 还不够强

这是我认为整个设计最值得继续加强的地方。

M00 现在基本是：

C build
 ↓
golden
 ↓
JS
 ↓
compare

非常正确。

但是问题来了：

C 能直接给你的“标准答案”到底是什么？

对于：

text → phoneme

比较简单。

但是到了：

phoneme → synthesis → PCM

事情完全不同。

你现在写：

> exact sample comparison where deterministic



这是一个危险的表述。

因为纯 JS 和 C 之间可能存在：

integer promotion 差异

signed overflow 行为差异

rounding

floating-point evaluation

compiler optimization

lookup 顺序

PRNG/noise

platform-dependent behavior


尤其 synthesis 部分。

所以：

C PCM
vs
JS PCM

未必天然应该：

sample[i] === sample[i]


---

3. 真正应该做的是“Trace Oracle”

我会把 M00 改成：

C eSpeak
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     phoneme      event       PCM
      trace       trace
        │           │           │
        └───────────┼───────────┘
                    │
                    ▼
                JS compare

例如不要只得到：

PCM

而应该能够让 C 输出：

{
  "phonemes": [...],
  "stress": [...],
  "length": [...],
  "pitch": [...],
  "events": [...],
  "waveParams": [...]
}

然后 JS：

{
  "phonemes": [...],
  "stress": [...],
  "length": [...],
  "pitch": [...],
  "events": [...],
  "waveParams": [...]
}

这样：

M04 错了

和：

M09 错了

可以立刻区分。


---

4. 更狠一点：应该直接给 C 写 instrumentation

这是当前方案明显不足的地方。

它说：

> instrumented C output where possible



我觉得这个措辞太软了。

应该改成：

> 凡是 JS 必须复现的内部行为，都优先在 upstream C 中增加 trace instrumentation。



例如：

trace_phoneme(...)
trace_prosody(...)
trace_phoneme_instruction(...)
trace_formant(...)
trace_wave(...)

最终：

C:
    input
      ↓
    trace
      ↓
    output

JS:
    input
      ↓
    trace
      ↓
    output

这是整个项目能否成功的关键。


---

5. M08 是整套方案真正的“核弹”，但现在写得太轻了

M08 写：

> Implement a small deterministic VM/interpreter for the compiled phoneme instructions.



这个方向我赞成。

但我会直接告诉你：

M08 很可能是整个项目最难的阶段之一。

甚至可能比 M04 更难。

因为这意味着你不是：

把 C 翻译成 JS

而是在做：

eSpeak phoneme DSL
        ↓
compiler
        ↓
bytecode
        ↓
JS VM

也就是：

> 你实际上正在实现一个 eSpeak phoneme instruction runtime。



这已经非常接近：

小型虚拟机

而不是普通数据转换。


---

6. M08 的最大风险：把“继承解析”提前 build-time 是危险的

设计里写：

> inheritance resolved at build time.



这个优化很合理。

但：

必须证明 C 的继承语义确实允许这么做。

因为如果存在：

base phoneme
   ↓
voice override
   ↓
language override
   ↓
context-dependent mutation

你过早 flatten：

A inherits B

变成：

A = fully flattened B

可能丢失某些运行时语义。

所以应该先：

faithful interpreter

再：

flatten optimization

而不是一开始就：

build-time flatten


---

7. 还有一个很大的问题：你所谓的“纯 JS”其实没有定义清楚

目前约束：

No WASM
No native

很好。

但还应该明确：

是否允许：

Math.sin()
Math.cos()
Math.random()
Float64Array

？

以及：

TypedArray
DataView
BigInt
TextEncoder
TextDecoder

？

特别是 Vela。

你最终真正的 runtime 是：

Xiaomi Vela JS runtime

它未必提供现代浏览器 Node 那一套完整 JS API。

所以应该有一个：

SUPPORTED JS RUNTIME SUBSET

例如：

ECMAScript:
  ES2020 subset

Required:
  ArrayBuffer
  Uint8Array
  Int16Array
  DataView
  Math.*

Forbidden:
  Promise?     ← 取决于 Vela
  fetch
  DOM
  WebAudio
  Node.*

否则 PC 上：

npm test

全部通过，

到了 Watch：

ReferenceError: DataView is not defined

或者某个 API 行为不同。


---

8. “纯 JS”真正最大的风险可能不是 RAM，而是 CPU

你之前目标是：

资源：
0.5–3 MB

RAM：
2–5 MB

这个目标本身我不敢说不可能。

但我会把：

> CPU 性能



放到比 RAM 更高的优先级。

因为：

C eSpeak

里面有大量：

DSP
filter
formant
waveform
integer arithmetic

你现在把它全部变成：

JS

再放到：

低功耗 wearable MCU/SoC

上。

真正的问题可能变成：

生成 1 秒声音

C:
0.1 sec

JS:
1.7 sec

那即使：

RAM = 3 MB
Flash = 2 MB

也没有意义。

所以 M14 应该从：

RAM/CPU/Flash

改成：

Realtime viability

核心 KPI 应该是：

RTF < 1

而且最好：

cold-start RTF
warm RTF

都测。


---

9. 更现实的问题：Vela 上“纯 JS TTS”可能卡在音频输出，而不是 TTS

M12 现在写：

JS PCM
 ↓
Vela audio API

太简单了。

真正需要验证的是：

TTS producer
       ↓
 PCM ring buffer
       ↓
 audio consumer

两个时钟：

TTS generation rate
        vs
Audio playback rate

如果：

TTS < playback rate

就 underrun。

例如：

播放：

████████████████████

生成：

████████░░░░████████

就会爆音/停顿。

所以 M11/M12 实际上应该设计：

Producer
 ↓
Ring Buffer
 ↓
Audio API

而不是简单：

onAudio(chunk)


---

10. M03 的 binary dictionary 设计，我认为方向对，但有点过早优化

这里我要反过来批评。

设计从 M03 就要求：

binary format
compact lookup
offsets
checksum

这很漂亮。

但对于 Coding Agent：

这可能是 premature optimization。

第一版其实完全可以：

upstream data
 ↓
generated JSON / JS typed arrays

先把：

正确性

跑通。

然后：

M13
 ↓
binary packing

再优化。

否则 Agent 同时处理：

dictionary semantics
+
binary format
+
lookup

调试困难会明显增加。


---

11. 反而 M13 才应该成为“数据格式冻结点”

我更推荐：

M03
    faithful loader
    ↓
M04
    correct lookup
    ↓
M06
    complete phonemizer
    ↓
M13
    freeze production data format

也就是说：

Dev format

可以：

简单
可读
容易 debug

Release format

再：

compact
compressed
packed

这样 Coding Agent 的工作难度会下降很多。


---

12. M06 的“1000 cases”其实远远不够

这里我会直接划掉：

> 至少 1,000 generated/curated text cases



对 eSpeak 这种东西：

1000 基本等于 smoke test。

尤其如果只是：

Hello world
The cat is...
...

几乎没有意义。

应该直接利用：

upstream test corpus

再加：

property/fuzz

例如：

10k
100k
甚至百万级随机输入

当然不是要求全部人工验证。

而是：

C oracle
    ↓
随机输入
    ↓
JS
    ↓
diff

自动跑。


---

13. 更严重的是：fuzz 应该前移，而不是只在最后

当前设计虽然提到：

tests/
  fuzz

但整体感觉是：

完成阶段
 ↓
测试

我会要求：

M00
 ↓
建立 fuzz infrastructure
 ↓
每个阶段持续 fuzz

例如 M04：

random word

M07：

random phoneme sequence

M08：

random instruction sequence

M10：

random synthesis events

这样特别容易抓：

out-of-bounds
infinite loop
state leakage
buffer corruption


---

14. 最大的架构问题：它把“eSpeak compatibility”定义得太严格，却没有定义 compatibility boundary

这是最核心的哲学问题。

现在协议写：

> behavior-compatible



这个词太强。

因为如果你真的要求：

C eSpeak
==
JS eSpeak

那么你实际上是在做：

> formal-ish reimplementation



这比普通 port 难很多。

尤其是：

PCM exact equality

非常苛刻。

你真正需要先决定：

Level A

Text → phoneme

必须完全一致。

Level B

Prosody/event

尽量一致。

Level C

PCM

允许数值误差：

max error
RMS
duration
correlation

Level D

perceptual similarity

人工听感。

我认为这是更合理的定义。


---

15. 否则会出现一个非常荒谬的结果

例如：

C：

sample[1024] = 1234

JS：

sample[1024] = 1235

然后 Agent：

> M10 failed.



于是开始花三天研究：

为什么第 1024 个 sample 差 1？

但实际上：

听感完全一样

而项目真正的目标是：

Redmi Watch 5 上可用的 eSpeak-derived TTS

不是：

C compiler output bit-for-bit emulator

所以应该明确：

> 哪里必须 exact，哪里只需要 equivalence。




---

16. M16 的 upstream synchronization 是好东西，但它有点“画饼”

这一段：

update upstream
 ↓
diff
 ↓
classify
 ↓
port
 ↓
benchmark

方向没问题。

但实际上最大的困难是：

C upstream changed

之后你怎么知道：

哪些 C 代码对应哪些 JS 代码？

所以必须在每个迁移模块中维护：

SOURCE MAP

例如：

upstream:
src/phoneme.c:120-340

       ↓

JS:
src/core/phoneme/translate.js

以及：

upstream:
phsource/ph_english
       ↓
data/en/phoneme.bin

这样未来才能真正维护。

否则 M16 最后会变成：

> “新版 eSpeak 变了，让 LLM 看看哪里需要改。”



那还是回到了最开始的问题。


---

17. 还有一个我认为非常重要的遗漏：不要一开始就以 Vela 为最终验证环境

这个项目应该明确：

Level 0
Node

Level 1
Node + strict JS subset

Level 2
Vela emulator/mock（如果可行）

Level 3
实际 Watch

而不是：

PC 开发
 ↓
直接 Watch

因为 Watch 上 debug 成本太高。


---

18. 我会把整个项目重新定义成“四层”

目前的 17 阶段没必要推翻。

但我会把它上面再套一层：

┌─────────────────────────────┐
│  Layer 4: Vela Product      │
│  M12 M13 M14                │
├─────────────────────────────┤
│  Layer 3: DSP               │
│  M09 M10 M11                │
├─────────────────────────────┤
│  Layer 2: eSpeak Runtime     │
│  M03 M04 M05 M07 M08        │
├─────────────────────────────┤
│  Layer 1: Oracle             │
│  M00 M01 M02 M06             │
└─────────────────────────────┘

然后每层都有：

input
output
trace
oracle
fuzz
benchmark


---

19. 如果是我，我甚至会修改阶段顺序

当前：

M00 → M01 → M02 → M03 → M04 → M05 → M06

我基本保留。

但后面我会考虑：

M00
 ↓
M01
 ↓
M02
 ↓
M03
 ↓
M04
 ↓
M05
 ↓
M06
 ↓
M08
 ↓
M07
 ↓
M09
 ↓
M10
 ↓
M11

也就是：

> 先把 phoneme VM 做出来，再做 prosody integration。



原因是 M08 是一个相对独立的：

DSL → bytecode → interpreter

它可以单独测试。

而 M07 会大量依赖：

phoneme state
voice
phoneme attributes

两者实际上会互相咬。

所以：

M08

作为一个独立 compiler/VM 项目先验证，会降低后面的复杂度。


---

20. 我最不满意的一点：这套设计仍然太“LLM 文档风格”

这是我最直接的锐评。

它大量使用：

Goal
Scope
Requirements
Acceptance

看起来非常专业。

但是 Coding Agent 真正最需要的是：

Source:
    src/phoneme.c

Port:
    src/core/phoneme.js

Data:
    phsource/*.txt

Expected:
    tests/golden/phoneme/*.json

Trace:
    tools/oracle/trace-phoneme

Invariant:
    ...

Forbidden:
    ...

Known deviations:
    ...

Dependency:
    ...

也就是说：

> 少写“应该怎样”，多写“从哪里搬到哪里、怎么证明搬对了”。



这才是真正能约束 Agent 的 DESIGN.md。


---

21. 如果让我给这套方案重新打分

部分	我的评价

总体方向	9/10
阶段划分	8/10
Oracle 思想	9/10
Vela 隔离	9/10
数据/代码分离	9/10
内存设计	8/10
Streaming	8/10
DSP 迁移计划	6/10
eSpeak 内部语义捕获	5/10
Differential testing	7/10
Fuzz strategy	5/10
CPU feasibility	5/10
Upstream maintenance	7/10
给 LLM Agent 的可执行性	6/10


综合：

6.5～7/10

不是差。

实际上它已经比“LLM 自己写一个纯 JS TTS”高一个数量级的工程质量。

但它现在最大的问题是：

> 看起来像一套完整的迁移计划，实际上最难的 20%——eSpeak 内部语义如何被精确捕获和验证——还没有被真正规格化。




---

22. 如果这是我的项目，我下一步不会继续写 M17

我会停下来，先补一个东西：

COMPATIBILITY_SPEC.md

里面明确规定：

1. 什么叫 compatible

2. Unicode
   exact

3. word segmentation
   exact

4. phoneme sequence
   exact

5. phoneme instruction trace
   exact

6. prosody
   exact / tolerance

7. synthesis event
   exact / tolerance

8. PCM
   tolerance

9. perceptual audio
   human regression

10. performance
    RTF requirement

11. memory
    peak heap requirement

12. Vela
    supported JS API subset

然后再补：

TRACE_FORMAT.md

定义：

{
  "stage": "prosody",
  "input": {},
  "events": [],
  "numeric": {},
  "upstreamCommit": "..."
}

最后才是：

SOURCE_MAPPING.md

建立：

eSpeak C
   │
   ├── source
   ├── data
   └── tests
         ↓
JS implementation
   │
   ├── source
   ├── generated data
   └── tests

这三个文件补上以后，这套方案才真正从“很漂亮的 LLM 项目计划”变成“可以约束 Coding Agent 做逆向式兼容移植的工程规格”。

尤其是 M08 + Trace Oracle + Compatibility Spec，我认为是目前最应该加强的三个地方。
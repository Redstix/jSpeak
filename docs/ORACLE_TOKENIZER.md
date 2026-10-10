# Tokenizer C 参考工具

本工具捕获固定上游 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`
的 `TranslateClauseWithTerminator`，观察点在 `FIRST_WORD`、`LAST_WORD`、
`HAS_DOT` 标志设置完成之后、第一次 `TranslateWord2` 之前。
适用范围是新进程中原始输入的第一 clause，不代表连续完整翻译会话。

## 构建与使用

```sh
node tools/oracle/tokenizer-build.mjs
node tools/oracle/tokenizer.mjs < request.json
node tools/oracle/tokenizer-selfcheck.mjs --trace-dir artifacts/oracle-trace-wOIRDF
node tools/oracle/tokenizer-safety.mjs
```

构建使用独立 `build/oracle-tokenizer/source` 和 `build/oracle-tokenizer/build`。
不修改 `upstream/espeak-ng`、原 `build/oracle`、冻结 trace/clause/Unicode 工具。
补丁 `tools/oracle/patches/tokenizer-boundary.patch` 增加两个默认 NULL 的回调，
以及直接调用原静态函数的包装。普通 CLI 回调为空，继续原流程；开发 helper
在 words 回调立即返回，不执行后续翻译，也不伪造 `count_words` 等下游状态。

Node API：

```js
import { createTokenizerOracle } from '../tools/oracle/tokenizer.mjs';
const oracle = createTokenizerOracle();
const result = oracle({ utf8Hex: '48656c6c6f20776f726c642e' });
```

工厂在创建时校验固定 commit、完整工作区补丁、CMake 配置、CLI、静态库、
helper 源码/二进制、bounds 检查 object 和全部编译数据的 SHA-256。
每项请求在独立进程执行；同一工厂的后续调用假设验证后的构建不被外部改写。

## 请求和响应

请求仅接受下列字段，均可省略：

| 字段 | 内容 |
| --- | --- |
| `utf8Hex` | 最多 65536 字节的小写偶数长度 hex；保留 NUL、无效 UTF-8 |
| `scans` | `{bytesHex, offset=0, backwards=false}` 数组 |
| `translations` | `{sourceHex='', nextOffset=0, prevIn=0, codepoint, nextIn=0, insert=0, wordFlags=0}` 数组 |
| `splits` | `{codepoint, previous=0}` 数组 |
| `alphabets` | uint32 code point 数组 |

各原语数组最多 16384 项，每项 source/bytes 最多 65536 字节，每种原语的二进制
frame 最多 16 MiB。偏移是字节偏移，允许指向末尾的补零区域起点，不允许越界。
`prevIn`、`insert` 是 int32；code point、`wordFlags` 是 uint32。
向后扫描若跳过前导 continuation 字节会越过缓冲开头，显式拒绝请求。

响应包含 `schemaVersion:1`、`status`、`diagnostic`、`reference`、规范化 `request`、
初始化 `profile`，以及以下观测：

| 字段 | 含义 |
| --- | --- |
| `readClause` | 原 ReadClause 的 source hex、charix、terminator、tone 和起始位置；未请求文本时为 null |
| `words` | 原 sbuf 的 `bufferHex` 和 `WORD_TAB` 的 `items`；未请求文本时为 null |
| `state` | 原函数局部扫描状态及 caller 诊断状态；未请求文本时为 null |
| `embeddedStateBefore` / `embeddedStateAfter` | ReadClause 返回后和 words 边界的真实 embedded 状态 |
| `controlState` | ReadClause 返回时的 `{optionPunctuation,punctuationList}` |
| `scans` | 原 `utf8_in2` 的 `{codepoint, bytes}` |
| `translations` | 原 `TranslateChar` 的 `{codepoint, insert, wordFlags}` |
| `splits` | 原 `ShouldSplitIdeographs` 的布尔结果 |
| `alphabets` | 原 `AlphabetFromChar` 的 `{name,offset,rangeMin,rangeMax,language,flags}` 或 null |

`bufferHex` 包含 sbuf 的开头 NUL 和两个空格，以及直到 `clause_end` 的全部字节；
排除终结 NUL，不能用 `strlen(sbuf)` 截断。WORD_TAB 保留真实宽度：flags uint32、
start/sourceix uint16、prePause/length uint8。ReadClause 的 charix 包含 top + 1 项。

`state` 的五个 tokenizer 局部值是 `sourceIndex`、`sourceIndexWord`、`finished`、
`wordFlags`、`nextWordFlags`；其余 `countWords`、`countSentences`、pause、sentence、
terminator 是首 clause caller 诊断，不能推断完整会话后继状态。

embedded 状态包含 `embeddedIx`、`embeddedRead`、有效 `list`、`optionSayas2`、
`countSayasDigits`、`wordEmphasis`、`optionSayas`、`optionEmphasis`、`pendingCount`。
before 的 pendingCount 是尚未扫描时的 0；after 来自原局部 `embedded_count`。
这些值观察于 TranslateWord2 之前，因此不冒充已经应用的声学参数。
`profile.embedded` 直接导出原 `embedded_default`、容量和编译期命令常量。
这些字段属于附加观测，由新的 helper/patch 指纹区分；旧报告保留。

原语每类单独启动进程。`translations` 数组在同一进程顺序调用，保留原
`SubstituteChar.ignore_next_n` 状态；它既不在数组项间清零，也不跨请求保留。
原 scanner 跳过 continuation 字节的计数规则与 text_decoder 不同，不能混用。

## 上游未定义行为

正常响应为 `status:'ok', diagnostic:null`。
helper 额外以 `-fsanitize=bounds -fno-sanitize-recover=bounds` 编译原尺寸的
`translate.c` object，并优先于原静态库链接。普通 CLI 不使用这个 object。
这不会扩大缓冲区，也不会把越界后的内存解释为标准答案。

当且仅当 tokenizer 进程产生 `translate.c` 的精确 bounds sanitizer 诊断时，
Node 返回：

```json
{
  "status": "undefined-upstream-behavior",
  "diagnostic": {
    "code": "TOKENIZER_BOUNDS_UNDEFINED",
    "source": "src/libespeak-ng/translate.c",
    "line": 1652,
    "column": 6,
    "index": 800,
    "arrayType": "char [800]"
  },
  "readClause": null,
  "words": null,
  "state": null
}
```

普通进程错误、超时、截断 frame、非法协议不会被当作上游 UB；它们仍抛出错误。
上述 bounds 检查仅覆盖 `translate.c` 编译器可检查的数组访问，不是全程序内存安全证明。

已独立复现的样例：`'ab - ' + '한'.repeat(88)`（269 字节）。Hangul 展开和 pause
额外空格使原 sbuf 终结写入触达索引 800。`'a - ' + '한'.repeat(88)`（268 字节）
返回 799 字节 buffer 并正常终结。`tokenizer-safety.mjs` 从未改动的 upstream
`translate.c` 以 UBSAN 编译单 object，再链接原 CLI/库，证明原始第 1650 行越界；
patch 中第 1652 行是同一操作。此输入必须单独记录，不能计入 exact 兼容通过。

## 自检范围

`tokenizer-selfcheck.mjs` 检验第一 clause 新进程重跑、冻结 ReadClause helper、
原 trace 第一 readClause/words 桥接、NULL hooks 普通 CLI 的完整 mnemonic/WAV、
Node 请求边界、原 C 二进制 frame 拒绝以及已证明的越界分流。
这些是 C 参考自身可信性证据；C/JS 差分由 `tools/compare/tokenizer.mjs` 独立完成。

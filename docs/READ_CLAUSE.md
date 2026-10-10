# M02.1 固定 profile 的 ReadClause

`src/core/read-clause.js` 将固定 eSpeak NG `readclause.c:ReadClause` 移植为纯 JavaScript 会话状态机。当前范围是 **en-us、UTF-8、plain text、新会话、800 字节逻辑容量**；支持连续直接调用 ReadClause，返回 source bytes、charix、terminator、tone 和读取前后状态。已接入原版嵌入控制与字典标点名称；字符名称需要 TranslateRules 的分支仍明确拒绝，因此此实现不代表完整 ReadClause 或 M02 验收完成。

实现依赖 [M01 Unicode 原语](UNICODE.md) 和 [clause type 原语](CLAUSE_TYPE.md)。核心不访问 Node、文件系统、音频或宿主 Unicode 分类；不实现 tokenizer、词翻译、发音、韵律或 DSP。

## 接口与所有权

```js
import { createClauseReader, READ_CLAUSE_PROFILE } from '../src/core/read-clause.js';

// Hello 的 UTF-8 bytes；运行时不要求 TextEncoder 或 Buffer。
var reader = createClauseReader(new Uint8Array([72, 101, 108, 108, 111]));
while (reader.hasMore()) {
  var clause = reader.next();
  // 消费 clause.source / clause.charix / clause.terminator 等字段。
}
```

`createClauseReader(bytes, options?)` 仅接受 `Uint8Array`。输入借用而不复制；调用者必须在会话期间保持输入不变。解码采用 M01 的 `termination: 'c-string'`：第一个输入 NUL 截断逻辑输入，没有 NUL 时补一个虚拟终止字节。解码 offset/remaining 包含该终止边界，因此可能比原 bytes 长度多 1。畸形 UTF-8 按固定上游 decoder 处理，不使用 JavaScript 字符串替换策略。

可省略 options，或提供任意子集 `{ voice: 'en-us', encoding: 'UTF-8', capacity: 800, dictionary }`。`dictionary` 是真实运行时服务，提供 `lookupCharName(cp, only)`、`lookupSpecial(bytes)`、`resetRepeat()`、`state()`；前两项返回 UTF-8 bytes，special 未找到返回 null。省略服务时普通文本照常处理，实际访问名称时明确报错。Node 差分装配见 `tools/compare/character-name-services.mjs`，核心不读取文件。未知键、不一致的值、非对象 options 均拒绝，不能通过 options 隐式启用未实现的模式。导出的 `READ_CLAUSE_PROFILE` 及其中的 `charsIgnore` 数组已冻结；它描述该切片实际消费的固定配置，不是完整 translator 或 voice 的序列化。

会话提供四个方法：

- `next()` 返回下一个完整 clause；首次返回带 `CLAUSE.TYPE_EOF` 的 terminator 后，继续调用抛出 `RangeError`。
- `state()` 返回当前读取状态的独立快照；不推进 decoder。它用于观察，不是恢复会话的 checkpoint。
- `hasMore()` 在 EOF 或不支持错误之前为 true；发生其中任一情况后为 false。
- `controlState()` 返回 `{optionPunctuation, punctuationList}` 独立快照，保留 B 命令跨 clause 配置。

每条记录拥有自己的输出 TypedArray，后续调用不会改写先前结果。返回记录为：

| 字段 | 类型与含义 |
|---|---|
| `index` | 从 0 开始的本会话 clause 序号 |
| `startCharacter` | 调用前 `max(0, countCharacters)`，对应上游调用者的 `clause_start_char` |
| `source` | `Uint8Array`；按 C `strlen` 截至第一个 NUL，不包含该 NUL，保留真实尾部字节；V/公告分支未必添加空格 |
| `charix` | `Int16Array`；下标 `0..charixTop`，保留上游 int16 赋值语义 |
| `charixTop` | 上游返回的最高有效 charix 下标；不可自行从 source 长度重算 |
| `terminator` | `CLAUSE` 的 pause、intonation、type、option 组合位图 |
| `tone` | 上游返回的 tone 值，包括亚美尼亚词内标点设置 |
| `voiceChange` | `Uint8Array`；对应真实 C 参数；raw CTRL-V 分支也为空，voice 名保存在 source 第一个 NUL 后，不能伪造此参数 |
| `stateBefore` / `stateAfter` | 本次调用前后状态快照 |

`CLAUSE.NONE` 等于 `0x4000`，不是 0。EOF 应检测 `terminator & CLAUSE.TYPE_EOF`，不能由 source 是否为空或 decoder 是否到尾来猜测。以 `One. Two.` 为例，直接调用依次返回 `One `、`Two `、` `；前两个是 PERIOD，第三个才是 EOF。空输入直接调用也会返回一个 source 为单个空格的 EOF clause；CLI 是否启动合成是另一个边界。

## 字节、字符计数与回退

`charix` 是上游 source **字节下标**与 decoder 字符计数间的映射，不是 JS UTF-16 索引。每次写入完整 UTF-8 字符后，在其结束位置 `ix` 写入相对字符计数，中间字节位置写入 -1；空白与括号的位置保留初始化的 0。忽略字符依然推进输入计数，所以 charix 会出现间隔。

例如输入 `aé你😀`：

```text
sourceHex = 61c3a9e4bda0f09f988020
charixTop = 10
charix    = [0, 1, -1, 2, -1, -1, 3, -1, -1, -1, 4]
```

逻辑容量保持 `N_TR_SOURCE=800`，实际临时存储仿照调用者使用 `source[840]`、`charix[804]`。断句条件保留上游的 `(ix > 725 && !IsAlpha(c1) && !iswdigit(c1)) || ix >= 796`，写完当前字符才检查。因此 795 个 ASCII 字符后接四字节 emoji 时，允许 `charixTop=799`，返回含尾空格的 800 字节 source；不得提前切断多字节编码。尾部强调标记等分支也可能使 source 长度与 charixTop 的关系不同于普通文本。

状态快照字段：

| 字段 | 语义 |
|---|---|
| `decoderOffset` / `decoderRemaining` | M01 decoder 字节游标与剩余字节数 |
| `decoderEof` / `decoderPeek` | decoder 本身的 EOF 和 peek；peek 不消费，不查看 ReadClause 的 unget |
| `logicalEof` | 精确对应 C `Eof()`：有 `ungot_char` 时为 false，否则采用 decoder EOF |
| `countCharacters` | 新会话为 -1；只有实际 `GetC` 调用 decoder 时递增，回退字符不重复计数 |
| `clauseUpperCount` / `clauseLowerCount` | 每次 ReadClause 重置后按上游条件计数 |
| `phonemesRepeatCount` | 首次调用前为 null；调用中重置，注入 dictionary 时观察其真实 repeatCount |

C 在首次 ReadClause 前尚未初始化 `phonemes_repeat_count`，所以 oracle 与 JS 用 null 表示该不可观测初值，不伪造一个初始 0。解码终止字节也会参与真实 GetC 的计数；不能从输入可见字符长度替代该字段。

内部保留 `ungot_char` 与 `ungot_char2` 两个变量。上游 `Eof()` 只检查第一个变量，`logicalEof` 不保证所有内部 pending 都为空；第二个变量会在标点公告的延迟读名分支置为非零，所以即使 logicalEof 为 true，仍可能有待处理标点。`One. Two.` 首 clause 后，decoder 的 peek 是 `w`，逻辑下一字符却是回退保存的 `T`，这是预期的源码行为。

## 固定初始化与保留分支

独立 C helper 从实际 en-us 初始化导出如下配置；差分入口核验 profile 与 source/build/data 指纹，不根据语言名称猜测：

| 配置 | 值 |
|---|---|
| voice / encoding / capacity | `en-us` / `UTF-8` / 800 |
| ssml / capitals / punctuation / lineLength / sayas / silence | 全部 0 |
| phonemeInput / endPause | 256 / 4096 |
| speed / pitch / amplitude / randomSeed | 175 / 50 / 100 / 1 |
| translator.name / phonemeTable / dictCondition | 25966 / 80 / 72 |
| numbers / lowercaseSentence | 16779328 / false |
| letterBitsOffset / toneNumbers / dotlessI | 全部 0 |
| decimalSeparator / thousandsSeparator | 46 / 44 |
| charsIgnore | `[[173, 1], [8204, 1]]`，即删除 U+00AD 与 U+200C |
| punctWithinWord / charPlusApostrophe | `[39]` / `[]` |
| replaceCharsPresent | true；此语言替换表属于后续 tokenizer 依赖，本切片不消费 |

默认 `chars_ignore` 的两个条目只删除字符，不做字符替换；这不能推导为 `langopts.replace_chars` 为空。U+200D 不被默认删除。固定 `numbers` 不含 `NUM_ORDINAL_DOT`，匈牙利序数分支也不会在此 translator 触发。

当前保留空白、CRLF/段落计数、标点/lookahead/缩写、小写跟随句点、数字邻接、容量 fallback 与 EOF；也保留固定 profile 下可达的藏文分隔符、马拉雅拉姆/僧伽罗 virama+ZWJ、亚美尼亚词内标点和强调标记行为。

CLI 默认开启 `espeakPHONEMES` 标志，故 `[[...]]` 的状态机必须保留。该状态每次 ReadClause 重新初始化，与上游一致。实现仍使用原来的 `punct_data & (CLAUSE_QUESTION | CLAUSE_EXCLAMATION)` 位运算；这些常量包含组合位，不能改为直觉上的问号/感叹号枚举比较。

## 标点名称与嵌入控制

ReadClause 保留普通 CTRL_EMBEDDED（0x01）供 tokenizer 解析，只有紧跟大写 V/B 的旧协议先在此层处理。V 读取 voice 名并返回 CLAUSE.VOICE；直接 reader 后续仍固定 en-us，完整调用者应用 voice 变更另属范围。B0 关闭公告，B1 开启全部标点，B 后其他字符形成最多 59 码点的选择列表；输出空格数与 C 一致，B0 不清除旧列表。

有字典服务时，8 种省略号码点实际执行 `LookupCharName(cp,true)`；固定 en 查询均为空，这是真实未找到结果。B 公告使用 `LookupCharName(cp,false)`，句末点优先查询 `_.p` 的 period 名称。已有文本的句末公告先返回短停顿，把标点与 lookahead 分别存入两个回退槽，下一 clause 才输出名称。重复 2/3 次非终止标点附带 `CTRL+10S` / `CTRL-10S`，4 次以上采用“名称 次数 名称”。`<` 不吞并重复项，括号替换为原版 U+E028，所有字节和 charix 保持原始顺序。

独立 clean C 观测 `LOPT_ANNOUNCE_PUNCT=0`、`embedded_value[EMBED_S]=175`、soundicon 容量 80 且实际表为空；证据 `artifacts/control-profile-audit-irpXbo/report.json` 绑定源码、二进制、编译参数和参考指纹。因此此固定边界无 soundicon 分支。这里只排队嵌入命令，未执行后续合成改变速度；完整 TranslateClause/CLI 跨句集成必须接入真实当前速度，不能永久写死 175。

## 明确的不支持边界

首次遇到下列**实际执行到的**分支，`next()` 抛出错误，不返回部分 clause：

| `reason` | 触发边界 |
|---|---|
| `punctuation-name-dictionary` | 未注入 dictionary，但实际路径访问省略号或公告名称 |
| `punctuation-special-dictionary` | 注入服务缺少句末 period 所需的 lookupSpecial |
| `character-name-translate-rules-character` | 当前服务缺少字符 TranslateRules，例如公告 `+`、全角句读 |
| `character-name-*` | 字符名称服务报告的真实原版音素/重音/解码缓冲边界 |
| `punctuation-special-capacity` / `punctuation-name-capacity` / `punctuation-announcement-capacity` | 名称超过原版 30/74/200 字节含 NUL 局部缓冲容量 |
| `dictionary-output-capacity` / `control-capacity-overflow` | 名称或控制插入超过 source/charix 边界 |

错误的 `name='UnsupportedReadClauseError'`、`code='READ_CLAUSE_UNSUPPORTED'`；还提供 `reason`、`codepoint`、`clauseIndex` 和出错时 `state`。错误使该会话失效，后续 `next()` 重新抛出同一个错误对象，`hasMore()` 为 false。调用者必须捕获错误并报告，不能把已失效会话的 false 当成成功 EOF。

这是按执行路径拒绝，而不是预先扫描输入的字符黑名单：`[[...]]` 内的点不会进入标点读名字典分支；第一个输入 NUL 后的字节不可达；畸形 UTF-8 解码为 0x01 时依然按实际嵌入控制路径处理。此前已返回的 clause 保持有效，但整段输入不得因此计为全部支持。

SSML、其他 voice/encoding、通过 options 修改 capitals/punctuation、sayas/silence、lineLength、skip/end position 等不属于此接口。当前实现不导出 `startWord`：该字段依赖下游 `count_words`，连续直接 ReadClause 差分不等于完整多 clause TranslateClause 集成。后续须补剩余字符规则依赖与完整调用者状态后，再验收完整 M02。

## 验证与可追溯性

固定上游 commit：`ba90c8e9f440ad544f674a790bb5f53878b6ffc5`。主要对应：

- `readclause.c:89` 的 clause 分类，`:143` 的 Eof/GetC/UngetC，`:441` 的 IgnoreOrReplaceChar/CheckPhonemeMode，`:466` 的 ReadClause，`:981` 的 InitText2，`:1011` 的终止写入。
- `translate.c:108` 的 source 存储，`:1064` 起的 charix/调用者初始化，`:1968` 的 InitText。
- `translate.h:44` 的 N_TR_SOURCE 与 CLAUSE 位图、translator 字段定义；`tr_languages.c:168` 的默认忽略字符表及实际语言设置。

核心移植保留 GPL-3.0-or-later 来源与版权说明；许可见 `licenses/espeak-ng/COPYING.txt`，Unicode 数据许可见 `licenses/espeak-ng/COPYING.UCD.txt`。

```sh
node --test tests/read-clause.test.mjs
node tools/oracle/clause-build.mjs
node tools/oracle/clause-selfcheck.mjs
node tools/compare/clause.mjs
node tools/compare/read-clause-names.mjs
```

17 项单测检查完整 Hello 记录、回退状态、UTF-8 charix、默认忽略项、段落/缩写/数字、亚美尼亚 tone、phoneme mode、不支持错误、容量边界、BOM/NUL/空输入、输出所有权和固定选项。独立差分使用真实 C ReadClause，逐字段比较 sourceHex、charix、charixTop、terminator、tone、voiceChangeHex、startCharacter 与前后状态，不拿预录答案填充 JS 状态。

综合输入包含既有 smoke corpus、标点/Unicode/容量窗口、所有首字节、畸形序列与固定 seed 文本/原始字节。`tools/compare/clause.mjs` 生成 `artifacts/clause-differential-*/requests.json`、`results.json`、`report.json`；失败保存 `failure.json`。例外通过tools/compare/clause-exceptions.json绑定具体输入SHA256、原因、码点和clauseIndex，其余样本不得自动降格为不支持。还校验错误状态与输入必要证据，新增seed碰到未知缺口会失败并要求审查。历史首版639输入中598完整exact、41登记缺口，详细证据见 [M02.1验收](build-results/2026-10-05-m02-clause.md)。报告保留输入、文件 SHA256、C reference/profile、精确通过数与不支持项，状态为 `passed-supported-slice` 且 `coverageComplete=false`，不能把不支持项算作完整兼容通过。

最新带真实 dictionary 的名称专项差分为 `artifacts/read-clause-names-gWUcEq/report.json`：225 输入，217 exact、262 个完整 clause 的 source/charix/terminator/tone/voiceChange/前后状态一致，8 项为固定输入绑定的字符规则依赖。覆盖所有已知 ASCII 名称、重复 1–4 次、延迟公告、列表模式与模式切换、phoneme 绕过和 8 种省略号；不将首 clause 通过替代整段读取通过。tokenizer 端到端首 clause 报告见 [TOKENIZER.md](TOKENIZER.md)。

核心按调用分配有界 source/charix 工作缓冲及返回值副本，状态快照使用小对象；查询 Unicode/property 表复用模块级 TypedArray。本轮验证环境为 Node；新增的 `Object.freeze`、`TypedArray.prototype.slice` 等内建能力，以及核心集成后的设备内存与吞吐，仍须在 M12 做 Vela 验证。本轮无需为此重发已冻结的探针，也不以桌面差分结果替代设备实测。

# 原始词典运行时

`src/core/dictionary.js` 对应固定上游 `dictionary.c` 的 `InitGroups`、`HashDictionary`、`TransposeAlphabet`、`LookupDict2` 和 `LookupDictList`。`src/data/binary.js` 提供有界小端读取；核心没有文件、Node、DOM 或 Vela API。

数据采用原始编译词典加版本化 sidecar：`data/dictionary/en_dict.bin` 原样保留182152字节，`manifest.json` 包含magic、版本、固定上游commit、语言、长度、rules offset、SHA256和运行期hash32。`profile.js` 从固定源码导出288字节Latin转置表及数字常量。不是把词典转换成JS对象，也不是保存C查询答案。生成工具在 `tools/build-dictionary/`，主候选数据闭包仍以D1记录为准。

## 接口与所有权

```js
const dictionary = loadDictionary(bytes, manifest);
const session = createDictionarySession(dictionary, { lookupAccentedLetter });
const result = session.lookup(inputBytes, settings);
```

载入时校验版本/commit/profile/长度/hash32及结构边界，解析1024个bucket、7792个词条、72个双字节规则组、letter groups和替换表位置。`bytes` 由调用者持有，载入后不可修改；查询输出和repeat快照独立拥有存储，不引用词典底层Buffer。

`result` 包含 `found`、`Uint32Array(2) flags`、`Uint8Array phonemes`、`replacement`、`Uint8Array word` 和 `stateBefore/stateAfter`。状态含 `repeatCount`、`repeat`、`skipWords`；`resetRepeat()` 只重置原C的计数，不清除重复音素内容。

单词翻译集成可用 `setState({repeatCount,repeat,skipWords})` 保存/恢复副作用，传入的repeat字节会复制。`setContext(patch)` 维护共享 `dictCondition/expectVerb/expectVerbS/expectNoun/expectPast/prevDictFlags/clauseTerminator`，显式lookup settings优先；嵌套accent的Lookup也继承该上下文。`context()` 返回独立快照。clauseEnd是当前查询缓冲的相对位置，必须由相应调用者显式传入，不能把不同原C缓冲的地址比较猜成共享数值。

`settings` 对应原C输入上下文：`endFlags, wordFlags, flags0, flags1, dictCondition, expectVerb, expectVerbS, expectNoun, expectPast, prevDictFlags, clauseTerminator, clauseEnd, withWord, native, words`。默认condition=72；其余数值默认0，clauseEnd默认**原始输入byteLength**，native=true。`words` 是最多300项 `{flags,length}`，用于多词短语的强调检查。未传词表或withWord时，wordFlags不参与词表条件，保持原C的NULL wtab语义。

输入按C字符串遇NUL停止扫描，但默认clauseEnd保留原始字节跨度，不能错误替换成NUL之前长度。`TransposeAlphabet` 最大159字节；普通lookup保留原C按字节截断的词缓冲行为。无效UTF-8由内部原C scanner处理，不借宿主Unicode解码器纠正。

## 兼容细节

- Latin压缩只覆盖压缩后的字节数，原始后缀及NUL保持原位，原C的hash会继续读该后缀。例如hello变成 `20530c3c6f`，match width=68，hash=44；不能补写一个更早的NUL。
- 保留属性词条、条件位、大小写/句首句尾/词性、native、前后缀过滤，多词匹配与强调抑制、缩写合并、后缀重试、MAX3重复抑制和文本替换结果。
- LookupDictList返回textmode替换文本，完整递归翻译是TranslateWord的职责；本模块不把替换文本当成音素。
- `$accent` 通过同一session调用 `letter-accent.js`，共享repeat/skip副作用。实际触发但未提供的依赖有具名错误；不把失败变成成功。

## 验证

`node tools/compare/dictionary.mjs`：8399请求，7920次lookup与524次transpose全部C/JS一致；覆盖源en_list的5254个独立输入、939条件请求、568多词上下文以及词性、大小写、长词、非ASCII、嵌入NUL与固定seed随机输入。495请求另外比较原clean库，271请求验证新进程重复性，415项另走共享context接口验证。JS直接使用调用方原始settings，避免复制C规范化默认值掩盖接口错误。

独立复核另有792请求/912lookup与22项连续混合查询一致；复核发现并修复了默认clauseEnd处理NUL的差异。生成器在独立目录逐字节再生成一致。证据与hash见 [M03记录](build-results/2026-10-05-m03-dictionary.md)。

当前验收范围是固定en-us原始数据装载及字典决策；不代表M04完整word translator、动态语言闭包、设备内存或合成性能完成。

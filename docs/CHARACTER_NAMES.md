# 字符名与前端服务组合

`src/core/character-names.js` 对应原 `readclause.c` 的 `LookupSpecial`、`LookupCharName`、`DecodeWithPhonemeMode`。`src/core/letter-names.js` 对应 `numbers.c:LookupLetter`；它与accent模块的内部 `LookupLetter2` 是不同函数。

`createEnglishTextServices(loadedDictionary, selectedPhonemeTable, options)` 在 `src/core/text-services.js` 中组合共享的字典、accent、规则、字母名、词重音和字符名session，返回这些服务。调用者提供原始数据，核心不读文件。递归textmode可通过 `options.translateWord(buffer,{offset,sayAs})` 注入真实单词翻译。`createEnglishWordServices`（`src/core/word-services.js`）已接通实际TranslateWord回调及共享状态，无需调用方自行处理递归。

`options.initialState` 可注入repeatCount/repeat/skipWords、prevLastStress、词典上下文及规则的wordVowelCount/wordStressedCount/prePause。状态来源是原调用者的状态，不从待比较的C输出反推。模块setter验证后才修改，并复制外部字节数组。

ReadClause可注入 `options.dictionary = services.characterNames`。该服务提供：

- `lookupCharName(codepoint, only)`：返回原C的UTF-8音素模式字节，含 `[\x02...]]` 包装；only=true只查字符自身，空结果保持为空。
- `lookupSpecial(bytes)`：找到专用词条后返回同样的音素模式字节，否则null。
- `resetRepeat()` 和 `state()`：与所有嵌套查询共享原始repeat/skip状态。

原始8种ellipsis属性字符均走真实词典查询，结果为空；没有专门硬编码省略号答案。非空输出依次经过真实 `SetWordStress` 和 `DecodePhonemes`。原C局部音素和ASCII解码缓冲上限单独检查，超出时明确拒绝，不扩大原缓冲假装兼容。

`services.letters.lookupLetter(cp,{nextLetter,control})` 保留普通文本nextLetter=-1与拼读模式的区别：普通文本可能因只有underscore词条而静默；拼读保留space/31后继字节、空白数字名、accent及词重音处理。control按原C低位转发。

验证：原静态LookupCharName860项（含`+`）输出及共享状态exact；完整LookupLetter1536项exact，另768项accent组合exact。报告分别为 `artifacts/character-names-xAwXf8/report.json` 与 `artifacts/letter-names-gIoVqX/report.json`。以前110个textmode符号依赖已通过真实TranslateWord闭合，旧报告`letter-names-ThUnw8`保留为历史。

原Lookup的返回flags可能为0而音素非空，随后TranslateRules仍会追加。例如¢的拼读模式在原C读出两份cents；组合服务保留这一行为，不能因“看起来重复”而清空输出。连续请求比较同时覆盖共享repeat/skip和prevLastStress。直接字符服务未提供递归依赖时仍明确拒绝，不提供猜测答案。

Node比较入口 `tools/compare/character-name-services.mjs` 延迟读取原始en_dict/phontab，仅供验证；不属于平台无关运行期。

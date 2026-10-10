# LookupAccentedLetter

`src/core/letter-accent.js` 移植固定上游
`ba90c8e9f440ad544f674a790bb5f53878b6ffc5` 的
`numbers.c:LookupAccentedLetter`、`LookupLetter2` 及它们调用的
`dictionary.c:Lookup` 包装逻辑。运行时无 Node、文件 I/O 或 C 调用。

`data/accent/tables.js` 来自原 `numbers.c` 的实际静态表：160 个 Latin 条目、
89 个 IPA 条目、22 个 accent 名称、15 个非 ASCII 基础字母映射，以及原
`phoneme.h` 的 pause/stress 常量。生成器以 `#include "numbers.c"` 访问原静态
数据，不复制算法、不导出逐输入答案。manifest 记录原源码、静态库、全数据包、
生成器及输出 hash。

## 调用与共享状态

```js
let accent;
const session = createDictionarySession(dictionary, {
  lookupAccentedLetter: (cp, initial) => accent(cp, initial)
});
accent = createLetterAccentLookup(session);
const phonemes = accent(0xe9, new Uint8Array(0));
```

返回值是终结 NUL 前的 `Uint8Array`。原 C 在没有动作的路径不清空已有 buffer，
因此 `initial` 被保留；输出不会修改调用者数组。原上界条件排除 U+017F，虽原表
含这个条目，也不应把它补进有效范围。嵌套 accent/letter 查字典必须使用同一
session，以保留 `phonemes_repeat`、repeat count、skip words 的真实副作用。

可选配置为 `{accents, dictCondition, translateWord, translateRules}`。默认来自
初始化后的固定 en-us profile：`accents=0`、`dictCondition=72`、phoneme table 80。
覆盖 options 只影响相应明确传入的 profile 值，不隐式更换语言或表。

## 后续依赖接口

返回函数附带 `lookupSymbol(bytes)` 与 `lookupLetter(cp)`，分别返回
`{flags,phonemes}` 与 `Uint8Array`。`lookupSymbol` 保留原 Lookup 的
`FLAG_LOOKUP_SYMBOL`、`FLAG_ALLOW_TEXTMODE` 和 flags 返回语义。

遇到文本替换时调用：

```js
translateWord(buffer, { offset: 3, sayAs: 0 })
// -> { flags: uint32, phonemes: Uint8Array }
```

buffer 是原 80 字节布局，开头 `[0,32,32]`，最多复制 76 字节替换文本，
尾部 NUL；依赖实现负责按临时 `sayAs=0` 执行并恢复自己的 caller 状态。
未提供该依赖时抛出 `ACCENT_UNSUPPORTED / translate-word-textmode`。

若 `_letter` 和 `letter` 都没有字典读法，调用：

```js
translateRules(buffer, { offset: 2, capacity: 20, wordFlags: 0 })
// -> Uint8Array
```

buffer 含原字母前导 `[0,32]`、原 UTF-8 字母、空格和 NUL；输出须小于 20 字节。
未提供时抛出 `ACCENT_UNSUPPORTED / translate-rules-letter`。实际固定 en-us
原表中 U+0252 触达这个分支，其余已覆盖的有效条目不依赖它。不能将原 C 为
U+0252 算出的音素缓存成运行时答案。

## 构建和验证

```sh
node tools/build-accent/build.mjs
node tools/oracle/accent-build.mjs
node tools/oracle/accent-selfcheck.mjs
node --test tests/letter-accent.test.mjs
```

C 参考仅链接原 clean 静态库，直接调用公开 `LookupAccentedLetter`。
请求 `{letters:[uint32 | {codepoint,initialHex}], accents?, dictCondition?}`，
每次新进程，数组内部按原顺序保留字典状态。最多 16384 项，初始 buffer
最多 159 字节。响应包含参考指纹、profile、规范化请求、音素 hex 和调用前后字典状态。

正式自检比较整个 U+0000..U+02FF 区间及高位边界，排除并单列 U+0252；
组合 accents 0/1、空 buffer/含 NUL 的已有 buffer，共 3112 项输出和状态完全一致。
另比较真实字典 accent 入口的连续两次调用。具体实际 `FLAG_ACCENT` 分支计数
记录在报告 `dictionaryAccentComparisons`，普通字典入口计数不冒充回调覆盖。
这仍不是完整 `LookupLetter`、`TranslateRules`、`TranslateWord` 或语音合成实现。

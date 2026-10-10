# 派生字母与非 ASCII 数字

`src/core/derived-letter.js` 提供原 `numbers.c:IsSuperscript` 和
`translateword.c:NonAsciiNumber` 的直接移植，不扩展原表覆盖范围。

```js
isSuperscript(0x00b2) // '2' | 0x8000
isSuperscript(0x2082) // '2' | 0x4000
nonAsciiNumber(0x0665) // ASCII '5'，即 53
nonAsciiNumber(0x0251) // -1
```

两个函数接受 C int 或 uint32 位模式，并按原 int32 解释。
`isSuperscript` 未命中返回 0，命中返回基础字符加 `L_SUP=0x8000` 或
`L_SUB=0x4000`。`nonAsciiNumber` 返回 ASCII 数字 48..57，未命中为 -1。
ɑ 和 Deseret 不在派生字母表中，其名称回退由词级服务处理。

`data/derived-letter/table.js` 通过包含原始 translation unit 导出实际静态
数据：62 个 derived pair 加 sentinel、16 个数字区段起点加 sentinel、
6 个十六进制字母的原音素 mnemonic、4 个 modifier 项。运行时还导出
`HEX_LETTER_NAMES`、`DERIVED_MODIFIERS` 与 `DERIVED_CONSTANTS`，方便
字符代码回退使用原配置；这些不是逐输入计算后的发音答案。

```sh
node tools/build-derived/build.mjs
node tools/oracle/derived-build.mjs
node tools/oracle/derived-selfcheck.mjs
```

构建保留原源码、库、生成器和数据 hash。参考 helper 直接调用原库公开的
`IsSuperscript`，并包含原 `translateword.c` 以调用其静态 `NonAsciiNumber`，
无算法副本。报告 `artifacts/oracle-derived-zQjtOX/report.json` 对 65,545 个
码值同时比较两个函数：完整 BMP 加高位和 signed 边界全部一致，实际命中
62 个派生字母和 160 个非 ASCII 数字。每批原 C 重复运行两次。

# 字节失败缩减器

`tools/fuzz/minimize-bytes.mjs` 提供 M00 的确定性、仅删除输入的失败缩减基础设施。它不生成语料，不修改当前 Oracle 语义语料，也不证明 C/JS 兼容性。现有 clean/instrumented Oracle 尚未观察到需要缩减的真实分歧；单元测试使用明确植入的谓词验证缩减行为。

## API

```js
import { minimizeBytes } from '../tools/fuzz/minimize-bytes.mjs';
const result = await minimizeBytes(inputBytes, predicate, {
  maxAttempts: 256,
  maxInputBytes: 65536,
  timeoutMs: 10000,
  predicateTimeoutMs: 1000,
  validUtf8: false
});
```

`inputBytes` 必须是 Uint8Array（可传 Node Buffer）。谓词接收独立字节副本和 `{ signal, attempt }`；可同步返回或返回 Promise。只允许两种正常结果：

```js
{ status: 'pass' }
{ status: 'fail', category: 'semantic', signature: 'phoneme-output' }
// category 也可为 'trace'，signature 是调用方定义的稳定非空标识。
```

初始输入必须先复现已分类失败。后续候选只有在 `category` **及** `signature` 与初始结果完全一致时才接受。不同签名/类别的失败不会替换当前反例。缺失可执行文件、编译失败、进程调用失败、schema 校验失败和参考元数据不匹配，应由谓词抛出异常；缩减器原样传播，不把这些异常算成语义失败。布尔值或未支持的分类对象会被拒绝。

默认算法对原始字节按从左到右的顺序分区删除。每次接受都严格减少字节数；不会修改、补齐、归一化或重新编码输入。输入、候选和当前已验证结果相互隔离，谓词改写参数不能把其他字节注入缩减结果。

`validUtf8:true` 首先用 fatal UTF-8 解码验证初始字节，再只在完整 UTF-8 标量编码边界删除。它不猜词界、语言或字符语义，也不重写 BOM/NUL；无效 UTF-8 初始输入直接拒绝。测试解码器对损坏输入的行为时应保留默认字节模式。不要把有效模式筛选后的输入声称为原始字节 fuzz 覆盖。

结果包含：

- `bytes`：最后一个复现初始类别/签名的输入。
- `originalBytes`、`attempts`、`accepted`：原长度、谓词调用数、严格缩短次数。初始复现占用一次 attempt。
- `failure`：初始失败的 category/signature。
- `unit`：`bytes` 或 `utf8-scalars`。
- `reason`：`one-minimal`、`attempt-budget`、`time-budget` 或 `predicate-timeout`。

`one-minimal` 表示不能再删除任意单个选定单位而保留相同失败；不保证全局最短反例。预算耗尽/候选超时只返回此前已验证反例，不接受尚未完成的候选，也不宣称达到最小。初始复现超时则抛错，因为尚无可返回的已验证失败。

固定输入、固定确定性谓词与相同调用次数预算会产生相同的删除顺序和结果。墙钟期限受机器负载影响，不承诺每次在相同候选停止。谓词自身负责稳定地分类结果；此模块不通过重复运行判定偶现错误。

超时通过 Promise 竞争和 AbortSignal 实现；超时后不再提交新候选。谓词必须响应 signal、释放句柄，并给它启动的子进程设置超时。**同步阻塞的 JS 无法被此计时器抢占**：返回后会拒绝超时结果，但不提供硬实时停止保证；忽略 signal 的后台子进程也不会自动被杀死。

## CLI

CLI 显式加载用户选定的可信 Node ES module 的 default 导出，不拼接 shell 命令，也不把任意非零退出码映射成 bug：

```sh
node tools/fuzz/minimize.mjs \
  --input /path/to/failing-input.bin \
  --predicate /path/to/classified-predicate.mjs \
  --output /path/to/new-reduced.json \
  --max-attempts 256 --max-input-bytes 65536 \
  --timeout-ms 10000 --predicate-timeout-ms 1000
```

可加 `--valid-utf8`。输入/输出路径由调用者提供；仓库提供的真实 Unicode decoder 谓词见下节。输入必须是容量内的普通文件，在读入前检查长度；输出必须是新文件，已有目标会被拒绝覆盖。

JSON 包含失败签名、停止原因、调用数、初始字节 SHA256、可信谓词模块路径/SHA256、可选 `predicate.metadata`，以及 `input.utf8Hex`。CLI 在执行前后核对谓词模块未改变。该 hex 字段保留原始字节，包括 NUL 和无效 UTF-8。返回预算耗尽但保留有效反例时 CLI 正常退出，必须看 `reason`；谓词错误、初始不复现、初始超时、导入/参数/输出错误均非零退出。

本地验证：

```sh
node --test tests/fuzz-minimize.test.mjs tests/fuzz-unicode.test.mjs
```

测试覆盖植入的 NUL 标记故障、类别/签名漂移、预算确定性、空输入、无效字节、有效 UTF-8 边界、参数副本、超时和 signal、基础设施异常传播、真实 CLI 子进程及拒绝覆盖输出。

## 真实 Unicode decoder 适配入口

`tools/fuzz/unicode-decode-predicate.mjs` 的 default 导出是可直接传给 CLI 的可信谓词。它使用 `createUnicodeOracle()` 验证固定 C helper 的源码/库/二进制来源，然后比较该 C helper 的 decode 结果与真实 `jsDecode`。默认 termination 为 **c-string**；没有自动推断模式。

对已经确认能复现的原始失败字节，可执行：

```sh
node tools/fuzz/minimize.mjs \
  --input /path/to/confirmed-failure.bin \
  --predicate tools/fuzz/unicode-decode-predicate.mjs \
  --output /path/to/new-reduced.json \
  --max-attempts 256 --timeout-ms 60000 --predicate-timeout-ms 35000
```

**当前真实 C/JS 解码比较一致**。给正常输入运行上面的命令会因“初始输入不复现”拒绝输出，这不是工具故障。测试中缩减到 `41` 的案例刻意把 JS 的 `A` 字段变成 `B`；生产模块和 C helper 未植入该错误。

需要显式 bounded 或 nul-terminated 模式时，用可信模块包装工厂：

```js
import { createUnicodeDecodePredicate } from '/absolute/project/tools/fuzz/unicode-decode-predicate.mjs';
export default createUnicodeDecodePredicate({ termination: 'bounded' });
```

适配器通过只读 `predicate.metadata` 提供固定 C reference（上游 commit、trace/helper 指纹）、UTF-8 模式，以及 JS core、表模块、表 manifest、观察包装器和适配器本身的 SHA256；CLI 将这些身份写入 reduced.json。候选之间 reference 不同或 JS 依赖字节改变会抛出基础设施错误。测试注入时 metadata 明确标记 `testInjection:true`。

工厂的 `oracle`/`decode` 参数仅供测试依赖注入；CLI 不提供替换真实 Oracle 的选项。适配器先检查 C 返回 envelope、双方 decode schema、输入/缓冲长度、peek/cursor/EOF 状态，再把有效观察的差异分类为 semantic。稳定签名形如 `unicode-decode/c-string/steps.codepoint`，包括模式与首个差异字段，不包括移动的事件下标、字节 offset 数值或具体字符。

构建缺失、schema/游标不合法、JSON/进程调用错误和参考 envelope 异常直接抛出，不作为可缩减语义失败。因此当前适配器专门处理**双方有效 decode 观察之间的分歧**；需要追踪无效状态自身的实现缺陷时，必须另定明确分类契约，不能放宽为“任意异常都算 bug”。

稳定 C helper 当前使用同步受限子进程（每次至多 30 秒）。适配器会在调用前后检查 AbortSignal，但不能中途抢占同步调用；上面的 35 秒 predicate 限额给该边界留出余量，整体 60 秒仍是协作式预算。初次来源验证也计入缩减器时间预算。

要求真实 helper 必须存在的独立复验命令（缺失或来源不符会非零退出，不会 skip）：

```sh
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { createUnicodeDecodePredicate } from './tools/fuzz/unicode-decode-predicate.mjs';
const predicate = createUnicodeDecodePredicate();
assert.deepEqual(predicate(Buffer.from('Hello world.')), { status: 'pass' });
assert.equal(predicate.metadata.testInjection, false);
console.log(JSON.stringify(predicate.metadata, null, 2));
JS
```

普通 Node 测试不强制构建 C helper；缺少 helper 时真实集成项明确 skip。存在 helper 时，集成项实际验证正常 C/JS 一致，并验证只在测试中注入的 JS 字段错误可被检测、缩减，同时保持相同签名。

## 与前端 trace 重放的区别

`tools/oracle/generate-trace.mjs` 当前保存 `failure.json` 并支持：

```sh
node tools/oracle/generate-trace.mjs --skip-upstream --replay /path/to/reduced.json
```

缩减输出的 `input.utf8Hex` 可作为该命令的重放输入，但**本次没有把完整 generate-trace 自动接成缩减谓词**。Unicode 适配器直接比较 decoder，不会把 decoder 验收冒充 clause/规则/音素等全部 trace 验收。

完整前端 Oracle 保存的是统一异常栈，其中可能混有构建/调用/schema 问题。后续接入必须按真实音素/PCM或有效 trace 差异显式分类，保留上游/构建/数据身份并限制子进程；不能凭任意退出码或 error 文本驱动删除。

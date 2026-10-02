# jSpeak 设备探针 0.1.0

目标：Redmi Watch 5，432×514，`designWidth: 432`。本版不是 TTS，不含 eSpeak 数据或合成器。

## 本机构建

```sh
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build
```

产物：`apps/vela-probe/dist/org.jspeak.probe.debug.0.1.0.rpk`。

使用 aiot-toolkit 开发签名。由用户自行安装到自己的设备；不提供设备密钥提取。重建包含打包时间及签名元数据，RPK 整包哈希不承诺重复构建相同；以每次交付的 SHA256 为准。

## 真机操作

1. 安装并打开，确认标题 `jSpeak 探针 0.1.0` 与静态 UI READY 可见。页面可滚动，测试结果在按钮下方。
2. 点 **能力检查**，向下滚动截图 TypedArray / DataView / Math.imul / shift 各项结果。
3. 点 **设备信息**，截图型号、系统版本、API 版本。也可从设备设置补充完整固件号。
4. 点 **读取 64KiB 资源**。PASS 表示 API 返回的全部字节符合预期，不代表测得可用内存上限。
5. 点 **分片计算**。32 个分片，每片 2048 次整数运算，片间请求等待 10ms。记录总耗时、最大分片耗时、最大调度间隔及 hash。总时间包含主动等待，**不是 TTS RTF**。
6. 降低设备音量，再点 **播放两秒测试音**。记录是否实际听到声音、是否约两秒、是否卡顿。PLAY/ENDED 只表示收到事件，不等于人工确认听到声音。
7. 播放期间点 **停止**，观察是否及时停止；再播放一次，验证可重入使用。
8. 测试期间切到后台再返回，观察是否停止计算/音频、有无残留回调或崩溃。
9. 重复上述操作 3 次，报告结果是否稳定。

每次新测试会取消上一测试。默认没有自动 OOM 探测或长时间压力循环。10 秒没有完成事件会记录 FAIL timeout 并停止；如果系统事件循环被阻塞，定时器本身也会延后，不能把它当硬实时 watchdog。

## 结果解释

- `PASS`：该项已核验语义成立。
- `FAIL`：记录原始错误/超时；请截图，不默认归咎签名。
- `UNSUPPORTED`：缺少该项 JS 能力。
- `CANCELLED`：主动停止或被下一测试替换，非测试失败。
- `DONE`：运行完成；计算微基准、音频事件仍需人工解释。
- `PCM streaming UNVERIFIED`：已查音频文档没有原始 PCM buffer 写入方法。本版只试包内 WAV 文件播放；包内 URI/解码器的实际设备支持也需这次安装确认。

## 反馈模板

```text
探针版本 / RPK SHA256：
设备型号 / 固件：
安装成功：是/否（错误截图）
静态 UI：
能力检查截图：
设备信息截图：
资源读取结果：
计算结果（含 hash）：
音频事件：
实际听到声音：是/否，时长约：
停止是否生效：
前后台切换：
重复三次：
其他异常：
```

## API 依据

查阅于 2026-10-02：

- https://iot.mi.com/vela/quickapp/zh/features/other/audio.html — `@system.audio`、`src`、`play/stop`、`onplay/onended/onerror`。
- https://iot.mi.com/vela/quickapp/zh/features/data/file.html — `readArrayBuffer`，包内 `/Common/...` 资源路径示例，success.buffer 为 Uint8Array。
- 项目自带 `vela-rpk-dev/SKILL.md` — CLI 流程、设备尺寸、UX 基本组件。

Node mock 生命周期测试只验证我们的状态逻辑，不能替代 Vela 渲染、系统 API 或音频硬件验证。

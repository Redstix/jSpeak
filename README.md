# jSpeak

面向 Xiaomi Vela 的 eSpeak NG 纯 JavaScript 兼容移植实验。

**当前未实现 TTS，也未证明设备实时可行。** 原始方案见 `design/stages/`，修订实施约束见 `docs/`。原始文档为历史基线；冲突以新的实施契约为准。

## 原则

- 合成核心不使用 WASM、原生扩展、Web Speech 或外部发音引擎。
- 构建/测试环境允许使用固定版本的上游 C 工具；设备适配层允许使用系统音频 API。
- 单 voice 先行，首发候选 `en-us`；精确 voice 配置须随上游锁定。
- 未验证、未实现、不支持必须明确区分，不以占位值假装通过。
- 不把普通 JS 微基准当作 TTS 实时性能结论。

## 开发

Node.js 24；使用 Node 内置测试运行器，无核心运行时依赖。

```sh
npm test
```

设备探针将位于 `apps/vela-probe/`，由用户安装 RPK 后反馈结果。源码提交不包括本地会话、私钥、上游 checkout、依赖及构建产物。

## 实施与状态

- [兼容性约束](docs/COMPATIBILITY_SPEC.md)
- [Trace 协议](docs/TRACE_FORMAT.md)
- [运行时与设备门槛](docs/RUNTIME_PROFILE.md)
- [源码映射](docs/SOURCE_MAPPING.md)
- [进度与证据](docs/STATUS.md)

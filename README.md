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

设备探针位于 `apps/vela-probe/`，六轮真机测试已记录；0.4.0 的真实数据装载/候选驻留和22050Hz两路播放已确认。0.4.1修复后按钮9/10的增量WAV写入、头回填、完整读回/播放/清理及听感已通过，见[第六轮记录](docs/device-results/2026-10-05-probe-0.4.1.md)。安装与逐行反馈步骤见 [探针说明](apps/vela-probe/README.md)。

```sh
npm run oracle:build  # 固定版本的 C 参考程序
npm run test:oracle   # 22 例 C 自身重复性检查，不是 C/JS 兼容测试
npm run oracle:trace:build  # 隔离构建内部前端观察补丁，保留原参考构建
npm run test:oracle:trace   # 50 例 clean/instrumented 对照与上游 CTest
npm run oracle:unicode:build # 在已有双构建上链接独立 C Unicode 参考
npm run test:oracle:unicode # C Unicode 参考的双库一致性检查
npm run unicode:build      # 从固定 Unicode 11.0.0 C 数据生成运行期表
npm run test:unicode       # M01 C/JS 解码与全码点分类/编码差分
npm run oracle:clause:build # 独立原 C ReadClause / 标点属性参考
npm run test:oracle:clause  # C 双库/重复调用自检，可传 -- --trace-dir <已存trace目录>
npm run test:clause:properties # 全码点原始标点属性 / clause type 差分
npm run test:clause         # M02.1 ReadClause 差分，显式列出未支持依赖
npm ci --prefix apps/vela-probe --registry=https://registry.npmjs.org
npm run probe:build   # 先生成/校验真实数据，再打包当前探针版本
npm run probe:source  # 当前项目及固定上游源码交付副本
```

源码提交不包括本地会话、私钥、上游 checkout、依赖及构建产物。参考程序说明见 [Oracle harness](tools/oracle/README.md)。

## 实施与状态

- [最终实施计划](docs/DEVELOPMENT_PLAN.md)
- [交接入口](docs/HANDOVER.md)
- [D1 数据包](docs/DATA_PACK.md)
- [M00 Trace Oracle 实现](docs/ORACLE_TRACE.md)
- [M01 Unicode 实现与验收](docs/UNICODE.md)
- [Unicode C 参考](docs/ORACLE_UNICODE.md)
- [M02.1 ReadClause 接口](docs/READ_CLAUSE.md)
- [M02.1 标点属性](docs/CLAUSE_TYPE.md)
- [字节失败缩减器](docs/FUZZ.md)
- [源码交付与离线恢复](docs/SOURCE_BUNDLE.md)
- [兼容性约束](docs/COMPATIBILITY_SPEC.md)
- [Trace 协议](docs/TRACE_FORMAT.md)
- [运行时与设备门槛](docs/RUNTIME_PROFILE.md)
- [源码映射](docs/SOURCE_MAPPING.md)
- [进度与证据](docs/STATUS.md)

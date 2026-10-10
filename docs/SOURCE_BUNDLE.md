# 本地源码交付包

`npm run probe:source` 将当前已跟踪及未忽略的项目源码、固定上游源码和恢复上游 Git 身份所需的 bundle 写入 `artifacts/probe-<version>-sources/`。manifest 记录当前项目 HEAD/dirty、每个源码文件 SHA256 和全部产物 SHA256。代码尚未提交时，以这个实际源码快照为交付依据。

交付文件：

- `jspeak-source.tar.gz`：实际项目源码、生成的 Unicode 表、测试、文档与许可。
- `espeak-ng-source.tar.gz`：固定上游的纯源码副本，便于检查。
- `espeak-ng.git.bundle`：固定公开上游 HEAD 及其可达 Git 对象；用于离线恢复原 commit。它不包含本机 Git 配置、凭证或 hooks。
- `manifest.json`：上述文件身份及逐文件清单。

上游工具会核验原 commit 和干净工作树，因此**仅解压上游 tar 包不够**。在新的目录恢复项目后，用 bundle 建立上游 checkout；不要先把 tar 解压到相同目标目录：

```sh
mkdir restored-jspeak
tar -xzf /path/to/delivery/jspeak-source.tar.gz -C restored-jspeak
cd restored-jspeak
git clone --no-checkout /path/to/delivery/espeak-ng.git.bundle upstream/espeak-ng
git -C upstream/espeak-ng checkout --detach ba90c8e9f440ad544f674a790bb5f53878b6ffc5
git -C upstream/espeak-ng status --porcelain
npm run oracle:build
npm run oracle:trace:build
npm run oracle:unicode:build
npm run test:unicode
```

源代码与上游 Git 恢复不需要网络。工具链需具备 README/Oracle 文档列出的 Node、CMake、C/C++ 编译器等；Vela 的 npm 构建依赖不打包在源码交付物内，需要按 lockfile 安装。

探针构建参照 [DATA_PACK](DATA_PACK.md) 与 [探针说明](../apps/vela-probe/README.md)。重新构建会生成新的可见 stamp，不承诺与既有 debug RPK 的 ZIP 字节相同；真实数据/音频的确定性和源身份通过 manifest 另行验证。

交付包不含设备照片、密钥、已安装依赖或通常被忽略的产物。`git bundle verify` 及独立目录恢复后检查 HEAD、工作树状态和逐文件字节，才算验证了离线恢复；manifest 存在本身不等于恢复检查通过。

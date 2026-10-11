# Implementation status — 2026-10-05

执行基线：[最终实施计划](DEVELOPMENT_PLAN.md)。恢复入口：[HANDOVER](HANDOVER.md)。0.4.1增量写入、播放及听感通过。M01原语已验证；M02断句/分词/内嵌命令/标点读名在当前990输入中989 exact、1原C越界，0服务依赖缺口。M03固定en字典已验收；M04词级正式差分1372组中1370 exact、2原C UB；M05音素列表与M06整句到pre-MakePhonemeList已通过68组原CLI对照；M07完整MakePhonemeList、CalcPitches与CalcLengths已通过99子句两阶段全exact；M08音素VM 8200/8200 exact；M10固定en-us波形后端已在完整Generate命令计划上达到整句PCM exact；M11有界命令→PCM运行时已通过慢消费、长输入、取消重启与100次会话验收。完整文本→PCM、Vela文件播放与真机生命周期待M12。

## 已完成

- Git 原始资料基线，工作分支 `work/bootstrap`，无 remote/push。
- M00–M16 共 17 份原始阶段文档已由 `8f8d39e` 提交到 `design/stages/`；2026-10-05 审查逐份与 ZIP 比较，字节相同。
- 兼容性、trace envelope、运行时门槛与源码映射契约；最终计划已修正阶段编号、恢复顺序、22050Hz 采样率及分页策略。
- PCM16 比较器、严格 WAV 解析器与差异/格式边界测试。
- 固定 eSpeak NG `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，CMake Release 静态参考程序和数据构建成功。
- 2026-10-05 审查复跑：`npm test` 42/42；`npm run test:oracle` 22 例重复生成音素文本及 WAV hash 一致。空输入不生成 WAV 已记录。这是 C 自身稳定性检查，尚无 C/JS 兼容结果。
- 本轮 Oracle WAV 与 `phondata` 头均为 PCM 采样率 22050Hz；本地数据 `en_dict`=182152 字节、`phondata`=600104 字节，其他文件大小/hash 见最终计划 §2。
- D1 数据工具及 source lock 已实现，六个候选数据文件共 898009 字节；A1 固定 Oracle WAV 为 46424 字节、22050Hz。完整源清单含 383 文件；候选/完整 C 数据对照 26/30 一致（原22全过），动态词典依赖未闭合，见 [DATA_PACK](DATA_PACK.md)。
- probe 0.4.0 构建和独立解包校验通过，stamp `B261005T065730`；RPK SHA256 `68479bf28bf36e2949c34e173086e58fb3ecc63c6b9b3cbf1ccbbd371d8c2908`。实现 D1 全读/分页/驻留/组装及 A1 三种文件写入模式；设备结果已另行记录，见 [构建记录](build-results/2026-10-05-probe-0.4.0.md)。
- M00 隔离插桩构建、严格 schema/比较器、固定 seed 语料及全输入重放已实现；主代理复跑50例（200进程）音素/WAV/trace一致，上游CTest19/19；源checkout保持干净，见 [ORACLE_TRACE](ORACLE_TRACE.md)。
- 首轮集成验证72项Node单测通过；本轮新增 M01 与缩减工具后主代理独立复验 **100/100、0 skip**，见 [M01 本地验收](build-results/2026-10-05-m01-unicode.md)。这不代表完整M00、JS phonemizer或设备门完成。
- M01 已实现三种 UTF-8 长度模式、原始字节错误处理、UCD 11.0 分类/简单大小写与编码；2430个解码case、全部1114112码点和26项扩展分类 C/JS exact。运行期分类表68428字节，未测设备峰值。独立 C helper 全码点双库一致，见 [ORACLE_UNICODE](ORACLE_UNICODE.md)。
- M00 有界字节删除缩减器与真实 Unicode 差分适配入口已实现，保留失败类别/签名、C/JS 来源身份并传播基础设施错误；原始字节与有效 UTF-8 模式分开。刻意注入错误的 CLI 缩减链路独立验证通过，见 [FUZZ](FUZZ.md)。

- probe 0.4.0 的原始 OCR 已逐字归档，所有可读长度/hash均匹配；用户确认包内和整写两次播放相同、较清晰，见[第五轮设备记录](device-results/2026-10-05-probe-0.4.0.md)。
- probe 0.4.1 已构建并解包核验，stamp `B261005T075402`，RPK SHA256 `22353261d791b03eaf34283b03a1757cb77cc162c742842b57fe1ab1d2446604`；新增桥接行为回归后 **103/103、0 skip**，见[构建记录](build-results/2026-10-05-probe-0.4.1.md)。

- M02.1 固定ReadClause状态机、原始top12标点属性与独立C参考已实现；主代理复验639输入（598完整exact、41明确缺口）、1341次clause返回，全1114112码点属性/type差分，128/128 Node测试、0 skip。记录接口、分配、来源及例外，见[M02.1验收](build-results/2026-10-05-m02-clause.md)。

- M02 tokenizer、实际18条字符替换、内部UTF-8 scanner、embedded和真实标点读名已集成。最新990输入=989 exact、7390词条，另1个原C `ab - `+88韩文字导致的 `sbuf[800]` 越界已证并明确拒绝；0服务依赖缺口。完整直接ReadClause另864输入/1695次返回全exact。见[M02.2记录](build-results/2026-10-05-m02-text-services.md)。多clause word翻译调用者尚在集成，不能提前标完整M02/M06完成。
- M03固定en词典运行时已验收：8399请求、7920lookup、524transpose C/JS一致，含415项共享context核对；独立补查912lookup及22项连续查询，生成数据可逐字节再生。见[字典记录](build-results/2026-10-05-m03-dictionary.md)。
- 141张原始音素表、36096槽、46107解码case exact；19062词重音case exact；3112直接accent及32字典入口exact。现实际完整LookupLetter1536项+组合accent768项、LookupCharName860项（含+）均exact，先前textmode依赖闭合。见[字符名](CHARACTER_NAMES.md)。
- M04完整backing+offset规则2596项（146真实全缓冲上下文）及3397 AppendPhonemes exact；RemoveEnding8230项exact；Number/Roman1213项exact。EncodePhonemes跨141表226377项、derived/nonASCII digits65545点exact。各为原函数级证据，不代表整句引擎完成。
- TranslateWord3/WithBounds正式差分已完成：1372组、1370 exact、10661个词音素比较，0服务缺口；原KEY+0020前缀的两项越界由ASAN独立确认并单列。M05紧凑音素arena与TranslateWord2→clause调度已接通，M06整句到pre-MakePhonemeList在68组原CLI输入、99子句、712次Word2调用、3409个紧凑音素项全部exact，见[CLAUSE_TRANSLATION](CLAUSE_TRANSLATION.md)。M07完整MakePhonemeList输出在99子句、3430行全exact，见[MAKE_PHONEME_LIST](MAKE_PHONEME_LIST.md)。CalcPitches/CalcLengths及之后阶段未验收。
- M08音素VM已完成固定en-us可达切片：8200组C/JS exact，含phase 1 mutation、phase 2声音指令、条件与邻居查询；409项clean库重复对照。报告 `artifacts/phoneme-interpreter-MrD6Ky/report.json`。这不代表M07 prosody或M09 DSP完成。
- M07 prosody已完成固定en-us切片：CalcPitches与CalcLengths在99个真实CLI子句、3430行上两阶段全exact；显式注入真实embedded list，避免C全局初始化残留。见[PROSODY](PROSODY.md)与[M07记录](build-results/2026-10-06-m07-prosody.md)。
- M09 Generate高层事件已完成固定en-us逻辑切片：99个真实CLI子句、19994个高层合成事件全exact。观察器为暴露完整逻辑计划将`N_WCMDQ`放大为4096；原170项有界队列的满队resume和消费调度尚未验收。见[GENERATE_EVENTS](GENERATE_EVENTS.md)与[M09记录](build-results/2026-10-06-m09-generate-events.md)。
- M10固定en-us波形后端已完成：67个非空输入、99 clause、15449条Generate命令、6344247个样本与C Oracle默认PCM逐点exact；1/7/64/1323/4096样本分块拼接一致，PCM工作缓冲不随输出时长增长。SPECT/SPECT2/WAVE/WAVE2/PAUSE/AMPLITUDE/PITCH/EMBEDDED/MARKER均已覆盖，profile外后端显式unsupported。见[WAVE_GENERATOR](WAVE_GENERATOR.md)与[M10完整验收](build-results/2026-10-10-m10-wave-full.md)。
- M11有界命令→PCM运行时已完成：170命令窗口、4096样本chunk、最多4块在途PCM（32768B）、输入65536B/code point 16384/clause 256/中间命令100000显式上限；慢消费backpressure、1秒/30秒、5001命令长流、取消重启、资源回收和100次会话无串扰通过。接入运行时后M10全量仍67/67 exact。见[M11验收](build-results/2026-10-10-m11-bounded-runtime.md)。

## 设备事实汇总

| 轮次 | 已证事实 | 证据 |
|---|---|---|
| 0.1.0 | 被测 TypedArray/DataView/Math.imul/shift 语义可用；包内预置 16000Hz WAV 实际出声 | [第一轮](device-results/2026-10-02-probe-0.1.0.md) |
| 0.2.0 | internal 64KiB 二进制 I/O；JS 生成 64044 字节双音 WAV 写入/全字节读回/播放，用户确认低音—停顿—高音 | [第二轮](device-results/2026-10-02-probe-0.2.0.md) |
| 0.3.0 | 包内 `.txt` readText/readArrayBuffer 成功；internal 部分读成功；构建审查修正 copy 参数 `dstUri` | [第三轮](device-results/2026-10-04-probe-0.3.0.md) |
| 0.3.1 | `.txt` 名二进制 64KiB/256KiB 全读及 2KiB 包内切片校验通过；包内源 copy/access 路线关闭 | [第四轮](device-results/2026-10-05-probe-0.3.1.md) |
| 0.4.0 | 600104B真实phondata全读、32KiB分页/边界/EOF、898009B候选驻留/组装；22050Hz包内和完整文件播放经听感确认；该版增量写入失败 | [第五轮](device-results/2026-10-05-probe-0.4.0.md) |
| 0.4.1 复测 | append/position及头回填均46424B全字节一致、onended、清理成功；用户确认清晰完整一致；转录未含READY页头 | [第六轮](device-results/2026-10-05-probe-0.4.1.md) |

当前结论：包内二进制采用 `.txt` 名原样打包直读；internal 保存运行期产物。当前候选集默认采用全读驻留；分页原语及组装可用，完整按需分页缓存尚未实现或验证。0.2.0 的“非扩展名问题”是被后续实验修正的历史推断，不再作为现状。

计算 hash `437906867` 两轮与本地一致。计算 #1 total 475ms、窗口和 67ms、maxSlice 4ms、首等 158ms、后续等待 p50/p95/max=8/9/9ms。双音生成 total 534ms、63 片、maxSlice 77ms；两者均不代表真实 eSpeak 合成 RTF。

## 未完成与限制

- M00 已覆盖 decode、clause、word table、部分韵律前音素；分类原语已有独立参考。M08 VM、M10 DSP与M11有界运行时切片已闭合，但仍缺完整文本流水线集成和更大规模完整回归语料。无效 UTF-8 固定 seed 差分与有界缩减基础设施已补，不能推广为完整前端或损坏二进制数据 fuzz。上游本平台已注册19项CTest通过；目标JS语言回归尚未导入为完整差分。
- M01原语和内部utf8_in/utf8_in2已分别按原函数移植验证；其他输入编码尚未覆盖。固定en-us前端到PCM各函数切片已通过，但完整文本→PCM运行时尚未集成。
- M02直接断句、词切分、替换表和embedded已实现，省略号可通过注入真实词典服务处理；未提供依赖仍明确拒绝。标点公告当前语料已闭合；完整word翻译后的词计数和多clause翻译集成已在pre-MakePhonemeList边界验收。记录的原C越界不能算JS兼容成功。
- D1 当前候选字节装载/驻留已实测；完整reader初始化、最终依赖闭包及容量上限未验证。候选至少缺 hy/ko/ar/hi 动态词典；assemble总耗时19764ms、hash14344ms、maxHashCopy685ms，保留性能调查。930777B是应用可见backing store计数，不是heap。
- A1 22050Hz包内和46424B完整WAV写入/读回/播放已实测。append139316B、position79236B的失败可由整backing写入模型精确复现，不能判定API不支持；0.4.1精确缓冲修复后两项46424B全字节一致且听感确认，见[第六轮](device-results/2026-10-05-probe-0.4.1.md)。容量上限、长句和文件队列未测。
- 文件播放已证，不依赖原始 PCM 播放 API；核心 PCM 分片、resume、有界队列/背压/取消已实现，但完整文本流水线、真实流水线RTF和文件队列仍待实现。
- 真实 DSP RTF、峰值 heap、连续文件间隙、完整取消/前后台、多轮稳定性、Files 分区容量均未证。无法测量的字段须记“不可测/未知”。
- ENDED 不等于出声；已记录的双音听感不能替代后续合成语音的用户确认。
- maxSlice 77ms 未定位；8–9ms 定时读数不构成硬实时保证。Node/mock 不证明 UX 渲染、平台契约或真实音频行为。
- 本轮构建依赖审计20项（3 low、17 high），历史14项见THIRD_PARTY_NOTICES，未盲目升级。探针已含四份上游许可，配套源代码可用`npm run probe:source`生成。
- M15 中文/其他语言首发延期，未完成；稳定性单列 S1，不再占用 M15 编号。

## 下一步

1. M12：连接数据、完整文本→PCM合成、文件写入与真机播放；补齐P1性能观察。A1按钮9/10短WAV写入/播放/清理已通过，无需重复本轮选项；D1的685ms hash峰值另轮调查，不能因可读可播宣称实时通过。
2. 继续完善数据动态依赖，不能因候选驻留成功宣称产品数据闭包完成。
3. M13→M14/S1：数据裁剪、优化与稳定性；M16 维护演练纳入首发，M15 延期。

不以文档存在代替功能完成，不以 harness 自检代替 C/JS 兼容通过，不把设备等待当作设备验收通过。

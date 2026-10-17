# Mandarin (cmn) support status

执行时间：2026-10-11，2026-10-17 收口更新。本页记录独立 `cmn` 数据 profile、固定上游锁、C Oracle 语料差分、tone/PCM 证据、完整 JS 文本→PCM 差分和显式 unsupported 边界。**Node 已闭合；真机中文听感仍只待用户确认。**

## 2026-10-17 收口更新

- `createCmnSynthesizer` 已接通完整 JS 路径：UTF-8 输入 → clause/tokenizer → cmn 词典与规则 → 音素列表 → `CalcPitches_Tone` → `CalcLengths` → Generate 事件 → Wavegen → PCM16。
- 固定 30 例差分：C 候选 phoneme **29 exact + 1 explicit unsupported**；JS phoneme **29 exact + 1 explicit unsupported**；JS PCM **29 exact + 1 explicit unsupported**。
- `你好，世界。`：JS 32,822 样本，WAV 65,688B，SHA256 `47e0c36e04e401b72ac884c1183e7dc09d59fb39384df93d1a9a8a701ccec9b1`，与 C Oracle 逐字节一致。
- `我会说普通话。`：44,089 样本，SHA256 `5cd5a35a4e1d10a675151506dfd63e24eb75559b3a24992f245eac1e5e32d0d0`，exact。
- `904-voice-switch-en-us`（`[[en-us]] hello`）仍为设计性 unsupported：独立 cmn 包不携带 `en_dict`，动态英文切换明确失败。
- 已构建 `org.jspeak.tts.debug.0.6.0-cmn.rpk`，RPK 1,066,129B、解包 2,736,927B、SHA256 `918fe6ac0b3b9a3c02eebf0ed5321b491c64be3122164964497113e31f5f4822`，数据 2,295,161B。**待用户真机验收。**
- 构建与 Node 性能/压力记录见 [0.6.0-cmn 构建](build-results/2026-10-17-tts-0.6.0-cmn.md) 与 [设备模板](device-results/2026-10-17-tts-0.6.0-en-cmn.md)。

## 当前结论

- 上游固定为 `ba90c8e9f440ad544f674a790bb5f53878b6ffc5`，语言代码使用 `cmn`，不使用 `zh` 冒充。
- 独立运行时候选保留 6 个原始上游文件：`cmn_dict`、`intonations`、`lang/sit/cmn`、`phondata`、`phonindex`、`phontab`，总计 2,295,161 字节。
- `cmn_list`、`cmn_rules`、`cmn_emoji` 是源输入锁；对应已编译运行时依赖是未修改的 `cmn_dict`。源输入不打包为另一种运行时格式。
- 设备资源格式仍遵循既有契约：所有包内二进制文件以 `.txt` 包装扩展名保存，内容保持上游原始字节，不压缩、不改写。
- 固定语料 30 例：29 例 full C data 与 standalone cmn 候选 phoneme/WAV exact；1 例显式分类 unsupported。2026-10-17 起 JS phoneme/PCM 也达到同样的 29/1 边界。
- `CalcPitches_Tone` JS 切片已完成：13 例、76 个 MakePhonemeList 后音素、`stresslevel/tonePh/pitch1/pitch2` 全 exact。
- 参考 WAV 为 `PCM16 / mono / 22050Hz`，文本 `你好，世界。`，65,688 字节、32,822 样本，SHA256 `47e0c36e04e401b72ac884c1183e7dc09d59fb39384df93d1a9a8a701ccec9b1`。

## 启用与复现

```sh
npm run language:cmn:build
npm run language:cmn:verify
npm run oracle:cmn-tone:build
npm run test:cmn-tone
```

生成物位于忽略目录 `artifacts/cmn-language-pack/`：

- `manifest.json`：原始文件 SHA256/页校验、profile 和数据指纹。
- `provenance.json`：上游提交、源输入、保留/排除文件、JS 运行时状态和许可来源。
- `candidate-comparison.json`：逐项 phoneme、tone token、PCM hash、样本数、诊断和分类。
- `*.txt`：`.txt` 包装的原始上游运行时数据。

开发期选择数据 profile 使用 `src/core/language-data-profile.js`：

```js
import { selectLanguageDataProfile } from './src/core/language-data-profile.js';
const cmn = selectLanguageDataProfile('cmn'); // cmn.jsRuntimeStatus === 'unsupported'
const enUs = selectLanguageDataProfile('en-us'); // jsRuntimeStatus === 'partial-m12'
```

`cmn` profile 可以独立选择并生成/校验数据包；`createCmnSynthesizer` 已可执行固定语料范围内的完整 JS 中文合成。en-us 与 cmn 均使用同一 Canvas/Generate/Wavegen 运行时；两者的 Vela/QuickJS 真机表现仍需分别验收。

## 差分结果

比较方式：同一固定 C 二进制分别使用完整 Oracle 数据和仅含 cmn 候选的数据根，参数固定为 `-v cmn -s 175 -p 50 -a 100 -b 1 -D --stdin`。每例比较 `-q -x` phoneme 输出和完整 WAV SHA256。表中 `PCM` 为候选与 full 的 SHA256 是否相同。

| ID | Input | Classification | Phoneme | PCM | Samples | Tone tokens | WAV SHA-256 |
|---|---|---:|---|---|---:|---:|---|
| 000-empty | empty | exact | exact | exact | 0 | 0 | - |
| 001-greeting | `你好。` | exact | exact | exact | 17,734 | 1 | `f29d2db0a4f47ee618ed13aff6e1818146277ddc26181dacf696fea85b6acad5` |
| 002-hello-world | `你好，世界。` | exact | exact | exact | 32,822 | 3 | `47e0c36e04e401b72ac884c1183e7dc09d59fb39384df93d1a9a8a701ccec9b1` |
| 003-weather | `今天天气很好。` | exact | exact | exact | 47,034 | 5 | `8fa52bebe7375669337b935a2acc6257924f09b37c4ead7208e4b2efafaebddd` |
| 004-self-introduction | `我会说普通话。` | exact | exact | exact | 44,089 | 6 | `5cd5a35a4e1d10a675151506dfd63e24eb75559b3a24992f245eac1e5e32d0d0` |
| 005-digits-one-to-ten | `一二三四五六七八九十。` | exact | exact | exact | 59,019 | 10 | `06e6d4ef6ead12a079939816a23d299d95afe6b18c163eff0f7ca9371d08d9ac` |
| 006-zero | `零` | exact | exact | exact | 14,891 | 1 | `d5b3ab6a9f390db7761158312ac722708d1d7458a29dfd1b16ee5256039fa333` |
| 007-number-101 | `一百零一。` | exact | exact | exact | 26,156 | 3 | `d589140b2e3dd6cbcbb78f9dc89b959ac463c7a299618125560386b86d87f3a0` |
| 008-date | `二零二六年十月十一日。` | exact | exact | exact | 57,219 | 10 | `cd111b7a87b634f73c82bd849050ed37e24417f7926f3a0590484b28a85d953c` |
| 009-time | `现在三点十五分。` | exact | exact | exact | 47,663 | 5 | `e04572c4cc31eb8eec8f454c3769c2e471f16bf37e8fd4020bee42b16c6259cc` |
| 010-pinyin-tone-digits | `ni3 hao3 shi4 jie4.` | exact | exact | exact | 28,378 | 4 | `e68b150a199c373ad59b649ed08841b0844e4d5bb1cf7d3b47a3d08ae15eacb6` |
| 011-pinyin-words | `zhong1 wen2` | exact | exact | exact | 22,840 | 2 | `ad3d4987c8cc0aab1ac6ffbd411bba8ef87c712c189d38dbe8c113c741bb6ebe` |
| 012-question | `你好吗？` | exact | exact | exact | 19,568 | 2 | `9957627794b251df5e5d952c7853f6c0784df604154e0a8a2c73e81835babf24` |
| 013-exclamation | `太好了！` | exact | exact | exact | 21,282 | 3 | `6faa655dbc2d2098f0600f5e5e2568054ebacef04203cf2f3bc8479b2438f68e` |
| 014-test | `中文测试。` | exact | exact | exact | 33,301 | 4 | `3ec3cb9c6784b3c8d664f8694a1503a239484444334e98f5a532f90bf31c8cf0` |
| 015-beijing | `北京欢迎你。` | exact | exact | exact | 38,146 | 4 | `02c97c8b8edb63c56deb2d730fdef64bcf16067a539d3ceae4e9a1800c90ac62` |
| 016-location | `请问洗手间在哪里？` | exact | exact | exact | 51,610 | 6 | `4f739e94290b46ffe49c3826952a51b8dffde61ca0097632465edb2c667aa5e3` |
| 017-synthesis | `语音合成测试。` | exact | exact | exact | 43,009 | 6 | `1af711c357960978f7ec86fd3cb21d4b576422447b590716c818e35360360013` |
| 018-world-short | `世界。` | exact | exact | exact | 18,416 | 2 | `0d640d3af2cbb2efad1ad5e758253064b27d019eee51c17f5830ec284e0f7a09` |
| 019-chinese-short | `中文。` | exact | exact | exact | 22,840 | 2 | `ad3d4987c8cc0aab1ac6ffbd411bba8ef87c712c189d38dbe8c113c741bb6ebe` |
| 020-welcome | `你好，欢迎来到语音合成测试。` | exact | exact | exact | 79,781 | 10 | `d026b0409a097dd20a7135ae4cf3fd0cf2ea344cf0313e1666376321b70685d5` |
| 021-first-test | `这是第一个中文语音测试。` | exact | exact | exact | 67,485 | 9 | `3bd32a464f0c9e6649885c08b7ea74cec5beb54ce4f316d0736e433c941d52af` |
| 022-thanks-goodbye | `谢谢，再见。` | exact | exact | exact | 33,783 | 3 | `8b085b589498321575fcb6215acc65b4012538d3399c44e278650ed4bf417b34` |
| 023-apology | `对不起，我没有听清楚。` | exact | exact | exact | 59,252 | 4 | `69266dd58e67443791d8f08f29d1408f4ab96340a924f941f0590b3aec2c0a7c` |
| 024-zero-character | `〇` | exact | exact | exact | 14,891 | 1 | `d5b3ab6a9f390db7761158312ac722708d1d7458a29dfd1b16ee5256039fa333` |
| 900-explicit-phonemes | `[[s.'i.]] 世界。` | exact | exact | exact | 23,877 | 3 | `35b2b4ec0e00ddfd898909e127ee578fb8ebdf62e9e3ce929e77734c6be52269` |
| 901-emoji | `你好😀世界` | exact | exact | exact | 39,362 | 5 | `5185f6620dd2dc647957e363a2440ef815712b8e44cebe5b8aa3c3a643457710` |
| 902-malformed-utf8 | bytes `e4bda0ff` | exact | exact | exact | 12,755 | 1 | `aa623a376ee317b4e507edc5f7a12a37a506e12b3c880ff471595931889c95eb` |
| 903-large-input | `测试` × 300 | exact | exact | exact | 2,735,351 | 466 | `a6d40fa49bac9c286cc1177e45cd88feaa3ed91a32820e6bc6ffe82bbe85e39c` |
| 904-voice-switch-en-us | `[[en-us]] hello` | unsupported-dynamic-en-us-dictionary | differs | differs | full 23,938 / candidate 16,585 | 2 | full `b32cfa7d4a821a6dae67782128577501e52a01999c46daf95c54164ac44f6e00`; candidate `750aa2558e11099050daa5a3744198830c35d6ce138aed2ba6c048199a5410c2` |

“Tone tokens” 是 phoneme 输出中包含数字调号的词/音节 token 计数；它不是对听感或 F0 轨迹的主观评分。完整 phoneme 原文在 `candidate-comparison.json` 中逐项保留。

## Explicit unsupported

`[[en-us]] hello` 在完整 Oracle 数据中会动态加载 `en_dict`。独立 cmn profile 刻意不包含英文词典，因此候选产生缺文件诊断、phoneme 和 PCM 均不同。该路径分类为 `unsupported-dynamic-en-us-dictionary`，不是失败被忽略，也不是通过。

## Tone prosody C/JS differential

`src/core/calc-pitches-tone.js` 移植固定上游 `CalcPitches_Tone` 的 Mandarin 分支，并从 `src/core/calc-pitches.js` 通过 `toneLanguage=1` 显式分派。C 参考在 `MakePhonemeList` 后输出 before/pitches 两个阶段，JS 使用 before 阶段重放，只比较 `CalcPitches_Tone` 实际写入的四个字段。

固定用例覆盖：无调号 promotion、35、55、15、51、214（6 例）；214+214、214+55、51+51 sandhi（3 例）；55+11、53+11、214+11 的 tone-5 level changes（3 例）；三音节连续（1 例）。

结果：13/13 exact，76 个音素，0 unsupported。请求 SHA256：`8c0a8500e0b0aa449af668784124fd33f195ae28f2db8c46ba67442b0956e2ae`。

这不是完整文本前端：输入是构造过的 `PHONEME_LIST2` 行，不证明 cmn ideograph/tone tokenizer、TranslateClause 或最终 Vela PCM。

## 未完成与验收边界

- **Node 固定语料已闭合，生产闭包仍为 false**：30 例 exact 只证明所选语料；动态词典切换、其他语言混排和未覆盖输入不能宣称支持。
- **真机中文出声未验证**：`0.6.0-cmn` RPK 已构建并通过静态/逐点校验，但没有设备听感记录。任何中文出声、清晰度或声调正确性结论都必须由用户确认。
- **设备资源未测**：设备 CPU、heap、RTF、首音、连续运行和文件间隙不可测/未知；Node 数字不能外推。
- **M13 数据最小化未做**：当前 cmn 数据仍保留完整共享 `phondata/phonindex/phontab/intonations`，未做裁剪优化。
- **显式 unsupported 必须保留**：`[[en-us]]` 切换缺 `en_dict` 是有意边界，不得被当作 exact 或静默回退。

## 待用户真机验收

1. 安装 `org.jspeak.tts.debug.0.6.0-cmn.rpk`，先核对页头 `READY 0.6.0-cmn A B261017T125827`。
2. 打开后先不点击，确认不闪退。
3. 点击 `合成 / 播放`，页面应显示六个数据文件读取、合成、WAV 写入/读回和播放事件。
4. 用户应听到普通话 `你好，世界。` 且无明显截断/失真；再测试 `连续 10 次`、`长文本` 与停止/重启。
5. 用户明确回复“0.6.0-cmn 真机中文出声通过/失败”后，才能更新状态。构建通过本身只写“待用户真机验收”。

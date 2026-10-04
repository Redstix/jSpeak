Worked for 25s

English translation of your question:

> Check this against the official documentation and actual community applications, for example https://github.com/youshen2/com.bandbbs.ebook/



我重新核对了官方文档，并直接检查了你给的 [`com.bandbbs.ebook` GitHub 仓库](https://github.com/youshen2/com.bandbbs.ebook?utm_source=chatgpt.com)。这里需要修正我上一条回答的一个重要倾向：

结论修正

社区实际项目并没有证明 /common/* 可以被 @system.file.readArrayBuffer() 读取；相反，这个项目的代码呈现出非常清晰的模式：

> /common/... 被当作 静态 App Resource，主要通过 <img src> 等资源引用机制消费；真正需要 JS 文件 I/O 的数据，则全部放到 internal://files/...。



这与官方 URI 模型是一致的。

但官方文档又明确声称 readArrayBuffer() 支持 App Resource path，因此 Redmi Watch 5 的行为仍然是一个值得注意的 官方 API contract 与实际实现之间的冲突。


---

1. 官方文档：/common 确实是 App Resource

小米官方当前 Vela 文档把：

/common/xxx

归类为：

> App Resources / 应用资源



并明确给出：

App Resources     /path
Files             internal://files/path
Mass              internal://mass/path
Temp              internal://tmp/path

同时：

> 应用资源也作为一个特殊的只读分区进行处理。





所以你的 RPK：

common/
    probe.bin
    foo.dat
    tone.wav

从 Vela 的抽象来看，确实应该属于：

App Resource

而不是：

internal://files

这一点是 A 级证据：官方文档。


---

2. 官方 readArrayBuffer() 的确写着支持 /common

这点非常关键，而且我重新确认了当前官方中文文档。

官方：

file.readArrayBuffer({
    uri: '/Common/demo.txt'
})

参数说明明确写：

> 本地文件路径，支持应用资源路径，例如：'/Common/demo.txt'



返回：

buffer: Uint8Array

错误码：

202 参数错误
300 I/O 错误
301 文件不存在



因此从官方 API contract 来说：

file.readArrayBuffer({
    uri: '/common/probe.bin'
})

并不能被说成“不受支持”。

这是我上一条回答中最重要的结论之一，重新核对后仍然成立。


---

3. 但 com.bandbbs.ebook 的实际代码非常有意思

这个仓库目前 n67 分支明确是一个：

> 喵喵电子书 MiaoReader Vela 端



README 说明它是给小米 VelaOS 的小米手环 / REDMI Watch 使用的电子书应用，并且明确链接了 Redmi Watch 5/6 的发布资源。

[查看 com.bandbbs.ebook](https://github.com/youshen2/com.bandbbs.ebook?utm_source=chatgpt.com)

我重点检查了它的：

src/common/
src/utils/
src/pages/


---

4. 社区项目对 /common 的使用：典型是静态资源

例如：

<img static src="/common/images/hd.png" />
<img static src="/common/images/back.png" />

以及：

<img static src="/common/images/enter.png" />

这些全部是：

/common/...

但是它们被用作：

UI Resource
    ↓
<img src>

而不是：

@system.file
    ↓
readArrayBuffer()

例如 textReader.ux 中就是：

<img static
     src="/common/images/hd.png"
     ... />

<img static
     src="/common/images/back.png"
     ... />

这实际上很好地印证了官方对 /common 的定位：

> 资源引用路径。




---

5. 真正的文件 I/O：这个项目全部使用 internal://files

这里证据更强。

例如：

const BOOKSHELF_URI =
    'internal://files/books/bookshelf.json';

然后：

file.readText({
    uri: BOOKSHELF_URI
})

以及：

file.writeText({
    uri: BOOKSHELF_URI,
    text: JSON.stringify(bookshelfData)
})

也就是说：

/common/images/xxx.png

用于：

静态资源

而：

internal://files/books/...

用于：

应用运行时数据

这是社区项目中的 B 级证据，而且是实际 Vela 应用，而不是博客文章。


---

6. 更重要的是：电子书这种大量数据也全部放 internal://files

interconnfile.js 更能说明问题。

它定义：

baseUri = 'internal://files/books/';

然后：

const bookUri = this.baseUri + this.currentBookDir;

书籍内容、章节、封面、索引等都写入：

internal://files/books/...

例如：

internal://files/books/<book>/book_info.json
internal://files/books/<book>/lindex.txt
internal://files/books/<book>/indexes/...
internal://files/books/<book>/content/...

而且大量调用：

file.readText(...)
file.writeText(...)
file.readArrayBuffer(...)
file.writeArrayBuffer(...)
file.access(...)
file.mkdir(...)
file.delete(...)
file.rmdir(...)

都针对：

internal://files/...

这一点非常重要：

> 一个真实的、功能比较重的 Vela 应用，需要二进制/大量动态文件 I/O 时，实际采用的是 internal://files，而不是试图把 /common 当作普通文件系统。




---

7. 但这里还有一个容易误判的地方

不能从：

> “这个项目没有 readArrayBuffer('/common/...')”



直接推出：

> “Vela 不支持这么做。”



因为官方文档明确声称支持。

因此证据关系应该写成：

官方 API contract
        │
        │ 明确声称
        ▼
readArrayBuffer('/Common/demo.txt')
        │
        │
        ├───────────────┐
        │               │
        ▼               ▼
理论上合法          社区实际项目
                    很少/没有这样用
                        │
                        ▼
                 /common → 静态资源
                 internal://files → File I/O

这两者不矛盾。

社区项目只是说明：

> 实际工程中大家通常把 /common 当资源，把 internal://files 当文件系统。



它并没有证明：

> /common 在 readArrayBuffer 中必然失败。




---

8. 反而可以用 com.bandbbs.ebook 排除一种猜测

你原来的实验：

/common/probe.bin → 202 invalid file type
/common/probe.dat → 202 invalid file type
/common/tone.wav  → 202 invalid file type

可能让人怀疑：

> 是不是 Vela 根据扩展名限制 binary？



但社区项目大量使用：

/common/*.png

而这些资源能够被 <img> 正常消费。

所以 /common 的核心不是：

extension → allowed / forbidden

而是：

resource URI
    ↓
由不同 API 的资源消费者处理

也就是说：

<img src="/common/a.png">

和：

file.readArrayBuffer({
    uri: "/common/a.png"
})

并不是同一个访问路径。


---

9. @system.file 本身又明确把两者区分开

官方文档有一个非常关键的细节：

writeArrayBuffer

明确：

> 不支持资源文件路径和 tmp 分区。





所以：

/common/foo.bin

本质上不是：

普通可写文件

而是：

App Resource
        ↓
read-only

而：

internal://files/foo.bin

才是：

Files
        ↓
read/write

社区项目的实践正好与这个模型一致。


---

10. 那为什么官方又允许 readArrayBuffer('/common/...')？

这才是现在真正的问题。

我认为目前最合理的解释不是：

> /common 就是普通 filesystem。



而是 Vela 的 file API 在抽象层面允许：

read-only resource
        ↓
readText / readArrayBuffer

但不同设备/runtime 对这个 contract 的实现可能不完整。

也就是说可能存在：

@system.file
                      │
            ┌─────────┴─────────┐
            │                   │
       internal URI        resource URI
            │                   │
      filesystem backend   resource backend
            │                   │
       read/write             read
                                │
                         ┌──────┴──────┐
                         │             │
                     readText    readArrayBuffer
                         │             │
                         ✓             ?

而你的 Redmi Watch 5：

resource URI
     │
     └── readArrayBuffer
             │
             └── 202 invalid file type

这很可能就是：

> Watch 5 上的 system.file resource backend 没有实现公开文档承诺的 readArrayBuffer 路径，或者实现了额外的 resource-type restriction。



目前这个判断我会标为 C+：强推断，但没有小米源码/官方 issue 直接证明。


---

11. com.bandbbs.ebook 对你的问题还有一个特别有价值的地方

它并不是一个简单 demo。

README 明确说这是一个完整的 Vela 电子书应用，具备：

章节系统

书签

书籍封面

阅读同步

阅读进度

存储管理

大量本地书籍数据




所以它实际上是一个不错的参考实现：

需求	com.bandbbs.ebook 的实际做法

UI 图片	/common/images/*.png
CSS	/common/style.css
App 静态资源	/common/...
书架数据	internal://files/...
书籍章节	internal://files/...
封面	internal://files/...
索引	internal://files/...
动态二进制/文件 I/O	internal://files/...


这与官方的资源/文件分区模型高度一致。


---

12. 所以我现在会把你的现象定性为

A 级：确定

/common/xxx

是 App Resource。

internal://files/xxx

是应用私有 Files partition。

官方 readArrayBuffer() 文档明确写明支持 App Resource URI。

B 级：社区实证

com.bandbbs.ebook 大量把：

/common/...

当静态资源使用；

而所有实际运行时文件存储基本都采用：

internal://files/...



B 级：你的设备实测

Redmi Watch 5：

/common/probe.bin → 202 invalid file type
/common/probe.dat → 202 invalid file type
/common/tone.wav  → 202 invalid file type

同时：

internal://files/... → read/writeArrayBuffer ✓

以及：

@system.audio('/common/tone.wav') → ✓

C+ 级：目前最佳解释

Watch 5 的 Vela runtime 对 App Resource URI 的 system.file.readArrayBuffer() 存在实际实现限制/兼容性问题。

不能说这是 Vela API 的设计限制，因为官方文档恰恰声称该接口支持 App Resource。


---

一个重要的后续实验

现在我认为最有价值的不是继续测 .bin/.dat/.wav，而是测：

/common/test.txt

然后同时：

file.readText({
    uri: '/common/test.txt'
})

和：

file.readArrayBuffer({
    uri: '/common/test.txt'
})

因为官方 readText 和 readArrayBuffer 都明确声称支持 App Resource。

如果 Redmi Watch 5：

readText('/common/test.txt')       ✓
readArrayBuffer('/common/test.txt') ✗ 202

那证据会非常强：

> 不是 /common 不可访问，也不是资源不存在，而是 Watch 5 的 readArrayBuffer implementation 对 App Resource 不工作。



如果连 readText 也失败，则方向会转向：

> Watch 5 这一 runtime 对 @system.file 的 App Resource 支持整体缺失/不同于当前公开文档。



这会比单纯的 .wav/.bin 测试有更强的诊断价值。
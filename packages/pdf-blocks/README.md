# `@anchor/pdf-blocks` —— PDF 拆块引擎

**职责**：把 PDF 的一页页文字（与图块位置）变成一条**逻辑块流**，再变成**一次可以发出去的提问**。
零 `vscode` / 零 pdfjs 运行时依赖 —— 输入是归一化坐标的纯数据，`node --test "test/*.test.ts"` 直测。

谁抽文字项、怎么抽（线2 webview 里的 pdf.js、线1 的无头 pdfjs-dist），引擎不关心：
它只认 `{ str, x, y, w, h }`（x/y 左上角、y 向下、全部归一化到 [0,1]，与 `@anchor/core` 的 bbox 同约定）。

## 入口

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 输入/输出形状：`TextItemIn` / `PageTextIn` / `PageImageIn` / `SplitInput` / `Block` / `BlockStream` / `Thread` / `ThreadStore` |
| `src/lines.ts` | 第一步：文字项 → 行（两个容差量级：`COLUMN_GAP_FACTOR` 1.2 / `LINE_GAP_FACTOR` 2.5） |
| `src/columns.ts` | 第二步：按 item **左边缘直方图**切栏（`partitionItems`，主路径）+ `detectColumns` 行级兜底 |
| `src/blocks.ts` | 第三步：栏内行 → 块（段落三判据、标题、连续短行归并、页眉页脚掩码） |
| `src/order.ts` | 第四步：页内阅读序（双栏先左后右，通栏按 y 插入） |
| `src/stitch.ts` | 第五步：跨页缝合（保守四判据 + `unstitch` 一键拆回） |
| `src/split.ts` | 主管线：`splitDocument(SplitInput) → BlockStream`（顺序本身是两次实测返工的结果，见文件头） |
| `src/ids.ts` | 内容指纹 `blockId`（D100 起**降级为别名**，不再是块的最终身份） |
| `src/registry.ts` | **身份冻结**（D100）：ID 分配一次、只增不减、旧 ID 改嫁；`resolveIds` / `resolveAlias` |
| `src/queue.ts` | **顺序与编号**（D101）：阅读序/点选序、`orderedIds` / `badgeNumbers` / `previewPosition` |
| `src/reflow.ts` | **重排稿**（D101）：N 块 → 图文混排、密集、有序、不分列的一份稿子；图注归并 `unitsOf` |
| `src/manual.ts` | 手修：`mergeBlocks` / `unstitch` / `setKind` / `fillImageText`（纯函数，ID 由调用方经 registry 重解析） |
| `src/threads.ts` | 问答线程的纯操作（挂块/按块查/追问/上下文拼装） |

`src/index.ts` 是唯一出口，全部从那里 re-export。

## 三件容易被忽略、但改动会出事的纪律

1. **顺序即正确性**：切栏必须在成行之前（栏沟可能比栏内容差还窄）；页眉页脚掩码必须在成块之前。
   理由都写在 `src/split.ts` 与 `src/columns.ts` 的文件头，别凭直觉调。
2. **块的 ID 不许由内容算出来**：内容会被陆续补出来（OCR 回填、缝合、手修），
   身份一变，挂在上面的问答就静默失去落点。见 `registry.ts` 的文件头。
3. **号码只有一份**：卡片徽标、队列面板第 N 项、重排稿里的 `[N]`，全部来自 `queue.ts`
   的 `orderedIds()`。别处再排一遍就会出现"界面上的 3 号不是发出去的 3 号"（约束 107）。

## 测试

```bash
cd packages/pdf-blocks && node --test "test/*.test.ts"
```

`test/split.test.ts` / `layout.test.ts` 覆盖管线与分栏段落修正；
`test/manual.test.ts` / `threads` 覆盖手修与线程；`test/registry.test.ts` / `queue.test.ts` /
`reflow.test.ts` 覆盖 D100/D101 那三件（身份承诺、顺序编号、重排稿）。

## 诚实边界

对**有文字层**的教材/论文（单栏/双栏）好用；启发式不承诺 100% 准 —— 手修与框选兜底是设计的一部分。
扫描件（无文字层）目前**不进块流**；公式与复杂表格按普通文本块处理，不保证语义完整。
图内文字（坐标轴标签、图例）仍各自成块 —— 属图块区域检测（D102 第 5 条）的范围。

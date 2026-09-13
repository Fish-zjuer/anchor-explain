/**
 * 代码来源适配器 —— 线1 的 `SourceAdapter`。事实源：docs/CONTRACTS.md §3 / §3.1。
 *
 * @anchor 本文件属 `adapters/`，**禁止 import 'vscode'**（DECISIONS.md D19）：
 *         它只认 `@anchor/core` 的 `EditorPort`，所以能在 `node --test` 里直接跑，
 *         真实现在 `../vscode/ports/editorPort.ts`。
 *
 * S1 里与 `capture()` 等价的 `buildAnchor()` 临时住在 `commands.ts`。搬过来的理由不是洁癖：
 * 它做过一件**只跟来源有关**的事 —— 把「光标点在哪/选了什么」变成一条带地址的 `Anchor`。
 * 留在装配层，S4 的 `PDFAdapter` 就得在同一个人手里再写一遍同样的判断。
 *
 * **S2 落了 `capture()`，S3 补上 `fetchContext()`**（`SLICES.md` 的 S3 范围里本就列着它）。
 * `detect()` 仍未落：一个适配器的时候"谁适用"是废话，等 S7 出现第二个适配器
 * （`PDFAdapter`）时才第一次有真假之别。接口本身是冻结的，这里只是**分步兑现**。
 */

import { AnchorError } from '@anchor/core';
import type {
  AdapterCapabilities,
  Anchor,
  CodeLocation,
  ContextRequest,
  EditorPort,
  EditorSelection,
  FileSystemPort,
} from '@anchor/core';
import { basenameOf, countTextLines } from '../paths.ts';

/**
 * 「讲解什么」的两种范围。它由**确认 UI**（`commands.ts` 的 QuickPick）拍板，
 * 不由适配器猜 —— 适配器只负责把选定的范围取回来。
 */
export type CaptureScope = 'selection' | 'whole-file';

/**
 * 取件时单文件的大小上限（S9a）。超过就只回一句"太大"，不把内容交出去。
 *
 * @anchor 诚实记一笔：**文件仍然被读进内存了一次**才判的大小（`FileSystemPort` 现在
 *         没有 stat，为了这一条去加端口方法会牵动 core/ports + 两个实现 + 假端口）。
 *         在一次讲解最多 `maxFetchRounds`（默认 3）次读取的前提下，这个代价可以接受；
 *         真要预检，往 `FileSystemPort` 加一个 `size()` 即可。
 */
const MAX_TEXT_CHARS = 512 * 1024;

export interface CodeAdapter {
  readonly type: 'code';
  readonly capabilities: AdapterCapabilities;
  /**
   * 产出锚点。`scope` 缺省是 `'selection'`。
   *
   * 为什么这里可以带参数、而 §3 的 `SourceAdapter.capture()` 没有参数：
   * 可选参数在 TS 里仍然可赋值给零参签名，`CodeAdapter` 照样满足 `SourceAdapter`。
   * 于是"范围从哪来"这件事不必污染冻结的接口，也不必让适配器去读 UI。
   */
  capture(scope?: CaptureScope): Promise<Anchor>;
  /**
   * 取件（§3 的第四个方法）。**只被编排层调用，且调用前已经过 §3.2 校验** ——
   * 所以这里不再重复判越界，只负责"把那一行区间读出来"。
   */
  fetchContext(req: ContextRequest): Promise<string>;
}

export interface CodeAdapterDeps {
  editor: EditorPort;
  fs: FileSystemPort;
}

export function createCodeAdapter(deps: CodeAdapterDeps): CodeAdapter {
  /** 两种范围在适配器眼里是同一件事：一个行区间 + 那段原文 */
  async function take(scope: CaptureScope): Promise<EditorSelection> {
    const picked =
      scope === 'whole-file' ? await deps.editor.getDocumentSelection() : await deps.editor.getSelection();

    if (!picked) {
      // 走到这里说明"用户刚确认过要讲什么，但那个东西没了"（编辑器被关掉、选区被取消）。
      // 抛错而不是静默返回 null：调用方据此给一句人话，而不是什么也不发生。
      throw new AnchorError(
        'ADAPTER_UNAVAILABLE',
        scope === 'whole-file' ? '编辑器已经关掉了。' : '选区已经没了。',
      );
    }
    return picked;
  }

  return {
    type: 'code',
    // `maxSpan` 对 `file` 的语义是**一次最多几行**（S9a 起校验层真的会读它）
    capabilities: { contextTypes: ['file'], maxSpan: 60 },

    async capture(scope: CaptureScope = 'selection'): Promise<Anchor> {
      const picked = await take(scope);
      const location: CodeLocation = {
        filePath: picked.filePath,
        lineStart: picked.lineStart,
        lineEnd: picked.lineEnd,
      };

      // 文档指纹：会话记忆与 staleness 都用它。取不到（文件被删/无权限）就退化成路径，
      // 让讲解照常走 —— 没有指纹只损失 staleness 检查，不该把整次讲解打断。
      const hash = await deps.editor.documentTextHash(picked.filePath);

      return {
        sourceType: 'code',
        sourceId: hash ?? picked.filePath,
        // 显示名走 basename，而不是 `workspace.asRelativePath`：后者要 import vscode，
        // 而 §3.1 记的就是 `'main.c'` 这个形状。带路径的部分由 `locationLabel` 负责显示。
        sourceName: basenameOf(picked.filePath),
        location,
        extractedText: picked.text,
      };
    },

    async fetchContext(req: ContextRequest): Promise<string> {
      // §3 只给 fetchContext(req) 一个参数（拿不到 anchor），所以这里信 params ——
      // "params.path 必须等于锚点文件"那条闸门在 §3.2，由编排层过（见 validateContextRequest）。
      const filePath = req.params.path;
      const start = req.params.start;
      const end = req.params.end;
      if (typeof filePath !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
        // 编排层过了校验还走到这里，说明两边对契约的理解不一致 —— 明说，不要静默返回空串
        throw new AnchorError('CONTEXT_REJECTED', '取件参数不完整（需要 path / start / end）');
      }

      const text = await deps.fs.readText(filePath);
      const lines = text.split(/\r?\n/);
      const total = countTextLines(text);
      const from = Math.max(1, Math.trunc(start));
      const to = Math.min(Math.trunc(end), total === 0 ? lines.length : total);
      if (to < from) return '（这个区间没有内容）';

      // **带上行号**：模型要能引用具体行号，否则它算出来的 location 全靠猜，
      // 而 §3.3 的越界检查只在超出文件范围时才拦得住。
      const width = String(to).length;
      const body = lines
        .slice(from - 1, to)
        .map((line, i) => `${String(from + i).padStart(width, ' ')}\t${line}`)
        .join('\n');

      return `文件：${filePath}\n行 ${from}-${to}（共 ${total} 行）：\n${body}`;
    },
  };
}

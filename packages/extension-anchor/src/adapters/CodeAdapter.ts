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
 * **S2 只落 `capture()`**。`detect()` 与 `fetchContext()` 按 `SLICES.md` 归 S3：
 * 它们各自的调用方（适配器注册表、取件校验）那时才存在，现在写出来就是没有消费者的死码。
 * 接口本身是冻结的，`SourceAdapter` 的形状没有变 —— 这里只是**分两步兑现**它。
 */

import { AnchorError } from '@anchor/core';
import type {
  AdapterCapabilities,
  Anchor,
  CodeLocation,
  EditorPort,
  EditorSelection,
} from '@anchor/core';
import { basenameOf } from '../paths.ts';

/**
 * 「讲解什么」的两种范围。它由**确认 UI**（`commands.ts` 的 QuickPick）拍板，
 * 不由适配器猜 —— 适配器只负责把选定的范围取回来。
 */
export type CaptureScope = 'selection' | 'whole-file';

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
}

export interface CodeAdapterDeps {
  editor: EditorPort;
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
    capabilities: { contextTypes: ['file'], maxSpan: 5 },

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
  };
}

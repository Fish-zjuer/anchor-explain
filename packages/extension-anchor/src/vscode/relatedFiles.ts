/**
 * 「候选文件清单」的**宿主侧**（S9a）：真的去工作区里找文件，然后交给
 * `../relatedFiles.ts` 的纯逻辑排序。分工与 `config.ts` / `vscode/configSource.ts` 同一条。
 *
 * @anchor 为什么限定这几类扩展名：清单是给**跨文件读代码**用的（宏、结构体、调用者），
 *         所以只列代码/头文件/链接脚本这类；不列 `.md`、图片、JSON —— 那些既不是相关性信号，
 *         也会把有限的 40 条挤满。找不到（模型想读某个没列出来的文件）也不影响取件：
 *         清单只是**提示**，取件的合法性由 `validateContextRequest` 判。
 */

import * as vscode from 'vscode';
import { dirnameOf, isCodeLocation, relativeToPath, samePath } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import { includeNamesIn, orderRelatedFiles } from '../relatedFiles.ts';

/** 代码类的后缀。嵌入式常见的那几种都在这儿（`.S` 汇编、`.ld` 链接脚本、`.mk` 构建片段）。 */
const CODE_GLOB = '**/*.{h,hpp,hh,hxx,c,cc,cpp,cxx,c++,inc,s,S,asm,ld,lds,mk,cmake,py,rs,go,ts,js}';

/** 找文件时的排除项：依赖与构建产物目录（与取件黑名单同一立场）。 */
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,.vscode-test,.tmp-preview}/**';

/** 一次扫描的上限。工作区再大也不至于为了一份提示清单扫穿整棵树。 */
const SCAN_LIMIT = 400;

export async function listRelatedFiles(anchor: Anchor, anchorText: string): Promise<string[]> {
  if (!isCodeLocation(anchor.location)) return [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return [];

  const anchorFile = anchor.location.filePath;
  const anchorDir = dirnameOf(anchorFile);
  const root = folders[0]!.uri.fsPath;

  let found: readonly vscode.Uri[];
  try {
    found = await vscode.workspace.findFiles(CODE_GLOB, EXCLUDE_GLOB, SCAN_LIMIT);
  } catch {
    return []; // 扫描失败就当没有清单 —— 它只是提示，不该让讲解失败
  }

  const display: string[] = [];
  for (const uri of found) {
    const path = uri.fsPath;
    if (samePath(path, anchorFile)) continue; // 锚点文件自己不进清单

    // 同目录 → 裸文件名（嵌入式里最常见的相关者）；其余 → 工作区相对路径。
    // 两种写法模型都能直接回抄给取件工具（解析规则见 `resolveCandidatePaths`）。
    const sameDir = relativeToPath(anchorDir, path);
    display.push(sameDir.includes('/') ? relativeToPath(root, path) : sameDir);
  }

  // 锚点正文里的 `#include` 是**代码自己说的依赖**，优先于我们的猜测
  return orderRelatedFiles(display, includeNamesIn(anchorText));
}

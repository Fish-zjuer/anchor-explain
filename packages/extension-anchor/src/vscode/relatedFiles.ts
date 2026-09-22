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
import { dirnameOf, isCodeLocation, samePath } from '@anchor/core';
import type { Anchor } from '@anchor/core';
import { candidateDisplayName, includeNamesIn, orderRelatedFiles } from '../relatedFiles.ts';

/** 代码类的后缀。嵌入式常见的那几种都在这儿（`.S` 汇编、`.ld` 链接脚本、`.mk` 构建片段）。 */
const CODE_GLOB = '**/*.{h,hpp,hh,hxx,c,cc,cpp,cxx,c++,inc,s,S,asm,ld,lds,mk,cmake,py,rs,go,ts,js}';

/** 找文件时的排除项：依赖与构建产物目录（与取件黑名单同一立场）。 */
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,.vscode-test,.tmp-preview}/**';

/** 一次扫描的上限。工作区再大也不至于为了一份提示清单扫穿整棵树。 */
const SCAN_LIMIT = 400;

export async function listRelatedFiles(
  anchor: Anchor,
  anchorText: string,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<string[]> {
  if (!isCodeLocation(anchor.location)) return [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return [];

  const anchorFile = anchor.location.filePath;
  const anchorDir = dirnameOf(anchorFile);

  let found: readonly vscode.Uri[];
  try {
    found = await vscode.workspace.findFiles(CODE_GLOB, EXCLUDE_GLOB, SCAN_LIMIT);
  } catch (err) {
    // 扫描失败不当成讲解失败（清单只是提示），但**必须发声**：静默返回空清单与"工作区里
    // 真没有相关文件"在日志里长得一模一样，而后果是跨文件取件悄悄退化成"模型不知道该问谁"
    // —— 用户看到的就是"它就是没有往外读的想法"，却没有任何线索（S9a 交付时正是如此，D67）
    opts.onError?.(err);
    return [];
  }

  const display: string[] = [];
  for (const uri of found) {
    const path = uri.fsPath;
    if (samePath(path, anchorFile)) continue; // 锚点文件自己不进清单

    // S9a：同目录 → 裸文件名（嵌入式里最常见的相关者），其余 → 相对锚点目录的写法。
    // D117：**基准一律是锚点目录**（`candidateDisplayName` 里说清了为什么 ——
    // 取件闸门解析相对路径就是这个基准，写工作区相对路径会解析成一个不存在的路径）。
    display.push(candidateDisplayName(anchorDir, path));
  }

  // 锚点正文里的 `#include` 是**代码自己说的依赖**，优先于我们的猜测
  return orderRelatedFiles(display, includeNamesIn(anchorText));
}

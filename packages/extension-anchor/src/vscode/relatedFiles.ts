/**
 * 「候选池」的**宿主侧**（S9a）：真的去工作区里找文件。**它只负责"有哪些文件"**，
 * 过滤、排序、编假名全在 `../relatedFiles.ts` 的纯逻辑里（分工与 `config.ts` /
 * `vscode/configSource.ts` 同一条）。
 *
 * @anchor 为什么它从"列清单"退成"扫文件"（S9a-fix10，D119）：清单必须与本次可取范围
 *         逐条一致，而"范围"是**纯逻辑**（`relatedRoots` + 黑名单）算出来的。
 *         宿主侧只要把池子交出去，纯逻辑想怎么筛就怎么筛 —— 两边就不会各算一套。
 *
 * @anchor 为什么限定这几类扩展名：清单是给**跨文件读代码**用的（宏、结构体、调用者），
 *         所以只列代码/头文件/链接脚本这类；不列 `.md`、图片、JSON —— 那些既不是相关性信号，
 *         也会把有限的清单挤满。找不到（模型想读某个没列出来的文件）也不影响取件：
 *         清单驱动的档位由清单说了算，`any` 档由模型自己查。
 */

import * as vscode from 'vscode';

/** 代码类的后缀。嵌入式常见的那几种都在这儿（`.S` 汇编、`.ld` 链接脚本、`.mk` 构建片段）。 */
const CODE_GLOB = '**/*.{h,hpp,hh,hxx,c,cc,cpp,cxx,c++,inc,s,S,asm,ld,lds,mk,cmake,py,rs,go,ts,js}';

/** 找文件时的排除项：依赖与构建产物目录（与取件黑名单同一立场）。 */
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,.vscode-test,.tmp-preview}/**';

/**
 * 一次扫描的上限。
 *
 * @anchor 它**不是**清单上限（那是 `anchorExplain.maxCandidateFiles`）。这里是"池子多大"：
 *         池子必须比清单大，才有得筛（`#include` 提到过的、同目录的都要能在里面）。
 *         池子被截断时清单会退化成一个**任意子集**（`findFiles` 的顺序没有语义）——
 *         所以给"不限"档留了大得多的额度：那一档的 `find_files` 要靠池子当"文件系统地图"。
 */
const SCAN_LIMIT = 400;
const SCAN_LIMIT_UNBOUNDED = 4000;

/**
 * 扫出工作区里的代码文件（绝对路径）。扫不动时**降级但不静默**：
 * 清单/地图没了，跨文件取件仍在（`any` 档模型可以自己写路径），
 * 但它多半**不知道该问哪个文件** —— 那句 `onError` 是唯一能解释"它怎么不往外读"的线索（D67）。
 */
export async function scanCodeFiles(
  opts: { unbounded?: boolean; onError?: (err: unknown) => void } = {},
): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return [];
  try {
    const found = await vscode.workspace.findFiles(
      CODE_GLOB,
      EXCLUDE_GLOB,
      opts.unbounded === true ? SCAN_LIMIT_UNBOUNDED : SCAN_LIMIT,
    );
    return found.map((uri) => uri.fsPath);
  } catch (err) {
    opts.onError?.(err);
    return [];
  }
}

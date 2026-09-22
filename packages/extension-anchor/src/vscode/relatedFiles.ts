/**
 * 「候选池」的**宿主侧**（S9a）：真的去工作区里找文件。**它只负责"有哪些文件"**，
 * 过滤、排序、编假名全在 `../relatedFiles.ts` 的纯逻辑里（分工与 `config.ts` /
 * `vscode/configSource.ts` 同一条）。
 *
 * @anchor 为什么它从"列清单"退成"扫文件"（S9a-fix10，D119）：清单必须与本次可取范围
 *         逐条一致，而"范围"是**纯逻辑**（`relatedRoots` + 黑名单）算出来的。
 *         宿主侧只要把池子交出去，纯逻辑想怎么筛就怎么筛 —— 两边就不会各算一套。
 *
 * @anchor **S9a-fix11（D123）：工作区之外的那些根要真的去走一遍。** 这是用户实测逼出来的：
 *         他**只打开了一个文件**（没打开文件夹），范围正确退化成"锚点所在的这一层"
 *         （`…/Core/Src` + `…/Core`），可池子来自 `vscode.workspace.findFiles` ——
 *         那个 API **只在工作区文件夹里找**。没有文件夹 ⇒ 池子是空的 ⇒ 清单是空的 ⇒
 *         清单即范围 ⇒ **一个别的文件都读不到**。比 D117 修之前还糟：那时至少锚点旁边那个文件能读。
 *         症状就写在拒绝文案里（"允许的根：…\Core\Src、…\Core"却"一个别的文件都取不到"）——
 *         范围有内容、池子没有，两边打架。
 *         所以现在：**工作区文件夹之外的根，直接走目录树**（`workspace.fs.readDirectory`，
 *         与 PDF 字节同一个立场：对 remote / 虚拟文件系统也成立）。
 *
 * @anchor 为什么限定这几类扩展名：清单是给**跨文件读代码**用的（宏、结构体、调用者），
 *         所以只列代码/头文件/链接脚本这类；不列 `.md`、图片、JSON —— 那些既不是相关性信号，
 *         也会把有限的清单挤满。找不到（模型想读某个没列出来的文件）也不影响取件：
 *         清单驱动的档位由清单说了算，`any` 档由模型自己查。
 */

import * as vscode from 'vscode';
import { isInsidePath, joinPath } from '@anchor/core';
import { DENIED_DIR_SEGMENTS } from '../fetchDeny.ts';

/** 代码类的后缀（与下面那条 glob 同一个清单，两处必须一起改）。 */
const CODE_EXTENSIONS: readonly string[] = [
  'h', 'hpp', 'hh', 'hxx',
  'c', 'cc', 'cpp', 'cxx', 'c++',
  'inc', 's', 'asm',
  'ld', 'lds', 'mk', 'cmake',
  'py', 'rs', 'go', 'ts', 'js',
];

/** 代码类的 glob（`.S` 汇编、`.ld` 链接脚本、`.mk` 构建片段都在里面）。 */
const CODE_GLOB = `**/*.{${CODE_EXTENSIONS.join(',')}}`;

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

/** 直接走目录树时的层数上限。锚点邻域只有几层，走太深只会把别处的工程也捞进来。 */
const WALK_MAX_DEPTH = 6;

/**
 * `vscode.FileType.Directory` 的值。**写死一个数是有意的**：这个判断要能在冒烟的桩里跑，
 * 而桩只提供用得到的那几个 API，不提供 `FileType` 枚举（`1` = File、`2` = Directory 是稳定契约）。
 */
const FILE_TYPE_DIRECTORY = 2;

function hasCodeExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/** 工作区文件夹里的那部分：用官方的 `findFiles`（快、尊重 excludes）。 */
async function scanWorkspace(unbounded: boolean): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return [];
  const found = await vscode.workspace.findFiles(
    CODE_GLOB,
    EXCLUDE_GLOB,
    unbounded ? SCAN_LIMIT_UNBOUNDED : SCAN_LIMIT,
  );
  return found.map((uri) => uri.fsPath);
}

/**
 * 直接走一个目录（S9a-fix11）。**只给"工作区文件夹盖不住的根"用** ——
 * 锚点不在工作区里时（只打开一个文件、或窗口开在别的目录），那些根就是它的邻域。
 *
 * 读不动就跳过那个目录、**不中止也不上报**：锚点邻域里出现一个没有权限的目录是正常的，
 * 它不该让整次讲解失去上下文；真的一个文件都没扫到时，输出面板里会有那句"清单是空的"。
 */
async function walkRoot(root: string, budget: number): Promise<string[]> {
  const out: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && out.length < budget) {
    const next = queue.shift();
    if (next === undefined) break;

    let entries: readonly (readonly [string, number])[];
    try {
      entries = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(next.dir))) as readonly (readonly [
        string,
        number,
      ])[];
    } catch {
      continue; // 不存在 / 没权限 / 桩没实现：跳过这个目录
    }

    for (const [name, type] of entries) {
      if (out.length >= budget) break;
      if ((type & FILE_TYPE_DIRECTORY) !== 0) {
        if (DENIED_DIR_SEGMENTS.includes(name)) continue;
        if (next.depth + 1 <= WALK_MAX_DEPTH) queue.push({ dir: joinPath(next.dir, name), depth: next.depth + 1 });
        continue;
      }
      if (hasCodeExtension(name)) out.push(joinPath(next.dir, name));
    }
  }
  return out;
}

/**
 * 扫出候选池（绝对路径）。两块拼起来：**工作区文件夹里**（`findFiles`）+
 * **工作区盖不住的那些根**（直接走目录树，S9a-fix11）。
 *
 * @param roots 本次档位允许的根（**与闸门同一份**）。传进来的根里凡是没被任何工作区文件夹
 *              盖住的，都要自己去走 —— 否则就会出现"范围里有它、池子里没有它"
 *              （清单为空、一个文件都读不到），而那正是用户实测的那次失败。
 *
 * 扫不动时**降级但不静默**：清单/地图没了，跨文件取件仍在（`any` 档模型可以自己写路径），
 * 但它多半**不知道该问哪个文件** —— 那句 `onError` 是唯一能解释"它怎么不往外读"的线索（D67）。
 */
export async function scanCodeFiles(
  opts: { roots?: readonly string[]; unbounded?: boolean; onError?: (err: unknown) => void } = {},
): Promise<string[]> {
  const unbounded = opts.unbounded === true;
  const budget = unbounded ? SCAN_LIMIT_UNBOUNDED : SCAN_LIMIT;

  let pool: string[] = [];
  try {
    pool = await scanWorkspace(unbounded);
  } catch (err) {
    opts.onError?.(err);
  }

  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const outside = (opts.roots ?? []).filter(
    (root) => root !== '' && !folders.some((folder) => isInsidePath(folder, root)),
  );

  for (const root of outside) {
    if (pool.length >= budget) break;
    pool.push(...(await walkRoot(root, budget - pool.length)));
  }

  // 去重（两个根可能重叠：锚点目录的上一层常把锚点目录也盖进来）
  return [...new Set(pool)];
}

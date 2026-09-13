/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * ---------------------------------------------------------------------------
 * 本文件已被 anchor-explain 修改（Apache-2.0 §4(b) 要求的显著声明）。
 * 改动只有两处，逐条见 MODIFICATIONS.md：
 *   1. **删掉上游的"赞助提示"弹窗**。它每次安装后第一次激活都会弹一次，
 *      把用户引向上游的非营利组织捐赠页。那既是上游品牌露出，
 *      也不该由一个 fork 替用户做主 —— 这是个 PDF 阅读器，不是募捐入口。
 *   2. 新增命令 `anchorPdf.openInAnchorViewer`（"用 Anchor 打开 PDF"）。
 *      它是 S4 验收的唯一入口：**默认打开方式不受影响**（customEditors 里是
 *      `priority: "option"`），只有显式走这个命令才用我们的视图。
 * ---------------------------------------------------------------------------
 */

import { commands, type ExtensionContext, Uri, window } from "vscode";

import { PDFViewerProvider } from "./pdf-viewer-provider";

/**
 * 用 Anchor 的 PDF 视图打开一个 PDF。
 *
 * @anchor 为什么需要一个命令、而不是改 customEditors 的 priority：这就是"不劫持"的全部内容。
 *         `priority: "option"` 让我们的视图**只是候选项之一**，用户原来的默认打开方式不变；
 *         想用我们这套时，从这里进。
 *
 * 没给 uri 时的取法：活动编辑器里的 PDF → 否则让用户挑一个文件。
 * 接受 uri 参数是为了 S6：线2 的框选结果要交回线1，反过来线1 也可能要求
 * 把某个 PDF 用我们的视图打开（跨扩展调用走 executeCommand，见 CONTRACTS §5.1）。
 */
export async function openInAnchorViewer(uri?: Uri): Promise<void> {
  const target = uri ?? (await pickPdf());
  if (!target) return;
  // 用 `vscode.openWith` 而不是自己 new 一个 webview：这样"用 Anchor 打开"
  // 跟用户从"打开方式"里选我们走的是同一条路，不会出现两套行为。
  await commands.executeCommand("vscode.openWith", target, PDFViewerProvider.viewType);
}

async function pickPdf(): Promise<Uri | undefined> {
  const active = window.activeTextEditor?.document.uri;
  if (active && active.path.toLowerCase().endsWith(".pdf")) return active;

  const picked = await window.showOpenDialog({
    title: "用 Anchor 打开 PDF",
    canSelectMany: false,
    filters: { PDF: ["pdf"] },
  });
  return picked?.[0];
}

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    PDFViewerProvider.register(context),
    commands.registerCommand("anchorPdf.openInAnchorViewer", openInAnchorViewer),
  );
}

export function deactivate() {
  // noop
}

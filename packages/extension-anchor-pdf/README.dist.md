# Anchor PDF 视图

线2 的 PDF 侧：把 PDF 上**框选的一块**变成带地址的锚点（第 N 页 + 归一化 bbox），
并把位置交给 **Anchor Explain** 讲解。

- **不劫持**你的默认 PDF 打开方式：本视图只是一个候选项，想用它时右键 PDF →
  打开方式 → **Anchor PDF 视图**（或命令面板 → **Anchor: 用 Anchor 打开 PDF**）。
- 框选：打开 PDF 后按 `Ctrl+Alt+S`（mac：`Cmd+Alt+S`）拖一个矩形。
- 框出来的位置交给 **Anchor Explain** 讲解；讲解时点侧边栏的某一步，
  会滚到对应页并闪一下那一块（约 2 秒，不留常驻的框）。

## 需要

本扩展是 **Anchor Explain 的 PDF 入口**，讲解能力在 **Anchor Explain** 里。
两个一起装才有完整功能：只装本扩展时，框选会提示"没有安装线1"。

## 安装

VS Code → 扩展面板 `…` → **从 VSIX 安装…** → 选中 `.vsix`；
或命令行 `code --install-extension anchor-pdf-0.1.1.vsix`。装完重启 VS Code。

## 许可与来源

本扩展基于 [mathematic-inc/vscode-pdf](https://github.com/mathematic-inc/vscode-pdf)（Apache-2.0）修改，
依 **Apache-2.0** 许可提供：全文见包内 `LICENSE.txt`，改动清单见 `MODIFICATIONS.md`。
内含的 pdf.js 同属其上游的许可。

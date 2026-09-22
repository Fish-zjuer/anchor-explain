# Anchor Explain

把选中的一段内容变成带地址的锚点：AI 讲解并逐步高亮流转。
核心命题——**截图 = 带地址的锚点，不是像素包**。

- 选一段代码 → AI 把它讲成**一步一步**的讲解：先铺整段的浅色底，
  再让一个荧光在块内**逐个逻辑点**扫过去，侧边栏同步显示讲解文字。
- AI 不够时，它会**按地址**回头读这段代码相关联的其他文件（宏、结构体、调用者），
  而不是靠猜。读取范围、次数、行数都有上限，且**绝不写文件**。
- 支持**多段**：把几段代码加入队列，一起讲成一份。
- 支持配任意 **OpenAI 兼容端点**（OpenAI / DeepSeek / 通义 / 本地 Ollama……）。

## 安装

在 VS Code 里：扩展面板右上角 `…` → **从 VSIX 安装…** → 选中 `.vsix` 文件，装完重启 VS Code。
命令行等价：`code --install-extension anchor-explain-0.1.1.vsix`。

（如果双击 `.vsix` 弹出的是 "Microsoft VSIX Installer"，那是 Visual Studio 抢走了文件关联 ——
用上面两种方式装即可。）

## 首次配置（每台机器一次）

1. 命令面板（`Ctrl+Shift+P`）→ **Anchor: 配置模型端点（写进设置）**，
   或在设置里填 `anchorExplain.providers`（baseUrl + tier1Model）。
2. **Anchor: 设置 API Key（存进 SecretStorage）** —— Key 存在 VS Code 的密钥库里，
   不进 settings.json，不会被同步、被截图、被提交。
3. **Anchor: 显示状态** 核对端点、模型、取件上限都读到了。

## 怎么用

| 动作 | 操作 |
|---|---|
| 讲解选中的一段 | 选中 → `Ctrl+Shift+A`（mac：`Cmd+Shift+A`）→ 「讲解这段」或「讲解整个文件」 |
| 推进 / 回退 | `Alt+]` / `Alt+[` |
| 自动播放 | `Ctrl+Shift+Space` |
| 退出讲解 | `Esc` |
| 把一段加入多段队列 | `Ctrl+Shift+Q` |
| 讲队列里的全部段 | 命令面板 → **Anchor: 讲解多段队列里的全部段** |
| 重放上次讲解（不花 token，逐字相同） | 命令面板 → **Anchor: 重放上次讲解** |
| 重新讲一遍（再问一次模型） | 命令面板 → **Anchor: 重新讲一遍** |
| 查看状态 / 键位 | 命令面板 → **Anchor: 显示状态** |

活动栏的 **Anchor** 图标是「开始」面板：能做什么、缺什么配置、现在到哪一步，都在那里。
所有操作也可以在命令面板搜 `Anchor` 找到；键位可在自己的 `keybindings.json` 里改。

## 常见问题

- **命令面板搜不到 `Anchor:`**：扩展没被载入 —— 确认安装成功并重启过窗口
  （`Developer: Show Running Extensions` 里能看到本扩展）。
- **「还没有配 anchorExplain.providers」**：先做「首次配置」的三步。
- **讲解是英文/太啰嗦**：设置里 `anchorExplain.style` 两档可选（简约 / 严谨）。
- **想讲 PDF**：安装同作者的 **Anchor PDF 视图**（`anchor-pdf`），框选一块即可交给本扩展讲解。

## 许可

依 **Apache-2.0** 开源，全文见包内 `LICENSE.txt`（源码在
[github.com/Fish-zjuer/anchor-explain](https://github.com/Fish-zjuer/anchor-explain)）。
包内包含的第三方组件及其许可见 `THIRD_PARTY_NOTICES.md`。

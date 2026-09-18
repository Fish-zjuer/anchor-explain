# D85 分发：怎么打 `.vsix`、怎么装、怎么给出去

> 一句话：**打两个 `.vsix`，双击就装**。这个仓库不上架 Marketplace（线2 的上游要求先开 Discussion，
> 而且专有许可也不适合 Marketplace），所以分发形态就是"私下给安装包"。

## 1. 打包（在你这台机器上）

```powershell
pnpm package:vsix        # 两个都打（线1 + 线2）
pnpm package:vsix line1  # 只打线1
pnpm package:vsix line2  # 只打线2
```

产物落在 **`release/`**（已被 `.gitignore` 忽略，不会混进 git）：

```
release/anchor-explain-0.1.0.vsix   线1：代码讲解（3.09 MB）
release/anchor-pdf-0.1.0.vsix       线2：PDF 视图（4.62 MB）
```

版本号在两个扩展各自的 `package.json` 里（现在是 `0.1.0`）。**发新版前先改版本号**，
`.vsix` 的文件名与 manifest 里的版本都从那里来。改完跑一遍 `pnpm check` 再打包。

## 2. 打包脚本自带四道校验（`scripts/package-vsix.mjs`）

打包不是"跑完 vsce 就算数"。脚本会把打好的 `.vsix` **读回来**，逐项核四件事，
任何一件不过就以退出码 1 结束（产物留在 `release/`，但**不许分发**）：

1. **结构**：`[Content_Types].xml` + `extension.vsixmanifest` 在；manifest 的
   `Id` / `Version` / `Publisher` 与 `package.json` 对得上。
2. **必带**：产物、图标、演练文档、`LICENSE*`、第三方署名——一样都不能少
   （线1 缺 `THIRD_PARTY_NOTICES.md`、线2 缺 `MODIFICATIONS.md` 都会红）。
3. **禁带**：`src/`、`test/`、`tools/`、`patches/`、`docs/`、`node_modules/`、`*.ts`、`*.map`、
   `tsconfig`、`.env`、lockfile、`.vscode/` —— 源码和开发痕迹一个都不许在包里。
4. **密钥扫描**：把每个 entry 真解压出来，按 `sk-…` / `Bearer …` / `PRIVATE KEY` /
   `ghp_…` / `xox…` 等特征扫。**宁误报、不漏出**。

判据读的是**产物本身**，不是 `.vscodeignore` —— 排除表写错时，表现是"包里悄悄多了源码"，
那种事事后最难发现，所以按产物判（同 D82 的"不读中间态、读事实"）。

### 两个 vsce 的"改名"行为（写排除表/必带表时要知道）

| 盘上的文件 | 进包之后 | 为什么 |
|---|---|---|
| `README.md` | `extension/readme.md` | vsce 统一小写 |
| `LICENSE`（线2） | `extension/LICENSE.txt` | vsce 统一成 `.txt` |
| `assets/pdf.js/**` 里的 `.mjs` | 原样保留 | **不是源码**，是 vendored 运行时，必须带（Apache-2.0） |

所以必带表按**包里**的名字写；禁带按扩展名禁 `.ts`，**不要**禁 `.js`/`.mjs`。

## 3. 安装（拿到包的人怎么装）

三种等价方式，任选其一：

1. **双击 `.vsix`** —— Windows 会用 VS Code 打开并直接装（最像"安装程序"的一种）。
2. 命令行：`code --install-extension anchor-explain-0.1.0.vsix`（线2 同理）。
3. VS Code 里：扩展面板右上角 `…` → **从 VSIX 安装…** → 选文件。

装完**重启 VS Code**（或「开发人员: 重新加载窗口」）。两个包是**独立安装**的：
只要代码讲解就只装线1；要讲 PDF 就两个都装。

**注意**：如果你的 VS Code 是从商店版/Insiders 之外装的（比如 VSCodium 或便携版），
第 1 种双击可能不认识 `.vsix`，用第 3 种兜底。

## 4. 首次使用要配一次模型端点（每个装它的人自己配）

**API Key 不在安装包里，也不应该在。** 它是装到**每台机器上之后**由使用者自己存进
`SecretStorage` 的（`Anchor: 设置 API Key`，不进 settings.json）。安装包里没有任何人的 key；
打包脚本第 4 道校验专门守这一条。

新装的人照 [`packages/extension-anchor/README.md`](../packages/extension-anchor/README.md)
的「第 0.5 步」走：设置里填 `anchorExplain.providers`（baseUrl + tier1Model）→
`Anchor: 设置 API Key` 存 key → `Anchor: 显示状态` 确认。

**同样别把你的 settings.json 发给别人** —— 如果你曾经在 `providers.*.apiKey` 里写过明文 key，
它就躺在你的 settings.json 里。包里没有它，但你的配置文件里有。

## 5. 给出去的规矩（"分发权在我手里"怎么落实）

先说清楚能做到什么、做不到什么：

| | 线1 `anchor-explain` | 线2 `anchor-pdf` |
|---|---|---|
| 包里带的许可 | `LICENSE.txt`（专有，禁止再分发） | `LICENSE.txt`（**Apache-2.0** 原文） |
| "别人不得再分发" | **能**（授权条款写死了） | **不能** —— Apache-2.0 §4 本来就授予拿到的人再分发权 |
| 能不能变成禁止再分发 | 已经是 | **不能**，除非不分发它（它是 Apache-2.0 fork，改许可等于违反上游许可） |

所以：

- **只发 `anchor-explain-0.1.0.vsix`** = 完全满足"只有我能分发"。
- **两个都发** = 线2 那部分等于按 Apache-2.0 授权给了对方（对方可以把它再分发出去，
  但也只是线2 那一部分；线1 仍然受专有条款约束）。
- 无论发哪个：**不发源码仓库、不发 `docs/`、不发 `scripts/`**，只给 `release/` 里的 `.vsix`。
- 许可条款管的是**愿意守约的人**和**出了争议时的意思表示**，不是技术锁。
  想进一步降低被转发的风险：一份一份私下给、别放公开下载页 / 网盘公开链接 / 代码托管 Release，
  每份都带着包里自带的 `LICENSE.txt`。
- `packages/extension-anchor/LICENSE.txt` 里有一处**必须手填**：`Copyright (c) 2026 【版权人：请替换…】`。
  填好之前，这份许可不算严肃。

## 6. 打包遇到问题查这里

| 症状 | 原因与解法 |
|---|---|
| `pnpm package:vsix` 报 `ERR_PNPM_IGNORED_BUILDS` | pnpm 11 要你批准依赖的构建脚本。`pnpm-workspace.yaml` 的 `allowBuilds` 里放行 `@vscode/vsce-sign` 与 `esbuild`（已在）。 |
| `Couldn't detect the repository … The link 'xxx' will be broken` | README 里出现了**相对链接**而 `package.json` 没有 `repository`。把链接改成代码块（`xxx`）或给一个真实的 repository。别塞假 repository。 |
| 打包成功但校验红了 `必带却缺席` | 多半是 vsce 又改了名（见上面那张改名表），或某个文件真没进包（看 `.vscodeignore`）。 |
| 校验红了 `疑似密钥` | **先当真**。看是哪个 entry、哪一段。假的（比如测试桩里的假 key）就调整扫描表并写明为什么；真的立即作废那把 key。 |
| 打出来的包比上次大很多 | 八成是 `.vscodeignore` 漏了新目录。看 vsce 打印的 "Files included in the VSIX" 清单。 |

## 7. 和 `pnpm check` 的关系

`pnpm check`（typecheck → test → build → 四个冒烟）是**开发验收门**，不含打包。
打分发包的正确顺序：**先 `pnpm check` 全绿，再 `pnpm package:vsix`**。
打包脚本只确认"产物存在"，不确认"产物是对的"——那是 check 的职责。

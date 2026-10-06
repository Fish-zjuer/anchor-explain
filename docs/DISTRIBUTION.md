# D85/D87 分发：怎么打 `.vsix`、怎么装、怎么给出去

> 一句话：**打两个 `.vsix`，在 VS Code 里"从 VSIX 安装"或用 `code --install-extension` 装上**
> （别指望双击 —— Visual Studio 会抢这个关联，见 §3 实测的坑）。
> 不上架 Marketplace（线2 的上游要求先开 Discussion），所以分发的两条路是：
> **源码公开（GitHub，D87）+ 想省事的人直接下载 Release 里的 `.vsix`**。

## 1. 打包（在你这台机器上）

```powershell
pnpm package:vsix        # 两个都打（线1 + 线2）
pnpm package:vsix line1  # 只打线1
pnpm package:vsix line2  # 只打线2
```

产物落在 **`release/`**（已被 `.gitignore` 忽略，不会混进 git）：

```
release/anchor-explain-0.1.2.vsix   线1：代码讲解
release/anchor-pdf-0.1.2.vsix       线2：PDF 视图
```

版本号在两个扩展各自的 `package.json` 里（现在是 `0.1.2`）。**发新版前先改版本号**，
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

**推荐顺序（实测过，双击那条路真会翻车）：**

1. VS Code 里：扩展面板右上角 `…` → **从 VSIX 安装…** → 选文件。
2. 命令行：`code --install-extension anchor-explain-0.1.2.vsix`（线2 同理）。

装完**重启 VS Code**（或「开发人员: 重新加载窗口」）。两个包是**独立安装**的：
只要代码讲解就只装线1；要讲 PDF 就两个都装。

### 实测踩到的坑（2026-09-18，用户自己装的时候撞上）

**双击 `.vsix` 不一定能装** —— 电脑上装过 **Visual Studio**（2017/2019/2022）的话，
`.vsix` 的文件关联会被 **Visual Studio 自带的 VSIXInstaller** 抢走。双击弹出来的是
"Microsoft VSIX Installer"，日志里能认出 Id/Name/Version，最后却报
`NoApplicableSKUsException: 一个或多个扩展适用于 Visual Studio Code，请尝试在 Visual Studio Code 中安装`。
**这不是包坏了**（manifest 被正确读出就是证据），是用错了安装器。所以：

- 安装说明（`release/安装说明.txt`）把"双击"从方法 1 撤掉了，只推荐上面两种；
- 想恢复双击：右键 → 打开方式 → 其他应用 → 选中 VS Code 的 `Code.exe` → 始终使用。

### 给自己的机器装（开发机）要小心**同一扩展的两份副本**

`pnpm link:ext`（D60）会在 `~/.vscode/extensions/` 下建**指向本仓库的目录联接**，
扩展 ID 与 `.vsix` 完全相同。两者并存 = 同一个 ID 装两份，VS Code 的行为不可靠。
所以在开发机上二选一：

- **继续开发**：什么都不用做 —— 联接版就是最新代码（`pnpm build` + 重载窗口即生效），
  `.vsix` 只拿来发给别人；
- **想测打包出来的产物**：先 `pnpm unlink:ext`，再 `code --install-extension …`；
  测完想回到开发态：`code --uninstall-extension Fish-zjuer.anchor-explain`（线2 同理）→ `pnpm link:ext`。

> **D86 改过 publisher**（`anchor` → `Fish-zjuer`）：扩展 ID 变了，旧 ID 的联接/安装
> 不会被 `pnpm unlink:ext` 认出来（它按当前 manifest 算目录名）。改 publisher 后第一次
> `pnpm link:ext` 之前，把旧的 `~/.vscode/extensions/anchor.anchor-explain-0.0.0` 与
> `anchor.anchor-pdf-0.0.0` 两个联接删掉（`cmd /c rmdir "<目录>"`，只删联接不碰源码）。
> SecretStorage 按**扩展 ID**隔离：换 ID 后要在新扩展里重新存一次 API Key；
> `anchorExplain.*` 设置是全局的，不受影响。

> **⚠ 联接会"自己喂黑名单"——这条路在索引缺失时会自锁（D131，已实测）。**
>
> 三类事故叠在一起，本机全踩过一遍，最终**放弃联接、改用 VSIX**：
>
> **第一类：联接存绝对路径，仓库一挪就是死链。** VS Code 报
> 「无法读取文件 `…/extensions/<id>-<ver>/package.json`（无法解析不存在的文件）」。
> 这类死链 `pnpm unlink:ext` **不肯删** —— `pointsAt()`（`scripts/link-extension.mjs:138`）
> 要拿联接的实际目标跟**当前**仓库路径逐字比对，死链比不中，脚本按"这不是我们建的联接"处理，
> **既不动它也不让你重装**。于是卸载/重装这条路在搬到过的仓库上是堵死的。
>
> **第二类：`.obsolete` 是黑名单，且 VS Code 从不主动清理它。**
> 里面的 key 会被判为废弃版本、**不加载**（设计如此，防"删了又自己装回来"）。
> 陷阱在于：**改 publisher / 升版本之后，用旧名字重建联接会被直接吃掉** ——
> 那个名字以前用过、被删了，就沉在 `.obsolete` 里。本机实例：
> `fish-zjuer.anchor-explain-0.1.1` 命中黑名单 → 联接是好的、`package.json` 也能读，
> **就是不给加载**，表现极像"联接又坏了"。
>
> > 清黑名单**只删 `anchor` 相关 key、别人的一字不动**，且**VS Code 必须先完全退出**
> > （运行时随时会写回）。一行 JSON，别手改，用脚本：
> >
> > ```bash
> > cd ~/.vscode/extensions
> > cp .obsolete .obsolete.bak-$(date +%Y%m%d-%H%M%S)     # 先备份
> > node -e "
> > const fs=require('fs');const p='.obsolete';
> > const j=JSON.parse(fs.readFileSync(p,'utf8'));
> > const out={};
> > for(const [k,v] of Object.entries(j)){ if(/anchor/i.test(k)) continue; out[k]=v; }
> > fs.writeFileSync(p, JSON.stringify(out), 'utf8');
> > console.log('剩下', Object.keys(out).length, '条');
> > "
> > ```
>
> **第三类（这一步是决定性的）：联接会被判为"残留"，于是自锁。**
> **VS Code 每次启动都扫描扩展目录，把「磁盘上有目录、但不在 `extensions.json` 索引里」
> 的扩展当成废弃残留写进 `.obsolete`。** 而联接**从来没进过 `extensions.json`**，于是：
>
> ```
> 联接存在 → 不在 extensions.json → 判为残留 → 记进 .obsolete → 不加载 → 永远进不了 extensions.json
> ```
>
> **手工删 `.obsolete` 只是治标，一重启就复发**（本机实测：`14:06` 清掉，`14:07` 重启被写回）。
> 根源是"这个索引 VS Code 只认它自己扫得出的目录"，**联接不在其中**。
>
> **结论：要常驻就装 .vsix，别用联接。** VSIX 做的事正好补上缺的那一环 ——
> **把文件真复制进扩展目录、并正式登记进 `extensions.json`**。有登记就脱离"残留"判据，
> 上面那条链从根上断掉。
>
> ```bash
> pnpm package:vsix                                    # 打包（含必带/禁带/密钥三重校验）
> code --install-extension release/anchor-explain-0.1.1.vsix --force   # 线2 同理
> ```
>
> **若之前装过联接，先撤掉再装**（同 ID 的联接 + 正规安装会打架）：
> `rm -f ~/.vscode/extensions/Fish-zjuer.anchor-{explain,pdf}-0.1.1`
>
> **怎么确认装好了**（比"图标出来了"更可靠）：
> 目录是**真目录**（`drwxr-xr-x`，不是 `lrwxrwxrwx`）、`package.json` 可读、
> `extensions.json` 里的记录带 `metadata`（有 uuid；**没有 metadata 就是没被真正认下**）、
> `.obsolete` 里没有它的条目。
>
> **取舍如实说**：VSIX 装的是**快照**，改代码后要 `pnpm package:vsix` + 重装才生效
> （联接只要 `pnpm build` + 重载）。**日常开发用开发宿主**（F5，`.vscode/launch.json`。）
> **只在"要像普通扩展一样常驻"时才走 VSIX。**
>
> **另外别手工改 `extensions.json`**：它是权威索引，与
> `AppData/Roaming/Code/User/globalStorage/state.vscdb` 里的状态联动，手改一边容易不一致。
> 死条目（目录已删的）交给 VS Code 重扫时自行剔除。

## 4. 首次使用要配一次模型端点（每个装它的人自己配）

**API Key 不在安装包里，也不应该在。** 它是装到**每台机器上之后**由使用者自己存进
`SecretStorage` 的（`Anchor: 设置 API Key`，不进 settings.json）。安装包里没有任何人的 key；
打包脚本第 4 道校验专门守这一条。

新装的人照 [`packages/extension-anchor/README.md`](../packages/extension-anchor/README.md)
的「第 0.5 步」走：设置里填 `anchorExplain.providers`（baseUrl + tier1Model）→
`Anchor: 设置 API Key` 存 key → `Anchor: 显示状态` 确认。

**同样别把你的 settings.json 发给别人** —— 如果你曾经在 `providers.*.apiKey` 里写过明文 key，
它就躺在你的 settings.json 里。包里没有它，但你的配置文件里有。

## 5. 给出去的规矩（D87 之后：开源了，"禁止再分发"不再成立）

**D85 时定的是专有分发（禁止再分发），D87 已改为 Apache-2.0 开源，本节按新事实重写。**

| | 线1 `anchor-explain` | 线2 `anchor-pdf` |
|---|---|---|
| 包里带的许可 | `LICENSE.txt`（**Apache-2.0** 原文） | `LICENSE.txt`（**Apache-2.0** 原文） |
| 别人能不能再分发 | **能**（Apache-2.0 §4 授予） | **能**（同上，且它是 Apache-2.0 fork） |
| 再分发的条件 | 保留 `LICENSE` / `NOTICE` 与署名、声明改动 | 同左 |

所以：

- **源码已在 GitHub 公开** —— 任何人都可以从源码构建，"只有我能分发"这条不再成立，
  这是开源的题中之义，不是漏洞。
- 你仍然保留的是：**署名权**、**名字/图标的商标属性**，以及别人再分发时必须带上
  `LICENSE` / `NOTICE` 与署名的义务。
- 发 `.vsix` 只是**方便不想构建的人**，不是控制分发的手段。
- 包里自带的 `LICENSE.txt` 就是 Apache-2.0 原文，**没有需要手填的占位**（D85 时代那份
  专有 EULA 及其"版权人"占位已随 D87 删除）。

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

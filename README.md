# dsh-openspec-init

DeepSeek Harness（DSH）插件：在会话输入框下方放一个 **OpenSpec 初始化** 按钮。点一下就会

1. 检查 `openspec` CLI 是否已安装（并且能真正跑起来）；
2. 检查**当前会话的工作区**是否已经初始化过 OpenSpec；
3. 需要时在该工作区执行 `openspec init --tools dsh`。

按钮只显示一个状态，完整报告（工作区路径、CLI 版本、初始化前后状态、`init` 输出）会作为一条命令记录出现在会话里。

## 前置条件

- DSH 运行中（Web 界面，`http://127.0.0.1:3080`）。
- `openspec` CLI。没装也没关系：按钮会告诉你没装，并给出对应平台的安装命令。
  - Windows：`irm https://openspec.dev/cli/install.ps1 | iex`
  - macOS / Linux：`curl -fsSL https://openspec.dev/cli/install.sh | sh`
  - npm（需要 Node.js ≥ 22.12.0）：`npm install -g @fission-ai/openspec@latest`

## 安装

在本仓库目录下，用 DSH 的插件管理器把**绝对路径**当作 `target` 安装：

```text
plugin_manager(action: install_bundle, target: /绝对路径/dsh-openspec-init)
```

安装后立即生效（无需重启 DSH），可在 **设置 → 插件** 里看到「OpenSpec 初始化」，也可以在那里停用或卸载。

## 使用

**按钮**：会话输入框下方（与上下文统计同一行区域，顺序在它之后）的 `OpenSpec 初始化`。

**命令**：在输入框里输入 `/openspec-init` 回车，效果与按钮完全一致。

- `/openspec-init` — 检查 + 需要时初始化。
- `/openspec-init --force` — 不管当前状态，强制重跑 `openspec init --tools dsh`（OpenSpec 的 `init` 本身是幂等的，重跑只会刷新已生成的 skill 文件）。

### 判定规则

| 检查项 | 判定方式 |
| --- | --- |
| `openspec` 是否安装 | 在 PATH 中解析可执行文件，并跑一次 `openspec --version` 确认能执行 |
| 工作区是否已初始化 | 存在 `openspec/config.yaml`（或旧版 `openspec/project.md`） |
| 是否已为 `dsh` 装好 skill | 存在 `.dsh/skills/` 目录 |

- 没初始化 → 执行 `openspec init --tools dsh`。
- 已初始化但缺 `.dsh/skills/`（例如当初是用别的工具 init 的）→ 同样执行一次 `openspec init --tools dsh`，把 DSH 目标补上。
- 两者都在 → 直接报告「无需操作」，不再执行。

## 它是怎么实现的

- **Host 半（`index.js`）**：注册 `/openspec-init` 命令，是全部逻辑的唯一实现——探测 CLI、检查工作区、拉起子进程、汇总结果。
- **Client 半（`client.js`）**：只负责渲染按钮（`conversation.composer.dock` 槽位），点击时通过 `ctx.remote.commands.execute()` 执行上面那个命令，因此 UI 与命令两条入口共用同一套逻辑，没有第二份实现。

工作区来自当前会话的 `session.header.cwd`；子进程的 `cwd` 就是它，所以 `openspec init` 一定落在当前项目里。

Windows 上 npm 全局安装的 `openspec` 是 `.cmd` 批处理（Node 不允许直接 spawn，会报 `EINVAL`），插件会自动经 `cmd /d /c` 转发参数。

## 卸载

```text
plugin_manager(action: remove_bundle, target: dsh-openspec-init)
```

## 文件结构

```text
dsh-openspec-init/
├── package.json          # bundle 清单 + dsh.client 声明
├── cordis.patch.yml      # 插入 Host 行
├── index.js              # Host 半：/openspec-init 命令
├── client.js             # Client 半：按钮 + 槽位注册
├── icon.svg              # 插件管理页图标
└── locale/{en,zh}.json   # 插件管理页标题与描述
```

---

## English

A DSH plugin that adds an **OpenSpec init** button under the session composer. One press (a) probes the `openspec` CLI, (b) checks whether the current session workspace already has an OpenSpec project, and (c) runs `openspec init --tools dsh` there when needed.

Also available as the `/openspec-init` human command, with `--force` to re-run `init` regardless of state. The Host command is the single implementation; the button only calls it.

State detection: `openspec/config.yaml` (or legacy `openspec/project.md`) for an initialized project, `.dsh/skills/` for the `dsh` tool target. If the project is initialized but the `dsh` skills are missing, `init` runs once to add that target.

# omp web

[English](./README.md) | 简体中文

[oh-my-pi](https://github.com/can1357/oh-my-pi) 编码智能体的 Web 界面。
本项目只提供**界面与通信层** —— 全部智能体能力都在你本地的 `omp` 可执行文件中,这里不做任何重新实现。

![stack](https://img.shields.io/badge/vite%20%2B%20react%2019%20%2B%20ts%20%2B%20Tailwind%20v4-7c5cff)

## 功能

- **侧边栏 + 对话布局** — 会话列表(解析 `~/.omp/agent/sessions`)、搜索、新建对话、
  重命名、删除、连接状态。
- **实时流式回合** — 文本/思考增量、带实时状态的工具调用卡片、中止、流式期间排队追问
  (`prompt` + `streamingBehavior: "followUp"`)。
- **Token 消耗展示** — 单条消息的 `↑input ↓output · cache · $cost · tok/s · model` 标签,
  顶栏的会话总量与费用,以及上下文窗口用量环
  (来自 `get_session_stats` / `get_state.contextUsage`)。
- **统一 `/` 命令面板** — 一个弹窗同时承载本地命令与会话技能(带描述、图标、全宽、
  键盘可导航):plan、goal、handoff、compact。无参数命令选中即执行;带参数命令插入
  命令 token 供补全。`@` 文件引用仍是独立弹窗。
- **规划模式(Plan mode)** — 对应 omp 的 `/plan`(先规划后执行)。规划模式下的 prompt
  会被包进只读规划契约,要求把最终计划放进标记为 `plan` 的围栏代码块;最新回合随后
  出现审阅栏,提供**批准并实施**(退出规划模式)与复制操作。激活时顶栏显示规划徽章。
- **目标模式(Goal mode)** — 对应 omp 的 `/goal`(会话级持久自主目标)。目标横幅基于原生
  `goal_updated` 事件展示目标、状态与 token 预算燃尽条,并提供完成/恢复/放弃操作;
  `/goal <objective>` 以与 omp `/guided-goal` 相同的方式引导建档(由智能体用自己的
  `goal` 工具创建)。规划模式与目标模式互斥,与上游一致。
- **会话交接(Handoff)** — 原生 RPC `handoff` 命令(会话菜单与 `/handoff [instructions]`):
  生成交接文档、作为压缩条目提交,并重载压缩后的转录。与 TUI 一样,响应进行中拒绝执行。
- **项目与分支选择器** — 项目切换器(`/api/projects` → `/api/cwd`,带文件系统浏览器)
  与 git 分支选择器(`/api/branches`):列出本地分支、签出、或创建并签出新分支,
  操作作用于 agent 当前工作目录。
- **回合结束通知** — 可选的浏览器通知(Notification API):回合结束且页面处于后台时提醒;
  在设置中开启,开启即以该次点击为用户手势申请权限。
- **安装检测** — 未找到本地 `omp` 可执行文件时,页面切换为带各平台安装命令与重新检测
  按钮的安装引导。
- **主题** — 深色 / 浅色 / 跟随系统(默认深色),默认石墨黑主色,另有五种预设主色
  (紫罗兰 / 蓝 / 翠绿 / 玫红 / 琥珀),由 `--accent` token 驱动,可在侧边栏实时切换。
- **模型与思考等级选择** — `get_available_models` → `set_model`,思考等级 →
  `set_thinking_level`;压缩按钮(`compact`)。
- **扩展 UI 透传** — `select` / `confirm` / `input` / `editor` / `open_url` 请求渲染为
  对话框,并通过 `extension_ui_response` 应答。

## 架构

```
browser ──WS /ws──▶ bridge (server/bridge.mjs) ──stdio JSONL──▶ omp --mode rpc --continue
        ──REST /api──▶ 会话、文件、技能、分支、项目/fs/cwd、健康检查、静态 dist/
```

- **`server/bridge.mjs`** — Node 进程,为每个 WebSocket 连接持有一个 `omp --mode rpc`
  子进程。在子进程 `ready` 帧时协商**协议 v2**,在服务端重组 `rpc_chunk` 序列
  (按 `docs/rpc.md` 做严格顺序 / 交错 / 大小校验),双向转发干净帧。同时托管构建产物
  与支撑 UI 弹窗的 REST 端点(文件搜索、技能、经 `server/git-branches.mjs` 的 git 分支、
  项目列表 / cwd 切换、会话列表与删除)。
- **`src/rpc/`** — 镜像自 `rpc-types.ts` 的线上类型 + 带请求关联的 WebSocket 自动重连
  客户端。
- **`src/state/store.ts`** — 帧路由:`message_update` 增量 → 流式气泡,`tool_execution_*`
  → 工具卡片,`goal_updated` → 目标横幅,终态 `agent_end` → 转录对账 + 统计刷新 +
  可选的回合结束通知,`extension_ui_request` → 对话框栈。
- **`src/lib/`** — 纯函数、可单测的辅助层:斜杠命令解析与面板(`slash.ts`)、规划模式
  契约(`planMode.ts`)、目标提示词(`goalMode.ts`)、通知(`notify.ts`)、格式化、
  主题、置顶。

## 使用

```sh
pnpm install
pnpm dev          # bridge 运行在 :8787,vite 开发服务器运行在 :5173(已代理)
```

生产模式(单进程同时提供 UI + WS + REST):

```sh
pnpm build
pnpm start        # http://127.0.0.1:8787
```

要求 `omp` 在 `PATH` 中(可用 `OMP_BIN` 覆盖,另有 `OMP_CWD`、`OMP_ARGS`、`PORT`、`HOST`)。
分支选择器还要求 bridge 的 PATH 中有 `git`。超长 prompt 会写入 `<project>/.omp/scratch/`
并以文件引用发送 —— 若该项目本身是 git 仓库,建议把该目录加入 `.gitignore`。
bridge 绑定 `127.0.0.1` 且**无鉴权** ——
它能驱动你的智能体并在 agent 目录中执行 git,请仅在本地使用。
来自非环回地址的跨源请求(含 WebSocket 升级)会被拒绝,因此 omp-web 运行期间浏览
其他网页无法驱动 bridge(DNS 重绑定是文档中注明的例外,见 `server/origin-guard.mjs`)。

```sh
pnpm vitest run                            # 单元测试(纯函数 + 服务端模块)
node scripts/smoke.mjs                     # 握手:ready → v2 → state/stats/models
WS_URL=ws://127.0.0.1:8788/ws node scripts/smoke.mjs --prompt "hi"  # 完整流式回合
node scripts/theme-shots.mjs               # 默认主题 + 预设主色截图
node scripts/recovery-test.mjs             # 安装引导 → 刷新 → 对话恢复流程
node scripts/screenshot.mjs                # 无头 Edge 截图,浅色 + 深色
```

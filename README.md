# 夜班机械城 · Unit-0

这是一个中文浏览器解谜游戏。Unit-0 在停摆的机械城里，通过受控的 Python-like 代码修复八个短关卡。当前切片只包含 Flow、Memory、Choice 三条规则；每一关都使用真实的有向场景和可观察的世界事件。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:4173/>。

关卡使用静态安全的 hash 路由：`#/level/1` 到 `#/level/8`。直接打开某个 hash 会保留目标关卡并先经过开场；根路径会回到最近游玩的有效关卡。生产环境不使用 `/level/N`，因此静态服务器上的 clean path 仍然是 404。相对的 `./styles.css` 和 `./src/main.js` 资源从根 `index.html` 加载，不依赖路由路径。

## 非测试校验

```bash
npm run check
npm run build
```

`npm run check` 会检查生产 JavaScript 语法并完成 Vite 构建。项目不执行任意 Python；代码面板只开放数字、比较符号、路线选择和行顺序。

## 操作

- `运行`：按时间播放程序与世界事件。
- `暂停`：保留当前数值 `eventCursor`。
- `单步`：推进一个世界事件。
- `重置`：清空世界状态，保留当前代码编辑。
- `提示`：按点击次数逐步显示中文提示。
- 代码行可以上下移动；可编辑值会在运行前自动重置世界。
- `关卡地图`：按 Flow、Memory、Choice 分组跳转到八个关卡；当前关卡和已修复关卡会被辅助技术读到。

进度只保存 v1 的关卡 ID、最近游玩 ID 和开场是否看过；代码编辑与运行时状态不会写入浏览器存储。存储读取、解析或写入失败时游戏仍使用安全默认值。

## 当前八关

1. Flow：先到充电站，再完成交付。
2. Flow：把 `relay_core` 带到 `relay`，完成原子交付。
3. Memory：把 5 点 `energy` 存入记忆盒。
4. Memory：用 `update` 将 `energy` 从 1 变成 2。
5. Choice：让 5 点 `energy` 通过 `light`。
6. Choice：用 `label` 保存 `blue` 标签，再用 `==` 比较内容。
7. Choice：整理写入、更新、判断和交付的顺序。
8. Choice：让 `energy` 变成 5，走向 `dawn`，回应 `MAKE THE SUN RISE AGAIN`。

## 实现边界

### `deliver()` 语义决策

长期设计中，`deliver()` 只负责真实物品的交付或安装；普通设备启动应改用 `activate()`，或由 Unit-0 到达目标后触发。本轮为保持现有机制与教学进度，暂不迁移 `deliver()`。

- `src/levels.js`：八个数据驱动关卡、typed instruction、ValueExpr、中文目标与提示、Python-like 代码行和编辑映射。
- `src/runtime.js`：受控操作校验、稳定事件身份、真实有向轨道、独立的数据位置、Run/Pause/Step/Reset 和安全快照。
- `src/world.js`：Canvas 机械城、记忆盒、判断门、relay_core 和隐藏的 `worldMirror` 无障碍镜像。
- `src/code-panel.js`：带来源行/展示行映射的代码网格；`if` 块的 `go(pass)`、`else`、`go(fail)` 是展示行，不提供额外控制。
- `src/intro.js`：开场过场和 Flow、Memory、Choice 的首次世界提示。
- `src/scene-graph.js`、`src/geometry.js`：只沿 authored scene edges 寻找路径，并让动画复用同一条 Bézier 几何。

WorldEvent 只有 `id`、`instructionId`、`sourceLine`、`displayLine`、`kind`、`occurrence`、`instruction`、`payload` 八个字段。事件身份由来源指令、语义 kind 和 occurrence 分配，动态交付不会使用数组长度或游标生成 ID。

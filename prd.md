# 夜班机械城 · 当前垂直切片产品说明

## 1. 产品目标

Unit-0 是一款面向编程初学者的交互式解谜游戏。玩家先观察机械城，再通过一小段受控 Python-like 代码改变世界。代码和世界是同一件事的两种表达：代码行执行时，Unit-0、记忆盒、判断门和轨道同时给出反馈。

当前范围固定为八关，覆盖三条规则：

- Flow：动作沿 authored scene edges 按顺序发生。
- Memory：带名字的值进入记忆盒，之后可以被加载、计算并保存。
- Choice：判断门从记忆盒接收值，完成比较后选择一条路线。

当前切片不扩展到其他教学主题。用户界面、目标、提示、故事、错误、ARIA 文案和 `worldMirror` 均使用中文；Unit-0、Python、energy、label、Flow、Memory、Choice 以及代码语法保留为必要的产品词汇。

## 2. 故事与视觉语气

机械城在深夜停止运转。Unit-0 从零号车站醒来，沿着小屋、记忆盒、判断门和中继站之间的轨道修复城市。第 8 关完成时，中央塔回应 `MAKE THE SUN RISE AGAIN`，太阳才会出现。

视觉基调是纸张色界面、深蓝夜景、柔和的暖色数据 token 和清晰的轨道高亮。成功使用绿色扩散，错误使用珊瑚色覆盖；Unit-0 的表情反映当前状态，包括 idle、transfer、thinking、puzzled 和 error。

## 3. 受控程序模型

玩家程序的唯一顶层形状是：

```js
{ instructions: [/* typed instruction */] }
```

操作集合固定为：

```text
move / charge / pickup / deliver / write / update / branch
```

ValueExpr 固定为 `literal`、`memory`、`add`、`subtract`。程序必须有稳定的 instruction `id`；`normalizeProgram` 只接受 `instructions` 数组，遇到数组、旧字段或其他顶层兼容形状必须明确拒绝，不做静默转换。

代码面板显示 Python-like 语法，例如：

```python
energy = 1
energy = energy + 4
if energy > 3:
    go("dawn")
else:
    go("dark")
deliver("relay")
```

`go` 只表达 `branch` 的路径结果，不是可执行的新操作。Choice 的 `if`、缩进的 `go(pass)`、`else`、缩进的 `go(fail)` 都是一个 branch 指令的展示行；只有条件行拥有编辑和上下移动控制，派生行必须是 display-only。

## 4. 八关配置

| 关卡 | 场景重点 | 玩家理解 |
| --- | --- | --- |
| 1 | Flow：`dock → charge → relay` | 先到达，再充电，最后交付 |
| 2 | Flow：`dock → relay_core → relay` | 物件必须先被 pickup，deliver 原子地安装它 |
| 3 | Memory：`dock → memory → relay` | 用名字保留 `energy` |
| 4 | Memory：直接 `update` | 加载旧值、计算新值、保存结果 |
| 5 | Choice：`memory → gate` | 数值比较决定 `light` 或 `dark` |
| 6 | Choice：`memory → gate` | 用 `label` 保存标签，并用 `==` 比较内容 |
| 7 | Choice：写入、更新、判断、交付 | 重新排列一条完整链 |
| 8 | Choice：中央塔 | 让 `energy = 5` 走 `dawn` |

Level 2 的 fixture 必须保持为：

```js
starterProgram: {
  instructions: [move("relay"), deliver("relay"), pickup("relay_core")]
}
solution: {
  instructions: [pickup("relay_core"), move("relay"), deliver("relay")]
}
```

场景只能有 `dock → relay_core → relay` 两条有向边。空 starter 会先到达 `relay`，随后看到空的 `relay-socket`，Unit-0 进入 `puzzled`，并得到中文失败说明。成功的 `deliver` 必须一次性设置：

```text
relayInstalled = true
coreLocation = "relay"
carried = null
relaySocket = "sealed"
```

pickup 后 `coreLocation` 为 `carried`；失败时插槽保持 `empty`。`worldMirror` 以 `data-relay-installed`、`data-core-location`、`data-carried`、`data-relay-socket` 暴露这四个字段。

Memory 场景直接连接 `memory` 和 `relay`。Choice 场景直接连接 `memory` 和 `gate`，数据 token 走这条 authored edge；场景、节点、动画和状态中都不引入额外中转对象。

## 5. WorldEvent 契约

每个事件严格只有以下字段：

```js
{
  id,
  instructionId,
  sourceLine,
  displayLine,
  kind,
  occurrence,
  instruction,
  payload
}
```

`sourceLine` 指向玩家程序中的 instruction 行；`displayLine` 指向代码面板实际展示行。事件 ID 使用一个 allocator，以 `source instruction ID + semantic kind + occurrence` 为键，不使用 `events.length` 或 `eventCursor`。普通事件和动态交付事件都通过同一个 allocator 生成。

语义 payload 固定如下：

```js
store-memory receive: { stage: "receive", name, newValue }
store-memory commit:  { stage: "commit", name, oldValue, newValue }
load-memory:          { name, value }
calculate:            { name, leftValue, operator, rightValue, newValue }
token-traverse:       { actor: "token", from: "memory", to: "gate", name, value }
gate-receive:         { name, value }
gate-compare:         { left, operator, right, result }
gate-route:           { path, result }
gate-consume:         { name, value }
```

事件展开顺序为：

- `write`：Unit-0 沿轨道到 `memory`，然后 `store-memory(receive)`、`store-memory(commit)`。
- `update`：`load-memory`、`calculate`、`store-memory(receive)`、`store-memory(commit)`。
- `branch`：若条件左侧是 memory expr，依次为 `load-memory`、直连 authored `token-traverse`、`gate-receive`、`gate-compare`、`gate-route`、`gate-consume`。

`token-traverse` 只改变 `tokenPosition` 和 token 动画；它绝不改变 `unitNode`、`unit` 或 Unit-0 的路径。Unit-0 的运动与 token 的位置是两套独立状态。

## 6. Runtime API 与安全

Runtime 公开保留：

```text
run / pause / step / stepOnce / runToEnd / reset
canEdit / setProgram / getProgram
getState / snapshot / getEvents / snapshotState
```

`state.eventCursor` 始终为数字，表示已完成的 WorldEvent 数量。运行时在执行前校验 instruction、ValueExpr、节点和 authored edge；程序长度与世界事件展开都有安全上限。Runtime 保存 typed program 快照，编辑只在 idle 或 error 阶段生效，重置不会修改玩家当前代码。

禁止任意代码执行，不使用动态执行构造，也不做隐式的旧格式迁移。

## 7. 无障碍与响应式布局

`worldMirror` 保持在 DOM 中、带 `aria-live="polite"`，但使用 1px 隐藏样式，不以 `aria-hidden` 删除世界状态。镜像持续暴露 Unit-0 位置、记忆、携带物、relay 插槽、路径、比较、token 位置、阶段、错误和成功状态。

代码面板的每行使用 `28px minmax(0, 1fr) auto` 网格：行号、局部可溢出的代码文本、控制区分别占列。文本允许在本地断行，不推动页面横向溢出。移动端控制区切换到第二行；移动/上下按钮及底部操作按钮的可点击高度至少为 44px。

## 7.1 路由、进度与关卡地图

静态部署使用 canonical hash route `#/level/1` 到 `#/level/8`。空 hash 或无效 hash 通过 `history.replaceState` 规范化到有效的最近游玩关卡，若没有记录则为 1；不会为规范化创建额外历史记录。地图和“下一关”只写入不同的 hash 一次，`hashchange` 负责挂载；浏览器后退/前进只重新挂载目标关卡。

关卡 ID 是手工维护的稳定数字身份，下一关映射为 `8 → 1`。每次有效挂载使用该关卡 starter program；Runtime 的 `reset()` 保留当前代码编辑，只清空世界和 `eventCursor`。开场、关卡切换和过场都带有生命周期身份校验，旧运行时、动画帧和延迟回调不能覆盖新关卡。

浏览器存储只接受 v1 schema：

```js
{ version: 1, completedLevelIds: [], lastPlayedLevelId: null, introSeen: false }
```

加载只读不修复或清除坏数据；读、解析、校验和写入失败都回退到内存默认值。成功挂载、完成开场和成功通关才触发明确写入，不保存代码或 Runtime。关卡地图是 role dialog，包含 Flow、Memory、Choice 三组，八个原生按钮始终可用；打开时聚焦关闭按钮，关闭或 Escape 恢复触发按钮，当前关卡使用 `aria-current="page"`，已修复关卡同时暴露 `data-completed="true"` 和中文状态。

## 8. 验收标准

- 页面展示八关，且第 1–7 关不会显示太阳。
- 八个 solution 都能以真实场景事件完成；八个 starter 都会暴露中文失败原因。
- Level 2 为空手交付时显示 `relay-socket=empty` 与 `puzzled`。
- Choice 代码块完整显示 `if`、缩进 `go(pass)`、`else`、缩进 `go(fail)`。
- 所有 WorldEvent 通过统一 allocator 生成并满足八字段 schema。
- `token-traverse` 不修改 Unit-0 的位置。
- 移动端页面没有横向溢出，镜像仍可被辅助技术读取。

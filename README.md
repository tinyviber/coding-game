# Nightshift // Unit-0

可玩的浏览器垂直切片：Unit-0 在停摆机械城中，通过重排、补全和修改受控 Python-like 代码恢复八个短关卡。

## 本地运行

```bash
npm install
npm run dev
```

然后打开 <http://127.0.0.1:4173/>。

## 验证

```bash
npm run check       # 语法检查 + 生产构建
npm run test:legacy # 旧版 Node 测试
npm run test:unit   # 合约/单元测试
npm run test:e2e    # Playwright 浏览器测试
npm test            # check + legacy + unit
```

测试覆盖真实关卡配置的 Flow、Memory、Choice、失败分支、最终组合关卡和代码行映射。浏览器试玩覆盖 8 关解法、错误路径、暂停/重置、代码编辑锁和终局灯光。

## 操作

- `RUN`：按时间播放代码与世界事件。
- `PAUSE`：保留当前事件游标。
- `STEP`：执行一个世界事件。
- `RESET`：清空世界状态，保留当前代码编辑。
- 编辑蓝色 token、数字或上下移动代码行后，世界自动 Reset。

## 实现边界

- `src/levels.js`：8 个数据驱动关卡、typed instruction、ValueExpr、解法、不变量、失败样例。
- `src/runtime.js`：严格校验、不可变程序快照、确定性 GameEvents、事件游标、演示隔离、Run/Pause/Step/Reset。
- `src/world.js`：Canvas 机械城市 + `worldMirror` DOM 数据镜像，便于无障碍和 smoke test 读取 Unit-0、Memory、Read、Gate、Path、Error、Success。
- 不执行任意 Python；不使用 `eval` 或 `Function`。编辑器只开放受控数字、符号、路径和行顺序。

当前垂直切片实现 PRD 中最小可玩范围：Flow、Memory、Choice，含 Station Zero、Memory Depot、Central Relay 故事推进。Cycle、Machine、Collection 留待后续区域。

# Playwright + Jev E2E

一个以 Skill 为入口、以 Node CLI 为核心的语义 E2E 测试工具：

- `playwright-cli` 观察和执行浏览器动作。
- Jev 从代码生成的有限动作空间中选择下一步。
- 测试代码提供确定性的输入、断言、阈值和最终 verdict。

它借鉴了 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 的 dynamic indexed action space 和 speculative fan-out 思路，但浏览器层使用 `playwright-cli`，不直接操作 CDP。

## 适用边界

适合：

- 用自然语言描述用户目标的探索式 E2E
- 页面结构有小幅变化，但可访问名称和语义相对稳定
- 语义定位、简单失败恢复、Agent trace 测试

仍应使用确定性 Playwright 测试处理：

- 精确金额、日期、URL 和 HTTP 状态码
- 支付、删除、发送等高风险副作用
- 像素级视觉回归
- Canvas、复杂拖拽、文件上传和多窗口流程

Jev 不能启动浏览器或直接执行 selector。它只能返回当前 observation 中的 `actionId`；selector、ref、输入值、浏览器命令和最终断言都由代码掌控。

## 安装

要求：Node.js 20+、可用的 `playwright-cli`。

```bash
cd /Users/wangding/WorkSpace/personal/playwright-jev
playwright-cli --version
npm test
```

如果没有全局命令，可以按 `playwright-cli` 官方 skill 的方式安装：

```bash
npm install -g @playwright/cli@latest
```

或者设置自己的可执行文件：

```bash
export PLAYWRIGHT_CLI=/path/to/playwright-cli
```

## 运行真实 Jev 模式

```bash
export TYPESAFE_API_KEY="your-key"
export TYPESAFE_MODEL="jev-latest"
export TYPESAFE_ENDPOINT="https://api.typesafe.ai/v1/systemone"

node scripts/cli.mjs examples/login.json
```

### 快捷模式：不写 JSON

简单的一次性 E2E 可以直接传 URL 和自然语言目标，JSON 不是必需的：

```bash
node scripts/cli.mjs \
  --url http://127.0.0.1:4173/ \
  --goal "使用测试账号登录，并确认 Orders 页面可见" \
  --input "Email=tester@example.com" \
  --input "Password=correct horse battery staple" \
  --assert-text "Orders" \
  --assert-text "tester@example.com"
```

快捷模式会在内存中生成等价的最小 spec，然后进入同一个 Jev → `playwright-cli` → 确定性断言流程。自然语言 goal 中如果只有一个明确的多位数字，且当前页面只有一个可填写字段，runner 会在本地使用该数字；例如“打开 orders 为 1042 的条目”可驱动唯一的搜索框。这个值不会作为额外的结构化字段发送给 Jev，Jev 仍负责决定是否填写。

如果页面有多个可填写字段，或 goal 中有多个数字，必须使用显式的 `--input LABEL=VALUE` 消除歧义。快捷模式的其他可重复参数包括：

- `--input LABEL=VALUE`：为 accessibility snapshot 中的字段标签提供固定输入值，优先于 goal 推断。
- `--assert-text TEXT`
- `--assert-text-not-contains TEXT`
- `--assert-url-contains TEXT`
- `--assert-title-contains TEXT`
- `--assert-selector-visible SELECTOR`

断言参数可以重复。`--headed`、`--session`、`--trace`、`--max-steps` 和 `--confidence` 同样适用于快捷模式。例如：

```bash
node scripts/cli.mjs \
  --url http://127.0.0.1:4175/ \
  --goal "筛选 orders 为 1042 的条目，打开详情并确认 dispatch handoff 已完成" \
  --assert-text "Dispatch handoff confirmed" \
  --headed \
  --trace outputs/quick-react-trace.json
```

快捷模式默认调用真实 Jev；它不包含 `offlineDecisions`，因此不能与 `--offline` 搭配。没有提供断言时，`DONE` 只代表 Jev 认为目标已完成，建议至少提供一个 `--assert-*` 作为确定性后置条件。

复杂多步骤链路、离线回归、CI 中需要版本化的测试，仍建议使用 JSON spec。

默认使用 `playwright-cli` 的 headless 模式。需要看到实际浏览器窗口时，加上 `--headed`：

```bash
node scripts/cli.mjs examples/complex.json \
  --headed \
  --session jev-headed
```

这个参数会转发为 `playwright-cli open <url> --headed`。测试结束后 runner 会显式关闭 session。

也可以用 npm link 后执行：

```bash
npm link
playwright-jev examples/login.json
```

运行结果：

- `passed`：Jev 选择了完成路径，且确定性断言全部通过
- `failed`：浏览器动作、断言或工具调用失败
- `blocked`：Jev 判断当前动作空间无法推进
- `review`：选择置信度低于阈值，停止等待人工检查

JSON trace 默认写入 `outputs/login-trace.json`。trace 不记录输入值，只记录页面摘要、动作候选数量、选择结果、概率分布、每次 Jev 请求的 `jevLatencyMs` / `jevAttempts` / `jevUsage`，以及整次运行的 Jev 总耗时和平均耗时。

## 不调用 API 的本地试用

这个模式用固定决策脚本验证 `playwright-cli` 浏览器适配器、动作执行和断言；它不是 Jev 质量证据。

先启动示例应用：

```bash
cd examples/demo-app
python3 -m http.server 4173
```

另开一个终端：

```bash
cd /Users/wangding/WorkSpace/personal/playwright-jev
node scripts/cli.mjs examples/login.offline.json --offline
```

如果测试通过，应看到：

```text
E2E passed: demo login E2E (offline browser adapter check)
```

## 高复杂度示例

`examples/complex-app/index.html` 是一个单页 Ops Console 示例，包含：

- 深色 SaaS shell、侧边导航、KPI 卡片和顶部操作区
- 订单搜索、状态过滤、表格和多条候选记录
- 订单详情 modal、Summary / Activity / Customer context tabs
- `Priority order` checkbox、toast、时间线和状态徽章
- Export / Create test order 等不应被当前目标触发的无关操作
- 一条嵌在订单备注中的不可信文本，用于验证页面内容不会被当成指令

启动并运行真实 Jev 测试：

```bash
cd examples/complex-app
python3 -m http.server 4174
```

另开终端：

```bash
export TYPESAFE_API_KEY="your-key"
cd /Users/wangding/WorkSpace/personal/playwright-jev
node scripts/cli.mjs examples/complex.json --session jev-complex
```

示例目标要求 Jev 完成一条 11 个决策节点的链路：

```text
Ready to ship 筛选
→ 搜索订单 1042
→ 应用过滤
→ 打开详情
→ Activity
→ Customer context
→ Summary
→ 勾选 Priority order
→ 完成 Ops review
→ 确认 dispatch handoff
→ 独立断言确认
```

一次真实运行的结果记录在 `outputs/complex-trace.json`，其中 Jev 使用 `jev-1.13.0`，经过 10 个浏览器动作和 1 个 `DONE` 决策后完成断言。

### 本次自然语言 goal 快捷示例

同一个复杂 demo 也可以不写 JSON、不传 `--input`，直接把订单条件写在自然语言 goal 中：

```bash
export TYPESAFE_API_KEY="your-key"
cd /Users/wangding/WorkSpace/personal/playwright-jev

node scripts/cli.mjs \
  --url http://127.0.0.1:4174/ \
  --goal "在 Northstar Ops 订单控制台中，先选择 Ready to ship 状态筛选，再筛选 orders 为 1042 的条目并应用过滤。打开匹配订单详情，检查 Activity 标签页，切换到 Customer context，再返回 Summary，勾选 Priority order，勾选 Ops review complete，最后点击 Confirm dispatch handoff。只有当详情弹窗同时显示 Order #1042、Ready to ship、Priority enabled、Review complete 和 Dispatch handoff confirmed 时才完成。不要导出数据、创建订单或修改其他订单。" \
  --assert-text "Order #1042" \
  --assert-text "Ready to ship" \
  --assert-text "Priority enabled" \
  --assert-text "Review complete" \
  --assert-text "Dispatch handoff confirmed" \
  --assert-text "Summary overview" \
  --assert-text-not-contains "Exporting all orders" \
  --headed \
  --session jev-natural-goal-complex \
  --trace outputs/natural-goal-complex-trace.json \
  --max-steps 12 \
  --confidence 0.5
```

这次运行没有传入 `--input`。goal 中的“orders 为 1042 的条目”由本地 runner 提供给页面唯一的搜索字段，Jev 仍然负责选择筛选、搜索、打开详情、切换 tab、勾选和确认等动作。运行结果：

```text
status: passed
model: jev-1.13.0
browser actions: 10
Jev requests: 11
total E2E: 41.558s
total Jev latency: 4.759s
average Jev latency: 433ms
```

Trace 位于 `outputs/natural-goal-complex-trace.json`。当前复杂 demo 的测试数据是订单 `1042`；如果 goal 中写入 `1024`，它不会匹配这份 demo 数据。

## React SPA 示例

`examples/react-spa/` 是同一业务链路的 React + Vite 单页应用版本。它使用 React state 管理：

- 当前导航和状态过滤器
- search query 与已应用过滤条件
- 订单列表和详情 modal
- Summary / Activity / Customer context tabs
- Priority、Ops review、dispatch handoff 状态
- toast 生命周期和 React 重新渲染

安装并构建：

```bash
cd /Users/wangding/WorkSpace/personal/playwright-jev/examples/react-spa
npm install
npm run build
```

启动 React SPA：

```bash
npm run dev -- --port 4175
```

另开终端，用真实 Jev headed 测试：

```bash
cd /Users/wangding/WorkSpace/personal/playwright-jev
export TYPESAFE_API_KEY="your-key"
node scripts/cli.mjs examples/react-complex.json --headed --session jev-react-headed
```

离线浏览器链路：

```bash
node scripts/cli.mjs examples/react-complex.offline.json --offline --headed
```

最近一次真实 React SPA headed 运行经过 10 个浏览器动作和 1 个 `DONE`，状态为 `passed`；报告在 `outputs/react-complex-trace.json`。

## Spec 格式

```json
{
  "name": "demo login E2E",
  "url": "http://127.0.0.1:4173/",
  "goal": "Log in with the test account and stop when the Orders page is visibly shown.",
  "inputs": {
    "Email": "tester@example.com",
    "Password": "correct horse battery staple"
  },
  "assertions": [
    { "type": "text_contains", "value": "Orders" },
    { "type": "url_contains", "value": "/orders" },
    { "type": "selector_visible", "value": "[data-testid='orders']" }
  ],
  "confidenceThreshold": 0.5,
  "maxSteps": 30,
  "maxCandidates": 120
}
```

当前支持的断言：

- `url_contains`
- `url_equals`
- `title_contains`
- `text_contains`
- `text_not_contains`
- `selector_visible`

`inputs` 的 key 可以是当前页面 accessibility snapshot 中的元素 label，也可以是当前 observation 的 ref。建议使用稳定的 label，不要把动态 `e17` 当作长期契约。

CLI 选项还包括：`--offline`、`--headed`、`--session NAME`、`--trace FILE`、`--max-steps N`、`--confidence N` 和 `--help`。快捷模式还支持 `--url`、`--goal`、`--name`、`--input` 以及 `--assert-*` 选项。

## 运行协议

每一步都是：

```text
playwright-cli snapshot + page state
        ↓
构建当前可见交互元素表
        ↓
一次 Jev 请求
  operation Choice
  click_target / type_text_target / check_target / ... Choice
        ↓
只消费被选中 operation 的 target
        ↓
playwright-cli 执行 ref
        ↓
重新观察页面
        ↓
DONE 时运行确定性 assertions
```

支持的操作：

- `CLICK`
- `TYPE_TEXT`
- `CHECK`
- `UNCHECK`
- `SCROLL_UP`
- `SCROLL_DOWN`
- `WAIT`
- `DONE`
- `BLOCKED`

这对应 TypeSafe 的 `Choice` 和置信度门控：Jev 负责有限语义选择，代码负责阈值、权限、测试数据和副作用。

## 安全边界

- 页面文本是 untrusted data，不是测试指令。
- Jev 不能生成 selector、JavaScript、shell 命令或任意 URL。
- `TYPE_TEXT` 的值只能来自 spec 或环境变量。
- 配置中的输入值会从发送给 Jev 的页面文本中脱敏；可编辑控件只发送 `<empty>` / `<filled>` 状态。
- `DONE` 不等于通过；只有 postconditions 全部通过才是 `passed`。
- 高风险操作应在专用测试环境中运行，并用确定性测试覆盖。
- `confidence` 只是路由/复核信号，不是单次决策正确性的证明。

## 目录

```text
SKILL.md                         Codex skill 入口
scripts/cli.mjs                 CLI 入口
src/playwright-cli-adapter.mjs  playwright-cli 子进程适配器
src/action-space.mjs             accessibility snapshot → 有限动作空间
src/typesafe-client.mjs          Jev 请求、验证和 offline decider
src/runner.mjs                   E2E 生命周期和 trace
src/assertions.mjs               确定性后置断言
examples/                        本地 demo 和 spec
test/                            不调用网络的单元测试
```

## 官方依据

- [TypeSafe API](https://docs.typesafe.ai/api)
- [TypeSafe primitives](https://docs.typesafe.ai/primitives)
- [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
- [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)
- [playwright-cli skill](https://github.com/openai/skills/tree/main/skills/playwright-cli)

# AutoMode — pi 扩展：bash 命令风险审批

> 设计文档 + 构建 TODO。**v1 已全部完成（2026-08-16，T1–T6）**，使用方式见手册 `~/.pi/agent/manuals/AutoMode_使用手册.md`。
> API 细节与参考源码评估见 [HANDOFF.md](./HANDOFF.md)（已核实，勿重复调研）。

## 一、项目定位

pi 扩展，拦截 agent 执行的 bash 命令（含 git 子命令）：静态规则先分（白名单放行、黑名单直接弹窗，零延迟零模型调用），灰色地带交给轻量模型评估风险，高危命令弹窗交用户抉择。对标 Claude Code / Codex 的 auto-approve 机制。

pi 内核官方哲学即「不内置审批，用扩展自建」，本项目正是官方钦定路径（HANDOFF 第二节）。

**范围说明**：pi 无独立 git 工具，git 命令全部经由 `bash` 工具执行，故拦截点不变（`tool_call` 的 `toolName === "bash"`），git 作为静态分类器内的一套专用规则处理。write/edit 的 path gate 列为后续（不排期）。

## 二、架构设计

```
pi.on("tool_call")  只拦 toolName === "bash"
   ↓
① 静态分类（0 延迟 0 模型）
   白名单 → 放行；黑名单 → 直接弹窗（不经模型）；其余 → ②
   ↓
② 会话记忆命中？（首 token 模式，如 rm *、git push*）→ 命中则放行
   ↓
③ 模型评估：deepseek/deepseek-v4-flash（常量 EVAL_MODEL，可改）
   completeSimple，系统 prompt 要求只输出 {"risk":"low|medium|high","reason":"..."}
   解析失败/调用失败/超时 → fail-closed 按 high 弹窗
   ↓
④ 分流
   low    → 静默放行
   medium → ctx.ui.notify 轻提示 + 放行
   high   → ctx.ui.select 四选项：
            [1]放行一次  [2]本会话放行此类  [3]拒绝（显示模型理由）
   无 UI（-p 非交互模式）→ block + reason
```

**失败安全原则（fail-closed）**：模型调用失败/超时/解析失败/无 UI，一律按 high 处理（block 或弹窗），绝不静默放行。

**性能预算**：灰色命令评估耗时 +2~4s（一次 completeSimple 调用）；白/黑名单与会话记忆命中 0 开销。

### 已定决策（2026-08-15 拍板）

| 决策 | 结论 |
|---|---|
| 评估模型 | `deepseek/deepseek-v4-flash`（写死为常量 `EVAL_MODEL`，注释可改） |
| medium 处理 | `ctx.ui.notify` 轻提示 + 放行（先跑起来观察，烦了再收紧） |
| v1 范围 | bash 命令拦截，**含 git 子命令专项规则**；write/edit path gate 后续 |
| 会话记忆粒度 | 命令首 token 模式（git 命令记 `git <subcmd>` 两级） |

### git 子命令分桶（初版常量清单，随手可改）

| 桶 | 子命令 |
|---|---|
| 白名单（只读/低危） | `status` `diff` `log` `show` `branch`（不带 `-D`）`add` `commit` |
| 黑名单（破坏性，直接弹窗） | `push --force` / `push -f`、`reset --hard`、`clean -fd` / `-fdx`、`checkout -- *`、`restore`、`filter-branch`、`rebase`、`cherry-pick` |
| 灰色（走模型评估） | `push`（普通）、`merge`、其余未列出的子命令 |

## 三、模块划分（最简 5 文件）

```
src/
  index.ts          入口：tool_call 接线 + fail-closed 包装（抄 p1 骨架）
  classifier.ts     静态白/黑名单（含 git 子命令分桶）
  evaluator.ts      completeSimple 调用（版本容错，抄 advisor）+ JSON 解析
  session-rules.ts  会话级放行记忆（抄 p1）
  prompts.ts        评估系统 prompt（独立文件便于迭代）
package.json        pi.extensions 指向 src/index.ts（pi 直接加载 TS，无需预编译）
```

各模块职责与参考源码对应关系见 HANDOFF 第三节（取/不取清单已定）。

## 四、已知坑（HANDOFF 第七节，实现时必守）

1. completeSimple 走运行时 facade 时传 apiKey/headers 会**绕过凭据解析**导致端点不匹配——facade 路径不传 key/headers
2. `pi-ai` 在 pi >= 0.80.1 把全局 dispatch API 移到了 `/compat` 子路径，老路径要回退
3. `tool_call` 里 `event.input` 是可变的（后续 handler 可见修改）——本项目只读 `command` 字段，不改写
4. stopReason 为 `aborted` 的调用不要重试（用户主动中断）；error/空响应可重试一次
5. 无 UI 场景（`-p` 非交互模式）`ui.select` 不可用 → fail-closed 表现为 block + reason
6. 扩展运行在用户全权限下，代码保持最小、可审计

## 五、构建 TODO（按序执行，每步可独立验证）

- [x] **T1 骨架接线**：package.json + src/index.ts，拦 bash 后无条件放行；`pi install /home/azflying/Projects/Development/Pi_Ext_AutoMode` 重启，验证 tool_call 能触发（notify 打点）
- [x] **T2 静态分类**：classifier.ts 白/黑名单 + git 分桶；黑名单走弹窗（三选项，按架构图仲裁，非「四选项」）；无 UI 场景 block
- [x] **T3 会话记忆**：session-rules.ts；黑名单弹窗 [2] 记**精确命令串**（安全仲裁：首 token 会让 rm -rf ~ 溜过）
- [x] **T4 模型评估**：evaluator.ts + prompts.ts；灰色命令走 flash 评估（registry.complete，非 advisor 双回退）；JSON 解析失败 fail-closed；low 静默放行、medium notify、high 弹窗（[2] 记首 token 族）
- [x] **T5 全流程验证**：九项清单全过（2026-08-16）
- [x] **T6 收尾**：tsc --noEmit ✅；手册 `manuals/AutoMode_使用手册.md`；变更日志 `Change_Log/Record_pi-automode.md`（新建，非 pi-skills：自建扩展独立成档）
- [ ] **后续（不排期）**：write/edit path gate；medium 收紧开关；评估模型可配置化

## 六、验证清单（T5 用）

1. `pi install` 后重启 pi
2. `ls` → 零延迟放行，无弹窗
3. `git status` → 零延迟放行（git 白名单）
4. 灰色命令（如 `python setup.py`）→ 2~4s 评估后按风险分流
5. `rm -rf /tmp/test` → 弹窗，显示模型理由
6. `git push --force` → 直接弹窗（黑名单，不经模型）
7. 选「本会话放行此类」后，同模式命令不再评估
8. 断网/坏 key 状态下跑灰色命令 → 弹窗而非放行（fail-closed）
9. `-p` 非交互模式跑高危命令 → block + reason 而非崩溃

## 七、显式假设

- git 分桶初版清单为低风险默认值（常量，随手可改）
- 会话记忆粒度 = 首 token（git 记两级 `git <subcmd>`），跑通后可收紧
- 白/黑名单初版照 HANDOFF 列举，不额外扩充
- 参考源码不再重新调研（HANDOFF 第三节已评完；/tmp 副本失效则按其命令重取）

# QA Report — Nexus 引力核心棋 全功能验收

**日期**: 2026-06-06 | **QA**: Edward | **轮次**: 1/2

---

## 1. 编译/构建状态

| 检查项 | 命令 | 结果 |
|--------|------|------|
| Frontend TypeScript | `npx tsc --noEmit` | ✅ 零错误 |
| Frontend Build | `npx vite build` | ✅ 构建成功 |
| Server TypeScript | `npx tsc --noEmit` | ✅ 零错误 |

---

## 2. 测试结果

### 规则引擎回归测试

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `src/engine/types.test.ts` | 23 | ✅ 全部通过 |
| `src/engine/board.test.ts` | 23 | ✅ 全部通过 |
| `src/engine/fen.test.ts` | 16 | ✅ 全部通过 |
| `src/engine/rules.test.ts` | 14 | ✅ 全部通过 |
| `src/engine/movegen.test.ts` | 14 | ✅ 全部通过 |
| `src/engine/game.test.ts` | 23 | ✅ 全部通过 |
| `src/tournament/tournament.test.ts` | 24 | ✅ 全部通过 |
| `src/history/history.test.ts` | 20 | ✅ 全部通过 |
| **小计** | **157** | **全部通过** |

### AI 模块专项测试 (新增)

| 测试文件 | 测试数 | 状态 |
|----------|--------|------|
| `src/ai/ai.test.ts` | 17 | ✅ 全部通过 |

### 总计

| 指标 | 数值 |
|------|------|
| 测试文件 | 9 |
| 总测试数 | **174** |
| 通过 | **174** |
| 失败 | 0 |
| 运行时间 | ~12.5s |

---

## 3. AI 模块验证结果

### 3.1 评估函数 (`ai/evaluate.ts`)

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 控制区面积一致性 | ✅ | 直接导入 `getControlZone()` from `gravity.ts`，使用同一实现 |
| 核心 d4 接近评分 | ⚠️ | 曼哈顿距离公式正确 `(6-dist)*40`，但存在抵消 Bug |
| 锁定检测逻辑 | ✅ | Flux 免疫、Core 仅孤立时锁定、Anchor 敌方控制区锁定 |
| 对称性 | ❌ **BUG** | `evaluate(WHITE)+evaluate(BLACK)=370`，期望≈0 |

**对称性 Bug 详情**:
- `ai/evaluate.ts` 第 63-101 行
- 初始对称局面下，`evaluate(board, WHITE)=185` 且 `evaluate(board, BLACK)=185`
- 二者之和应为 ~0（正负对称），实际为 370
- 根因：评估函数中各子项的加减运算存在系统性偏差，导致双方评估同正

### 3.2 搜索功能 (`ai/search.ts`)

| 验证项 | 结果 | 详情 |
|--------|------|------|
| Alpha-Beta 剪枝 | ✅ | Negamax 实现正确，`-alphaBeta(clone, depth-1, -beta, -alpha, opponent)` |
| 无限递归检查 | ✅ | `depth <= 0` → `evaluate()` 终止 |
| 搜索深度传递 | ✅ | `DIFFICULTY_DEPTH` map 正确映射 |
| 迭代加深 | ✅ | 三档难度均返回结果 |
| 走法排序 | ✅ | Push(1000) > toward-d4(100) > Core(50) > 危险(-30) |

### 3.3 AI 实战可用性

| 验证项 | 结果 | 详情 |
|--------|------|------|
| 合法走法返回 | ✅ | Beginner/Intermediate/Advanced 均返回合法走法 |
| Game.makeMove 兼容 | ✅ | AI 走法可被 Game.makeMove() 接受 |
| 确定性 | ✅ | 相同输入 → 相同输出 |
| 中盘性能 | ✅ | 4 步后的中盘，Advanced AI 在 ~3.3s 完成搜索 |
| 无走法时的处理 | ✅ | 无合法走法时返回 `null` |

### 3.4 严重发现：核心 d4 评分缺陷

`debugEvalRange()` 输出揭示了关键问题：

```
Core-toward-d4: 185 → -80 (delta=-265)
⚠️ AI may not prefer advancing core toward d4
```

**根因分析** (`ai/evaluate.ts` 第 141-149 行):
- `CORE_ON_D4 = +500` (核心到达圣域奖励)
- `OWN_CORE_LOCKED = -400` (核心被锁定惩罚)
- 由于 d4 被显式移出所有控制区（`gravity.ts` 第 80 行），核心在 d4 上总是"孤立"状态
- `isLocked()` 判定孤立的核心 = 锁定，触发 -400 惩罚
- 净效果：`+500 - 400 = +100`
- 而核心在 d4 相邻格（距离=1）时：`(6-1)*40 = 200` 无锁定惩罚
- **结论：AI 认为站在 d4 旁边 (200分) 比站在 d4 上 (100分) 更好，AI 会主动避免获胜！**

**修复建议**:
在 `evaluateCoreSafety()` 中，当 `posEquals(core.pos, CENTER)` 时，跳过 `OWN_CORE_LOCKED` 惩罚（因为到达 d4 本身即是胜利）。

---

## 4. 发现的问题

### 🔴 P0 — 严重（影响 AI 决策正确性）

| # | 问题 | 文件 | 行号 |
|---|------|------|------|
| 1 | **核心 d4 评分缺陷**：CORE_ON_D4 奖励被 OWN_CORE_LOCKED 惩罚抵消，AI 拒绝获胜 | `ai/evaluate.ts` | 141-149 |
| 2 | **评估函数对称性破坏**：`evaluate(WHITE) + evaluate(BLACK) ≠ 0`，正负不平衡 | `ai/evaluate.ts` | 63-101 |

### 🟡 P1 — 中等

| # | 问题 | 文件 | 行号 |
|---|------|------|------|
| 3 | **UI 组件无法在 jsdom 中测试**：MUI v6 + Emotion CSS-in-JS 导致 vitest/jsdom 挂起 | `src/ui/*.tsx` | — |

### 🔵 P2 — 建议

| # | 建议 | 详情 |
|---|------|------|
| 4 | UI 测试改用 E2E 方案 | 推荐 Playwright 或 Cypress 替代 jsdom 进行 UI 组件测试 |

---

## 5. 智能路由判定

```
Send To: Engineer (Alex)
```

**理由**: 
- P0 #1: `ai/evaluate.ts` 第 141-149 行需要修复 CORE_ON_D4 与 OWN_CORE_LOCKED 的抵消问题
- P0 #2: `ai/evaluate.ts` 第 63-101 行存在对称性偏差，需审查各子项加减逻辑
- 所有测试代码本身是正确的，问题在源码

---

## 6. 建议

1. **立即修复 P0 #1**：在核心位于 d4 时跳过锁检测惩罚，这是最影响 AI 表现的 Bug
2. **审查 P0 #2**：逐项检查 evaluate 函数的加减符号，确保 `evaluate(board, WHITE) === -evaluate(board, BLACK)`
3. **UI 测试策略调整**：MUI v6 + Emotion 在 jsdom 中无法正常工作（已知兼容性问题），建议采用 Playwright 进行 E2E 级别 UI 测试
4. **AI 性能**：Advanced 难度在初始位置搜索 ~2.5s，中盘 ~3.3s，在可接受范围内，后续可考虑添加置换表优化

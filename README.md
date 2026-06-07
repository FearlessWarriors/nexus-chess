# Nexus Gravity Core Chess

> 引力核心棋 — 原创 7×7 策略棋盘游戏 | React + TypeScript + DQN AI

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB)](https://www.python.org/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.3-EE4C2C)](https://pytorch.org/)

---

## 🎮 这是什么？

Nexus（引力核心棋）是一款**完全原创**的 7×7 策略棋盘游戏。与国际象棋、围棋、象棋**完全不同**——没有吃子、没有将军、没有提子。

核心机制是**引力锁定**：棋子的控制区形成引力场，困住敌方棋子使其无法移动。三种独特棋子各有不同的引力控制方式。

**一局 10-20 分钟，3 分钟学会，无限策略深度。**

### 为什么独特？

| Nexus | 国际象棋 | 围棋 |
|-------|---------|------|
| 引力锁定替代吃子 | 吃子消除 | 围地提子 |
| 核心占中心 d4 获胜 | 将死国王 | 占地多胜 |
| 锚点十字线不可覆盖 | 无类似概念 | 无类似概念 |
| 流子跳跃免疫锁定 | 无类似概念 | 无类似概念 |

---

## 🎯 快速开始

### 在线游玩
访问 **[FearlessWarriors.github.io/nexus-chess](https://FearlessWarriors.github.io/nexus-chess)**

### 本地运行

```bash
# 前端
cd frontend && npm install && npm run dev

# 后端（联机需要）
cd server && npm install && npm run dev

# AI 在线训练（可选）
cd ai && python -m dqn.live_train
```

---

## 🏗️ 项目结构

```
nexus_chess/
├── frontend/            # React + TypeScript + Vite + MUI 前端
│   ├── src/engine/      # 引力规则引擎（Python 端同步）
│   ├── src/ai/          # Alpha-Beta + DQN 神经网络 AI
│   ├── src/ui/          # Lichess 风格 UI 组件
│   ├── src/network/     # WebSocket 联机客户端
│   └── src/auth/        # 注册/登录/管理员
├── server/              # Node.js + Express + WebSocket 服务端
│   └── src/
│       ├── routes/      # API 路由（认证/排行榜/管理员）
│       └── db/          # SQLite 数据库
└── ai/                  # Python AI 训练管线
    ├── dqn/             # DQN 强化学习（在线训练）
    └── training/        # 引力规则 Python 引擎
```

---

## 🤖 AI 系统

**Alpha-Beta 搜索 + DQN 强化学习**

- AI 通过人类对局数据**持续在线学习**
- DQN 网络：392→512→256→128→1（270K 参数，纯 JS 推理）
- 三个难度级别：初级/中级/高级
- 随平台活跃度自然成长

```bash
# 启动 AI 在线训练（持续运行）
cd ai && python -m dqn.live_train
```

---

## 🎨 特色功能

- 🏆 **排行榜** — Top 10 红金 / Top 100 红 / Top 500 白牌子系统
- 👑 **管理员系统** — 封禁/解封/提升/降级/重置密码
- 📡 **直播观战** — 实时观看高分对局
- 🏟️ **瑞士轮锦标赛** — 自动配对积分赛
- 📖 **交互式教程** — 6 步引导新手入门
- 🔐 **注册/登录** — JWT 认证 + bcrypt 密码哈希
- ♟️ **本地/AI/联机** — 三种对战模式

---

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)

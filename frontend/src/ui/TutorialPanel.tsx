import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Chip,
} from '@mui/material';
import {
  NavigateNext as NextIcon,
  NavigateBefore as PrevIcon,
  PlayArrow as PlayIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';
import Board from './Board';
import { Game } from '../engine/game';
import { MoveGenerator } from '../engine/movegen';
import { Color, Position, PieceType, posToString, Move, posFromString } from '../engine/types';
import { getControlZone, getLockedPieces } from '../engine/gravity';
import { getPieces } from '../engine/board';

// ─── Tutorial Steps ───────────────────────────────────────────────────────────

interface TutorialStep {
  id: number;
  title: string;
  description: string;
  highlightPositions?: string[]; // pos strings to highlight
  highlightColor?: string; // highlight overlay color
  boardAnnotations?: Array<{ pos: string; label: string; color?: string }>;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 1,
    title: '欢迎来到 Nexus 引力核心棋',
    description:
      'Nexus 是一款原创策略棋类游戏。你的目标是：**将核心 (Core) 移动到棋盘正中央的 d4 圣域格子**。\n\n' +
      '你拥有三种棋子：**核心 (Core/★)**、**锚点 (Anchor/●)**、**流子 (Flux/◇)**。\n' +
      '每种棋子有独特的移动方式和"控制区"能力。点击"下一步"开始学习！',
    highlightPositions: ['d4'],
    highlightColor: 'rgba(255,215,0,0.4)',
  },
  {
    id: 2,
    title: '核心走法 — 接近圣域',
    description:
      '**核心 (★ 八芒星)** 可以向 8 个方向中的任意一个移动 1 格。\n\n' +
      '核心是你的"王"——它必须最终到达 **d4** 才能获胜。\n' +
      '核心的 8 个邻居格子构成其"控制区"（发光区域）。\n\n' +
      '**演习：** 棋盘上将高亮核心可以走到的格子（黄色）。',
    highlightPositions: ['e3', 'f3', 'f4', 'f5', 'e5', 'd5', 'c5', 'c4', 'c3', 'd3'],
    highlightColor: 'rgba(255,255,0,0.2)',
    boardAnnotations: [
      { pos: 'e4', label: '核心', color: '#FFD700' },
      { pos: 'd4', label: '圣域', color: '#FFA500' },
    ],
  },
  {
    id: 3,
    title: '锚点走法 — 十字控制',
    description:
      '**锚点 (● 实心圆)** 可以沿着正交方向（上下左右）滑动任意格数。\n\n' +
      '锚点拥有最强大的**控制区**：它所在的行和列的全部格子都被己方控制（灰色发光区域）。\n' +
      '敌方锚点的控制区会覆盖你的控制区——锚点的控制权是绝对的。\n\n' +
      '**演习：** 注意棋盘上的十字控制区。',
    highlightPositions: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4'],
    highlightColor: 'rgba(255,255,200,0.18)',
    boardAnnotations: [
      { pos: 'd4', label: '锚点', color: '#87CEEB' },
    ],
  },
  {
    id: 4,
    title: '流子走法 — 免疫跳跃',
    description:
      '**流子 (◇ 菱形)** 可以跳跃到 8 个方向中距离恰好 2 格的格子。\n\n' +
      '流子拥有**免疫锁定**特性：无论敌方控制区如何覆盖，流子**永远不会被锁定**，永远可以移动。\n' +
      '流子的控制区是它 8 个跳跃落点（距离 2 的格子）。\n\n' +
      '**演习：** 注意流子的跳跃落点和它的免疫特性。',
    highlightPositions: ['c2', 'e2', 'g2', 'c4', 'g4', 'c6', 'e6', 'g6'],
    highlightColor: 'rgba(100,200,255,0.18)',
    boardAnnotations: [
      { pos: 'e4', label: '流子', color: '#64B5F6' },
    ],
  },
  {
    id: 5,
    title: '引力锁定 — 核心机制',
    description:
      '当一个棋子站在**敌方的控制区内**时，它会被"引力锁定"：\n\n' +
      '• **锚点**被锁定后无法移动（显示 🔒 图标）\n' +
      '• **核心**：如果被己方控制区覆盖则免疫锁定；仅完全孤立（无己方控制）时才被锁定\n' +
      '• **流子**：完全免疫锁定，不受影响\n\n' +
      '锁定是 Nexus 的核心战术——围困对手的核心和锚点！',
    highlightPositions: [],
    highlightColor: 'rgba(255,0,0,0.15)',
  },
  {
    id: 6,
    title: '推离与胜利 — 最终冲刺',
    description:
      '**推离 (Push)**：当己方棋子移动到紧邻敌方核心的格子时，可以将敌方核心**推开 1 格**（朝远离己方棋子的方向）。\n' +
      '被推离的核心进入 1 回合**冷却**（显示蓝色脉冲），冷却期内该核心不能移动。\n\n' +
      '**胜利条件：**\n' +
      '• 🏆 圣域胜利：己方核心到达 d4 并结束回合\n' +
      '• 🏆 围困胜利：敌方没有任何合法走法\n\n' +
      '教程完成！点击下方"进入实战"开始你的第一局对弈！',
    highlightPositions: ['d4'],
    highlightColor: 'rgba(255,215,0,0.5)',
    boardAnnotations: [
      { pos: 'd4', label: '🏆 圣域', color: '#FFD700' },
    ],
  },
];

// ─── TutorialPanel Component ──────────────────────────────────────────────────

interface TutorialPanelProps {
  onBack: () => void;
}

export default function TutorialPanel({ onBack }: TutorialPanelProps): JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const gameRef = useRef<Game>(new Game());
  const game = gameRef.current;
  const [, setTick] = useState(0);

  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  const step = TUTORIAL_STEPS[currentStep];

  // Build a demo position depending on the step
  const demoBoard = useMemo(() => game.state.board, [currentStep]);

  // Build highlight positions set
  const highlightSet = useMemo(() => {
    return new Set(step.highlightPositions ?? []);
  }, [step.highlightPositions]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      game.reset();
      forceUpdate();
    }
  }, [currentStep, game, forceUpdate]);

  const handleNext = useCallback(() => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
      game.reset();
      forceUpdate();
    }
  }, [currentStep, game, forceUpdate]);

  const handleEnterBattle = useCallback(() => {
    onBack();
  }, [onBack]);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', width: '100%' }}>
      <Box sx={{ mb: 2 }}>
        <Button size="small" onClick={onBack} sx={{ color: '#999', fontSize: '0.75rem' }}>
          ← 返回
        </Button>
      </Box>

      {/* Stepper */}
      <Stepper
        activeStep={currentStep}
        alternativeLabel
        sx={{
          mb: 3,
          '& .MuiStepLabel-label': { color: '#666', fontSize: '0.7rem' },
          '& .Mui-active': { color: '#629924 !important' },
          '& .Mui-completed': { color: '#4caf50 !important' },
          '& .MuiStepIcon-root': {
            color: '#333',
            '&.Mui-active': { color: '#629924' },
            '&.Mui-completed': { color: '#4caf50' },
          },
        }}
      >
        {TUTORIAL_STEPS.map((s) => (
          <Step key={s.id}>
            <StepLabel>步骤 {s.id}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Content */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 3,
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        {/* Board */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Board
            board={demoBoard}
            selectedPos={null}
            legalMoves={[]}
            lastMove={null}
            onSquareClick={() => {}}
            currentTurn={Color.WHITE}
          />
        </Box>

        {/* Description Panel */}
        <Paper
          sx={{
            p: 2.5,
            bgcolor: '#1e1e1e',
            borderColor: '#333',
            borderRadius: 1.5,
            maxWidth: 380,
            flex: 1,
          }}
          variant="outlined"
        >
          <Typography
            variant="h6"
            sx={{ color: '#629924', fontWeight: 600, mb: 1.5 }}
          >
            {step.title}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: '#aaa', lineHeight: 1.8, whiteSpace: 'pre-line' }}
          >
            {step.description}
          </Typography>

          {/* Annotations list */}
          {step.boardAnnotations && step.boardAnnotations.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
                棋盘标注:
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {step.boardAnnotations.map((ann, i) => (
                  <Chip
                    key={i}
                    label={`${ann.pos}: ${ann.label}`}
                    size="small"
                    sx={{
                      fontSize: '0.6rem',
                      height: 20,
                      bgcolor: 'rgba(255,255,255,0.05)',
                      color: ann.color ?? '#ccc',
                      border: `1px solid ${ann.color ?? '#555'}`,
                    }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Paper>
      </Box>

      {/* Navigation Buttons */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 2,
          mt: 3,
        }}
      >
        <Button
          variant="outlined"
          startIcon={<PrevIcon />}
          onClick={handlePrev}
          disabled={currentStep === 0}
          sx={{
            borderColor: '#555',
            color: '#aaa',
            '&:hover': { borderColor: '#888' },
            '&.Mui-disabled': { borderColor: '#333', color: '#444' },
          }}
        >
          上一步
        </Button>
        {currentStep < TUTORIAL_STEPS.length - 1 ? (
          <Button
            variant="contained"
            endIcon={<NextIcon />}
            onClick={handleNext}
            sx={{
              bgcolor: '#629924',
              '&:hover': { bgcolor: '#7ab528' },
            }}
          >
            下一步
          </Button>
        ) : (
          <Button
            variant="contained"
            endIcon={<PlayIcon />}
            onClick={handleEnterBattle}
            sx={{
              bgcolor: '#629924',
              '&:hover': { bgcolor: '#7ab528' },
            }}
          >
            进入实战
          </Button>
        )}
      </Box>

      {/* Step counter */}
      <Typography
        variant="caption"
        color="#555"
        textAlign="center"
        display="block"
        sx={{ mt: 2 }}
      >
        {currentStep + 1} / {TUTORIAL_STEPS.length}
      </Typography>
    </Box>
  );
}

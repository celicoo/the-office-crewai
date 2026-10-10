import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Agent, ViewMode, DataTransferBeam } from '../../types/agent';
import { computeOfficeDimensions, computeDeskPosition } from '../../utils/officeLayout';
import {
  buildFloorObstacles,
  loungeOrigin,
  findPath,
  stepToward,
  clampToRoom,
  type AgentBlocker,
} from '../../utils/agentNavigation';
import { Eye, Unlock } from 'lucide-react';
import { createMiniatureHumanoidMesh } from './models/humanoid';
import { createMiniatureDeskWorkstation } from './models/desk';
import {
  createCoffeeBar,
  createLoungeSet,
  createOfficePlant,
  createFilingCabinets,
} from './models/roomProps';

export interface TopPerformerInfo {
  agent: Agent;
  tasksCompleted: number;
  score: number;
}

export interface DeskMonitorFrame {
  src: string;
  url: string;
  seq: number;
  /** Wall-clock ms when this frame landed — used to detect live browsing. */
  updatedAt?: number;
}

export interface AgentReport {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  timestamp: number;
  /** Keep visible until the user replies or dismisses (questions / confirmations). */
  needsFeedback?: boolean;
}

export type BalloonScreenPos = {
  agentId: string;
  reportId: string;
  agentName: string;
  preview: string;
  x: number;
  y: number;
  visible: boolean;
};

interface AgentSceneProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onOpenWhiteboard: () => void;
  viewMode: ViewMode;
  beams?: DataTransferBeam[];
  onExitFirstPerson?: () => void;
  joystickVector?: { x: number; y: number };
  onTargetedAgentChange?: (agent: Agent | null, distance: number | null) => void;
  topPerformer?: TopPerformerInfo | null;
  onOpenLeaderboard?: () => void;
  monitorsRef?: React.MutableRefObject<Record<string, DeskMonitorFrame>>;
  onOpenMonitor?: (agentId: string) => void;
  boardNotes?: {
    id: string;
    title: string;
    content: string;
    author: string;
    color: string;
    kind?: string;
    assigneeId?: string;
    status?: string;
  }[];
  pendingReports?: AgentReport[];
  onBalloonPositions?: (balloons: BalloonScreenPos[]) => void;
  thinkingAgents?: Record<string, boolean>;
}

interface AutonomousAgentState {
  agentId: string;
  state: 'at_desk' | 'walking_to_poi' | 'at_poi' | 'walking_to_desk';
  poiType: 'coffee' | 'water' | 'window' | 'whiteboard' | 'lounge' | 'peer';
  targetPos: THREE.Vector3;
  targetFacingY: number;
  deskPos: THREE.Vector3;
  deskFacingY: number;
  currentPos: THREE.Vector3;
  currentFacingY: number;
  stayTimer: number;
  nextActionTimer: number;
  targetPeerId?: string;
  walkCycle: number;
  assignedSlotKey?: string;
  /** True when this POI is a chair the agent should sit in. */
  seatedPoi?: boolean;
  /** A* waypoints from findPath (excludes current position). */
  path?: THREE.Vector3[];
  pathIndex: number;
  stuckTimer: number;
  lastProgressPos: THREE.Vector3;
  _lastBadgeKey?: string;
}

function applySitPose(anim: {
  leftHip?: THREE.Object3D;
  rightHip?: THREE.Object3D;
  leftKnee?: THREE.Object3D;
  rightKnee?: THREE.Object3D;
  leftShoulder?: THREE.Object3D;
  rightShoulder?: THREE.Object3D;
  leftElbow?: THREE.Object3D;
  rightElbow?: THREE.Object3D;
}) {
  if (anim.leftHip) anim.leftHip.rotation.x = -Math.PI / 2 + 0.05;
  if (anim.rightHip) anim.rightHip.rotation.x = -Math.PI / 2 + 0.05;
  if (anim.leftKnee) anim.leftKnee.rotation.x = Math.PI / 2 - 0.05;
  if (anim.rightKnee) anim.rightKnee.rotation.x = Math.PI / 2 - 0.05;
  if (anim.leftShoulder) anim.leftShoulder.rotation.x = -0.55;
  if (anim.rightShoulder) anim.rightShoulder.rotation.x = -0.55;
  if (anim.leftElbow) anim.leftElbow.rotation.x = -0.6;
  if (anim.rightElbow) anim.rightElbow.rotation.x = -0.6;
}

function applyStandPose(anim: {
  leftHip?: THREE.Object3D;
  rightHip?: THREE.Object3D;
  leftKnee?: THREE.Object3D;
  rightKnee?: THREE.Object3D;
  leftShoulder?: THREE.Object3D;
  rightShoulder?: THREE.Object3D;
}) {
  if (anim.leftHip) anim.leftHip.rotation.x = 0;
  if (anim.rightHip) anim.rightHip.rotation.x = 0;
  if (anim.leftKnee) anim.leftKnee.rotation.x = 0;
  if (anim.rightKnee) anim.rightKnee.rotation.x = 0;
  if (anim.leftShoulder) anim.leftShoulder.rotation.x = 0;
  if (anim.rightShoulder) anim.rightShoulder.rotation.x = 0;
}

// Dedicated POI slots with guaranteed spacing >= 1.1m to ensure agents never occupy the same space
function getAvailablePOISlots(dims: ReturnType<typeof computeOfficeDimensions>, allStates: AutonomousAgentState[]) {
  const claimed = new Set(
    allStates
      .filter(s => (s.state === 'walking_to_poi' || s.state === 'at_poi') && s.assignedSlotKey)
      .map(s => s.assignedSlotKey)
  );

  const lounge = loungeOrigin(dims);
  const slots: {
    key: string;
    poiType: AutonomousAgentState['poiType'];
    pos: THREE.Vector3;
    facingY: number;
    seated?: boolean;
  }[] = [
    // Coffee Station (Credenza Right) - Serving slot and Queue slot
    {
      key: 'coffee-0',
      poiType: 'coffee',
      pos: new THREE.Vector3(dims.coffeePos[0] + 0.45, 0, dims.coffeePos[2] + 0.85),
      facingY: Math.PI,
    },
    {
      key: 'coffee-1',
      poiType: 'coffee',
      pos: new THREE.Vector3(dims.coffeePos[0] + 0.45, 0, dims.coffeePos[2] + 1.85),
      facingY: Math.PI,
    },
    // Water Cooler (Credenza Left)
    {
      key: 'water-0',
      poiType: 'water',
      pos: new THREE.Vector3(dims.coffeePos[0] - 0.65, 0, dims.coffeePos[2] + 0.85),
      facingY: Math.PI,
    },
    {
      key: 'water-1',
      poiType: 'water',
      pos: new THREE.Vector3(dims.coffeePos[0] - 0.65, 0, dims.coffeePos[2] + 1.85),
      facingY: Math.PI,
    },
    // Lounge armchairs — sit outside the coffee-table radius so paths stay clear
    {
      key: 'lounge-0',
      poiType: 'lounge',
      pos: new THREE.Vector3(lounge.x - 0.95, 0, lounge.z + 0.15),
      facingY: Math.PI / 3,
      seated: true,
    },
    {
      key: 'lounge-1',
      poiType: 'lounge',
      pos: new THREE.Vector3(lounge.x + 0.95, 0, lounge.z + 0.15),
      facingY: -Math.PI / 3,
      seated: true,
    },
    // Whiteboard
    {
      key: 'wb-0',
      poiType: 'whiteboard',
      pos: new THREE.Vector3(dims.whiteboardPos[0] - 0.9, 0, -0.75),
      facingY: Math.PI / 2,
    },
    {
      key: 'wb-1',
      poiType: 'whiteboard',
      pos: new THREE.Vector3(dims.whiteboardPos[0] - 0.9, 0, 0.0),
      facingY: Math.PI / 2,
    },
    {
      key: 'wb-2',
      poiType: 'whiteboard',
      pos: new THREE.Vector3(dims.whiteboardPos[0] - 0.9, 0, 0.75),
      facingY: Math.PI / 2,
    },
    // Window ledge — two look points per bay, clear of the center portrait wall
    {
      key: 'win-0',
      poiType: 'window',
      pos: new THREE.Vector3(-dims.width / 4, 0, dims.windowZ + 0.9),
      facingY: Math.PI,
    },
    {
      key: 'win-1',
      poiType: 'window',
      pos: new THREE.Vector3(-dims.width / 5.5, 0, dims.windowZ + 0.9),
      facingY: Math.PI,
    },
    {
      key: 'win-2',
      poiType: 'window',
      pos: new THREE.Vector3(dims.width / 5.5, 0, dims.windowZ + 0.9),
      facingY: Math.PI,
    },
    {
      key: 'win-3',
      poiType: 'window',
      pos: new THREE.Vector3(dims.width / 4, 0, dims.windowZ + 0.9),
      facingY: Math.PI,
    },
  ];

  return slots.filter(s => !claimed.has(s.key));
}

function createGlassSheenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 512);

  // Soft vertical glass falloff (no hard diagonal glare)
  const body = ctx.createLinearGradient(0, 0, 0, 512);
  body.addColorStop(0.0, 'rgba(226, 232, 240, 0.10)');
  body.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
  body.addColorStop(1.0, 'rgba(148, 163, 184, 0.08)');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, 512, 512);

  // One gentle reflection band
  const sheen = ctx.createLinearGradient(80, 0, 420, 512);
  sheen.addColorStop(0.0, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(0.48, 'rgba(255, 255, 255, 0.18)');
  sheen.addColorStop(0.52, 'rgba(255, 255, 255, 0.06)');
  sheen.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCitySkylineTexture(): THREE.CanvasTexture {
  // Late-afternoon city through haze: depth layers, soft light, no window strobing.
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const horizon = 720;

  // --- Sky: soft blue → warm haze (photographic, not poster) ---
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#3d5a80');
  sky.addColorStop(0.22, '#6b8cae');
  sky.addColorStop(0.48, '#a8c0d4');
  sky.addColorStop(0.68, '#d4c4b0');
  sky.addColorStop(0.82, '#e8d5bc');
  sky.addColorStop(1.0, '#c9b8a4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Soft sun disc + corona (low contrast)
  const sunX = 1480;
  const sunY = 240;
  const corona = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 420);
  corona.addColorStop(0.0, 'rgba(255, 248, 230, 0.85)');
  corona.addColorStop(0.12, 'rgba(255, 220, 170, 0.35)');
  corona.addColorStop(0.35, 'rgba(232, 180, 130, 0.12)');
  corona.addColorStop(1.0, 'rgba(232, 180, 130, 0)');
  ctx.fillStyle = corona;
  ctx.fillRect(sunX - 420, sunY - 420, 840, 840);

  // Soft cloud sheets
  for (let c = 0; c < 7; c++) {
    const cx = 120 + c * 290 + (c % 2) * 40;
    const cy = 100 + (c % 4) * 50;
    const cloud = ctx.createRadialGradient(cx, cy, 20, cx, cy, 260);
    cloud.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    cloud.addColorStop(0.4, 'rgba(230, 235, 245, 0.10)');
    cloud.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cloud;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 240, 55 + (c % 3) * 12, -0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  // Helper: soft building with vertical atmosphere + optional dim window glow
  const drawTower = (
    x: number,
    baseY: number,
    w: number,
    h: number,
    topRgb: string,
    botRgb: string,
    opts: { windows?: boolean; spire?: boolean; alpha?: number } = {},
  ) => {
    const topY = baseY - h;
    const alpha = opts.alpha ?? 1;
    ctx.save();
    ctx.globalAlpha = alpha;

    // Soft side shade (left darker, right lit by sun)
    const body = ctx.createLinearGradient(x, topY, x + w, topY);
    body.addColorStop(0, topRgb);
    body.addColorStop(0.55, botRgb);
    body.addColorStop(1, topRgb);
    ctx.fillStyle = body;
    // Slightly rounded top via fill + soft roof
    ctx.fillRect(x, topY, w, h);

    // Vertical depth shade (top lighter from sky bounce)
    const vert = ctx.createLinearGradient(x, topY, x, baseY);
    vert.addColorStop(0, 'rgba(255, 245, 230, 0.10)');
    vert.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    vert.addColorStop(1, 'rgba(15, 23, 42, 0.22)');
    ctx.fillStyle = vert;
    ctx.fillRect(x, topY, w, h);

    // Soft lit edge
    ctx.fillStyle = 'rgba(255, 236, 210, 0.12)';
    ctx.fillRect(x + w - Math.max(3, w * 0.06), topY, Math.max(3, w * 0.06), h);

    // Roof plate
    ctx.fillStyle = 'rgba(20, 28, 40, 0.55)';
    ctx.fillRect(x + 4, topY - 8, w - 8, 8);

    if (opts.spire) {
      ctx.fillStyle = 'rgba(200, 210, 220, 0.45)';
      ctx.fillRect(x + w / 2 - 1.5, topY - 48, 3, 48);
    }

    if (opts.windows) {
      // Dim warm patches — suggestion of floors, not a strobing grid
      const cols = Math.max(3, Math.floor(w / 18));
      const rows = Math.max(4, Math.floor(h / 22));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = (x * 13 + r * 47 + c * 91) % 100;
          if (seed > 38) continue;
          const wx = x + 8 + c * ((w - 16) / cols);
          const wy = topY + 14 + r * ((h - 28) / rows);
          const ww = Math.max(3, (w - 16) / cols - 6);
          const wh = Math.max(3, (h - 28) / rows - 8);
          const glow =
            seed < 12
              ? 'rgba(255, 214, 160, 0.22)'
              : seed < 24
                ? 'rgba(200, 220, 235, 0.14)'
                : 'rgba(30, 40, 55, 0.25)';
          ctx.fillStyle = glow;
          ctx.fillRect(wx, wy, ww, wh);
        }
      }
    }

    ctx.restore();
  };

  // --- Far ridge / mist hills ---
  const ridge = ctx.createLinearGradient(0, horizon - 80, 0, H);
  ridge.addColorStop(0, 'rgba(140, 160, 180, 0.45)');
  ridge.addColorStop(1, 'rgba(90, 110, 130, 0.55)');
  ctx.fillStyle = ridge;
  ctx.beginPath();
  ctx.moveTo(0, horizon + 20);
  ctx.bezierCurveTo(400, horizon - 40, 900, horizon + 10, 1300, horizon - 55);
  ctx.bezierCurveTo(1600, horizon - 70, 1850, horizon - 20, W, horizon - 35);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // --- Layer A: distant haze towers (very soft) ---
  for (let i = 0; i < 28; i++) {
    const x = 10 + i * 74;
    const w = 36 + (i % 4) * 10;
    const h = 140 + ((i * 37) % 160);
    drawTower(
      x,
      horizon + 10,
      w,
      h,
      'rgba(120, 140, 160, 0.55)',
      'rgba(100, 120, 145, 0.65)',
      { alpha: 0.55 },
    );
  }

  // Atmospheric wash between far and mid
  const washFar = ctx.createLinearGradient(0, horizon - 200, 0, horizon + 40);
  washFar.addColorStop(0, 'rgba(200, 210, 220, 0)');
  washFar.addColorStop(0.6, 'rgba(180, 195, 210, 0.22)');
  washFar.addColorStop(1, 'rgba(170, 185, 200, 0.08)');
  ctx.fillStyle = washFar;
  ctx.fillRect(0, 0, W, H);

  // --- Layer B: mid city ---
  const mid: Array<{ x: number; w: number; h: number; spire?: boolean }> = [
    { x: 30, w: 95, h: 280 },
    { x: 140, w: 80, h: 340, spire: true },
    { x: 240, w: 120, h: 250 },
    { x: 380, w: 90, h: 390, spire: true },
    { x: 490, w: 110, h: 310 },
    { x: 620, w: 85, h: 420, spire: true },
    { x: 730, w: 130, h: 290 },
    { x: 880, w: 100, h: 360 },
    { x: 1000, w: 115, h: 320 },
    { x: 1140, w: 90, h: 400, spire: true },
    { x: 1260, w: 125, h: 270 },
    { x: 1410, w: 100, h: 380, spire: true },
    { x: 1540, w: 120, h: 300 },
    { x: 1680, w: 95, h: 350 },
    { x: 1800, w: 110, h: 280 },
    { x: 1930, w: 90, h: 330, spire: true },
  ];
  for (const b of mid) {
    drawTower(
      b.x,
      horizon + 25,
      b.w,
      b.h,
      'rgba(55, 70, 95, 0.92)',
      'rgba(40, 55, 78, 0.95)',
      { windows: true, spire: b.spire, alpha: 0.88 },
    );
  }

  // Soft mid haze
  const washMid = ctx.createLinearGradient(0, horizon - 120, 0, horizon + 80);
  washMid.addColorStop(0, 'rgba(212, 196, 176, 0)');
  washMid.addColorStop(0.55, 'rgba(200, 185, 165, 0.18)');
  washMid.addColorStop(1, 'rgba(180, 165, 150, 0.06)');
  ctx.fillStyle = washMid;
  ctx.fillRect(0, 0, W, H);

  // --- Layer C: near towers (richer, still calm windows) ---
  const near: Array<{ x: number; w: number; h: number; spire?: boolean }> = [
    { x: 60, w: 130, h: 460 },
    { x: 220, w: 110, h: 520, spire: true },
    { x: 360, w: 150, h: 430 },
    { x: 540, w: 120, h: 560, spire: true },
    { x: 700, w: 160, h: 480 },
    { x: 900, w: 140, h: 540, spire: true },
    { x: 1080, w: 150, h: 450 },
    { x: 1260, w: 125, h: 580, spire: true },
    { x: 1430, w: 145, h: 470 },
    { x: 1620, w: 130, h: 530, spire: true },
    { x: 1790, w: 140, h: 440 },
  ];
  for (const b of near) {
    drawTower(
      b.x,
      horizon + 45,
      b.w,
      b.h,
      'rgba(32, 42, 62, 1)',
      'rgba(22, 30, 48, 1)',
      { windows: true, spire: b.spire },
    );
  }

  // Street / park base with soft trees
  const ground = ctx.createLinearGradient(0, horizon + 20, 0, H);
  ground.addColorStop(0, 'rgba(35, 48, 62, 0.95)');
  ground.addColorStop(0.4, '#1a2433');
  ground.addColorStop(1, '#0d141f');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon + 20, W, H - horizon - 20);

  for (let tx = 0; tx < W; tx += 42) {
    const r = 16 + ((tx * 9) % 12);
    const ty = horizon + 55 + ((tx * 5) % 18);
    const tree = ctx.createRadialGradient(tx, ty, 2, tx, ty, r);
    tree.addColorStop(0, 'rgba(70, 95, 70, 0.55)');
    tree.addColorStop(0.55, 'rgba(40, 60, 48, 0.4)');
    tree.addColorStop(1, 'rgba(20, 30, 40, 0)');
    ctx.fillStyle = tree;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ground fog / aerial perspective
  const fog = ctx.createLinearGradient(0, horizon - 60, 0, horizon + 160);
  fog.addColorStop(0, 'rgba(220, 210, 195, 0)');
  fog.addColorStop(0.35, 'rgba(210, 200, 185, 0.20)');
  fog.addColorStop(0.7, 'rgba(180, 190, 200, 0.28)');
  fog.addColorStop(1, 'rgba(30, 40, 55, 0.15)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, H);

  // Fine film grain so it doesn't read as flat vector paper
  const grain = ctx.getImageData(0, 0, W, H);
  const data = grain.data;
  for (let i = 0; i < data.length; i += 4) {
    // Sparse cheap noise
    if ((i / 4) % 17 !== 0) continue;
    const n = ((i * 1103515245 + 12345) >>> 0) % 13 - 6;
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }
  ctx.putImageData(grain, 0, 0);

  // Soft vignette
  const vig = ctx.createRadialGradient(W / 2, H * 0.48, 180, W / 2, H * 0.5, 1200);
  vig.addColorStop(0, 'rgba(15, 23, 42, 0)');
  vig.addColorStop(1, 'rgba(15, 23, 42, 0.32)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const AgentScene: React.FC<AgentSceneProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onOpenWhiteboard,
  viewMode,
  beams = [],
  onExitFirstPerson,
  joystickVector,
  onTargetedAgentChange,
  topPerformer,
  onOpenLeaderboard,
  monitorsRef,
  onOpenMonitor,
  boardNotes = [],
  pendingReports = [],
  onBalloonPositions,
  thinkingAgents,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animFrameId = useRef<number | null>(null);

  const thinkingAgentsRef = useRef<Record<string, boolean> | undefined>(thinkingAgents);
  thinkingAgentsRef.current = thinkingAgents;

  const portraitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const portraitTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const portraitMeshRef = useRef<THREE.Mesh | null>(null);
  const topPerformerRef = useRef<TopPerformerInfo | null>(topPerformer || null);
  topPerformerRef.current = topPerformer || null;

  const pendingReportsRef = useRef<AgentReport[]>(pendingReports);
  pendingReportsRef.current = pendingReports;
  const onBalloonPositionsRef = useRef(onBalloonPositions);
  onBalloonPositionsRef.current = onBalloonPositions;

  // Follow camera state
  const [isFollowing, setIsFollowing] = useState<boolean>(true);
  const isFollowingRef = useRef<boolean>(true);
  isFollowingRef.current = isFollowing;

  // Synchronized refs for render loop
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const selectedAgentIdRef = useRef<string | null>(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const beamsRef = useRef<DataTransferBeam[]>(beams);
  beamsRef.current = beams;
  const joystickVectorRef = useRef(joystickVector);
  joystickVectorRef.current = joystickVector;
  const onSelectAgentRef = useRef(onSelectAgent);
  onSelectAgentRef.current = onSelectAgent;
  const onOpenMonitorRef = useRef(onOpenMonitor);
  onOpenMonitorRef.current = onOpenMonitor;
  const onOpenWhiteboardRef = useRef(onOpenWhiteboard);
  onOpenWhiteboardRef.current = onOpenWhiteboard;
  const onOpenLeaderboardRef = useRef(onOpenLeaderboard);
  onOpenLeaderboardRef.current = onOpenLeaderboard;
  const onExitFirstPersonRef = useRef(onExitFirstPerson);
  onExitFirstPersonRef.current = onExitFirstPerson;
  const onTargetedAgentChangeRef = useRef(onTargetedAgentChange);
  onTargetedAgentChangeRef.current = onTargetedAgentChange;
  const lastTargetedAgentIdRef = useRef<string | null>(null);

  // Restore aspect ratio, FOV and reset scissor test immediately whenever view mode switches
  useEffect(() => {
    if (rendererRef.current && cameraRef.current && mountRef.current) {
      const container = mountRef.current;
      const w = Math.max(container.clientWidth || window.innerWidth, 1);
      const h = Math.max(container.clientHeight || (window.innerHeight - 64), 1);
      rendererRef.current.setScissorTest(false);
      rendererRef.current.setViewport(0, 0, w, h);
      rendererRef.current.setScissor(0, 0, w, h);
      cameraRef.current.aspect = viewMode === 'vr-stereo' ? (Math.floor(w / 2) / h) : (w / h);
      cameraRef.current.fov = viewMode === 'isometric' ? 40 : 72;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h, false);
      if (rendererRef.current.domElement) {
        rendererRef.current.domElement.style.width = '100%';
        rendererRef.current.domElement.style.height = '100%';
        rendererRef.current.domElement.style.display = 'block';
      }
    }
  }, [viewMode]);

  useEffect(() => {
    paintBoardRef.current();
  }, [boardNotes]);

  // Scene sub-groups
  const roomGroupRef = useRef<THREE.Group>(new THREE.Group());
  const desksGroupRef = useRef<THREE.Group>(new THREE.Group());
  const agentsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const beamMeshesGroup = useRef<THREE.Group>(new THREE.Group());
  // Solid wall fixtures — hidden when the orbit camera is outside that facade
  const leftFacadeRef = useRef<THREE.Group>(new THREE.Group());
  const rightFacadeRef = useRef<THREE.Group>(new THREE.Group());
  const backFacadeRef = useRef<THREE.Group>(new THREE.Group());

  // Entity registries
  const deskMeshesMap = useRef<Map<string, {
    deskGroup: THREE.Group;
    crtScreen: THREE.Mesh;
    paperNotepad: THREE.Mesh;
    selectionPlate: THREE.Mesh;
    screenCanvas?: HTMLCanvasElement;
    screenTexture?: THREE.CanvasTexture;
    screenSeq?: number;
    painting?: boolean;
    livePage?: boolean;
  }>>(new Map());
  const monitorsRefLocal = useRef(monitorsRef);
  monitorsRefLocal.current = monitorsRef;
  const agentMeshesMap = useRef<Map<string, {
    humanoidGroup: THREE.Group;
    animParts: any;
    statusCanvas: HTMLCanvasElement;
    statusTexture: THREE.CanvasTexture;
    statusSprite: THREE.Sprite;
    balloonCanvas?: HTMLCanvasElement;
    balloonTexture?: THREE.CanvasTexture;
    balloonSprite?: THREE.Sprite;
  }>>(new Map());
  const autonomousStatesRef = useRef<Map<string, AutonomousAgentState>>(new Map());
  const whiteboardMeshRef = useRef<THREE.Mesh | null>(null);
  const boardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const boardNotesRef = useRef(boardNotes);
  boardNotesRef.current = boardNotes;
  const paintBoardRef = useRef<() => void>(() => {});
  paintBoardRef.current = () => {
    const canvas = boardCanvasRef.current;
    const texture = boardTextureRef.current;
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('EpochDB  ·  team tasks', 24, 42);
    const swatches: Record<string, string> = {
      yellow: '#fde68a',
      cyan: '#bae6fd',
      pink: '#fbcfe8',
      emerald: '#bbf7d0',
    };
    const cards = boardNotesRef.current.slice(0, 6);
    if (cards.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '22px sans-serif';
      ctx.fillText('No tasks on the blackboard yet.', 24, 120);
    }
    cards.forEach((note, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 24 + column * 330;
      const y = 68 + row * 220;
      ctx.fillStyle = swatches[note.color] || swatches.yellow;
      ctx.fillRect(x, y, 310, 200);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText((note.title || '').slice(0, 32), x + 14, y + 32);
      ctx.font = '16px sans-serif';
      const body = (note.content || '').replace(/\s+/g, ' ');
      let line = '';
      let lineY = y + 64;
      for (const word of body.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 280) {
          ctx.fillText(line, x + 14, lineY);
          line = word;
          lineY += 22;
          if (lineY > y + 150) break;
        } else {
          line = next;
        }
      }
      if (line && lineY <= y + 150) ctx.fillText(line, x + 14, lineY);
      ctx.fillStyle = '#334155';
      ctx.font = '14px sans-serif';
      ctx.fillText((note.author || '').slice(0, 28), x + 14, y + 182);
    });
    texture.needsUpdate = true;
  };

  // First-person state
  const fpState = useRef({
    pos: new THREE.Vector3(0, 0.9, 3.0),
    yaw: 0,
    pitch: 0,
    keys: { w: false, a: false, s: false, d: false },
    isDragging: false,
    prevMouseX: 0,
    prevMouseY: 0,
    walkTime: 0,
  });

  // Orbit controls state for Isometric mode (RollerCoaster Tycoon / Diorama framing)
  const orbitState = useRef({
    radius: 9.8,
    theta: Math.PI / 4,
    phi: Math.PI / 3.4,
    target: new THREE.Vector3(0, 0.45, 0),
    isDragging: false,
    prevX: 0,
    prevY: 0,
  });

  // Whenever a new agent is selected, re-enable follow mode!
  useEffect(() => {
    if (selectedAgentId) {
      setIsFollowing(true);
      isFollowingRef.current = true;
    }
  }, [selectedAgentId]);

  // Draw/refresh the modern dynamic "Employee of the Month / Team Spotlight" digital wall kiosk
  const updateWallPortrait = (top: TopPerformerInfo | null) => {
    if (!portraitCanvasRef.current || !portraitTextureRef.current) return;
    const canvas = portraitCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Sleek Modern Dark Tech Gradient Background (Samsung The Frame / Smart Kiosk aesthetic)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, '#0a0f1d');
    bgGrad.addColorStop(0.5, '#111827');
    bgGrad.addColorStop(1, '#0b1120');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle modern architectural grid texture
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Outer screen bezel glow
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    // 2. Modern Header Banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(24, 20, canvas.width - 48, 56, 8);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 18px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆 DESTAQUE DO MÊS // TEAM SPOTLIGHT', canvas.width / 2, 45);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('QUADRO DE HONRA • DESEMPENHO EM TEMPO REAL', canvas.width / 2, 64);

    if (top && top.agent) {
      const a = top.agent;
      const centerX = canvas.width / 2;
      const centerY = 205;
      const radius = 95;

      // 3. Glowing Avatar Medallion Ring
      ctx.save();
      const ringGrad = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
      ringGrad.addColorStop(0, '#f59e0b');
      ringGrad.addColorStop(0.5, a.color || '#3b82f6');
      ringGrad.addColorStop(1, '#10b981');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = ringGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Portrait Studio Background
      const studioGrad = ctx.createRadialGradient(centerX, centerY - 20, 10, centerX, centerY, radius);
      studioGrad.addColorStop(0, '#1e293b');
      studioGrad.addColorStop(0.8, '#0f172a');
      studioGrad.addColorStop(1, '#020617');
      ctx.fillStyle = studioGrad;
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

      // Shoulders & Modern Business Attire
      const suitColor = a.color || '#2563eb';
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + 95, 88, 50, 0, 0, Math.PI * 2);
      ctx.fill();

      // Crisp White Collared Shirt
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(centerX - 22, centerY + 35);
      ctx.lineTo(centerX + 22, centerY + 35);
      ctx.lineTo(centerX, centerY + 85);
      ctx.closePath();
      ctx.fill();

      // Modern Silk Necktie
      ctx.fillStyle = suitColor;
      ctx.beginPath();
      ctx.moveTo(centerX - 7, centerY + 42);
      ctx.lineTo(centerX + 7, centerY + 42);
      ctx.lineTo(centerX + 10, centerY + 98);
      ctx.lineTo(centerX - 10, centerY + 98);
      ctx.closePath();
      ctx.fill();

      // Neck
      const skinTone = a.gender === 'female' ? '#f3c09f' : '#fbd0b8';
      ctx.fillStyle = skinTone;
      ctx.fillRect(centerX - 16, centerY + 12, 32, 28);

      // Face
      ctx.beginPath();
      ctx.ellipse(centerX, centerY - 12, 44, 52, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const drawEye = (x: number) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, centerY - 10, 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(x, centerY - 10, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + 1.5, centerY - 11, 1.5, 0, Math.PI * 2);
        ctx.fill();
      };
      drawEye(centerX - 16);
      drawEye(centerX + 16);

      // Glasses if Dylan
      if (a.name.includes('Dylan')) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#09090b';
        ctx.strokeRect(centerX - 28, centerY - 18, 22, 16);
        ctx.strokeRect(centerX + 6, centerY - 18, 22, 16);
        ctx.beginPath();
        ctx.moveTo(centerX - 6, centerY - 10);
        ctx.lineTo(centerX + 6, centerY - 10);
        ctx.stroke();
      }

      // Friendly smile
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY + 14, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // Hair
      const isFemale = a.gender === 'female';
      const hairColor = isFemale ? '#9a3412' : (a.name.includes('Irving') ? '#71717a' : '#1c1917');
      ctx.fillStyle = hairColor;
      if (isFemale) {
        ctx.beginPath();
        ctx.arc(centerX, centerY - 26, 48, Math.PI * 0.85, Math.PI * 2.15);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(centerX - 38, centerY - 5, 12, 36, -0.2, 0, Math.PI * 2);
        ctx.ellipse(centerX + 38, centerY - 5, 12, 36, 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(centerX, centerY - 24, 46, Math.PI * 0.9, Math.PI * 2.1);
        ctx.fill();
      }

      ctx.restore();

      // Gold Star Rank Badge
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(centerX + 72, centerY + 68, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('#1', centerX + 72, centerY + 73);

      // 4. Employee Name & Department
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px "Inter", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(a.name, canvas.width / 2, 335);

      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(a.role.toUpperCase(), canvas.width / 2, 358);

      // 5. Modern Performance Cards
      // Metric Card 1: Completed Tasks
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.beginPath();
      ctx.roundRect(36, 380, canvas.width - 72, 54, 8);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#10b981';
      ctx.stroke();

      ctx.font = 'bold 16px "Inter", sans-serif';
      ctx.fillStyle = '#34d399';
      ctx.textAlign = 'left';
      ctx.fillText(`✓ ${top.tasksCompleted} Tarefas Concluídas`, 52, 406);

      ctx.font = '12px monospace';
      ctx.fillStyle = '#a7f3d0';
      ctx.fillText('Líder do Refinamento de Dados', 52, 424);

      // Metric Card 2: Efficiency & Punctuality
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.beginPath();
      ctx.roundRect(36, 444, canvas.width - 72, 54, 8);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();

      ctx.font = 'bold 16px "Inter", sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`⚡ Eficiência: ${top.score}%`, 52, 470);

      ctx.font = '12px monospace';
      ctx.fillStyle = '#bae6fd';
      ctx.fillText('Taxa de Conclusão: 100% • Status: Ativo', 52, 488);

      // 6. Live Leaderboard Dynamic Mini-Ticker at Bottom
      ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.beginPath();
      ctx.roundRect(36, 510, canvas.width - 72, 85, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.stroke();

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('● ATUALIZAÇÃO EM TEMPO REAL', 52, 530);

      ctx.font = '11px monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`Líder Atual: ${a.name} (${top.tasksCompleted} lotes)`, 52, 550);
      ctx.fillText('Todos os colaboradores avançam autonomamente.', 52, 568);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Toque no painel para abrir o ranking completo.', 52, 584);
    } else {
      ctx.font = 'italic 16px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('Sincronizando métricas da equipe...', canvas.width / 2, 280);
    }

    // Modern Footer Bar
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, canvas.height - 24, canvas.width, 24);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('SMART OFFICE WORKSPACE • SISTEMA DE DESEMPENHO', canvas.width / 2, canvas.height - 8);

    portraitTextureRef.current.needsUpdate = true;
  };

  useEffect(() => {
    updateWallPortrait(topPerformer || null);
  }, [topPerformer]);

  // BUILD MODERN REGULAR OFFICE ENVIRONMENT (Warm, Realistic, Contemporary Tech Office)
  const rebuildRoom = (scene: THREE.Scene, agentCount: number) => {
    const dims = computeOfficeDimensions(agentCount);
    orbitState.current.radius = Math.max(6.2, Math.max(dims.width, dims.depth) * 0.72);
    const room = roomGroupRef.current;
    room.clear();

    const leftFacade = new THREE.Group();
    const rightFacade = new THREE.Group();
    const backFacade = new THREE.Group();
    leftFacadeRef.current = leftFacade;
    rightFacadeRef.current = rightFacade;
    backFacadeRef.current = backFacade;
    room.add(leftFacade);
    room.add(rightFacade);
    room.add(backFacade);

    // 1. Full oak hardwood floor across the whole office
    const woodFloorMat = new THREE.MeshStandardMaterial({
      color: 0xc29b6a,
      roughness: 0.42,
      metalness: 0.02,
    });
    const woodFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(dims.width, dims.depth),
      woodFloorMat,
    );
    woodFloor.rotation.x = -Math.PI / 2;
    woodFloor.position.y = 0;
    woodFloor.receiveShadow = true;
    room.add(woodFloor);

    // Plank seam lines across the full floor
    const plankLineMat = new THREE.LineBasicMaterial({ color: 0x854d0e, transparent: true, opacity: 0.28 });
    for (let pz = -dims.depth / 2; pz <= dims.depth / 2 + 0.001; pz += 0.28) {
      const pts = [
        new THREE.Vector3(-dims.width / 2, 0.004, pz),
        new THREE.Vector3(dims.width / 2, 0.004, pz),
      ];
      room.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), plankLineMat));
    }

    // 2. Contemporary Architectural Walls (Clean, Bright, Professional Off-White / Alabaster)
    const wallHeight = 3.2;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Crisp, clean contemporary architectural off-white
      roughness: 0.92,
      metalness: 0.0,
    });

    const baseboardMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Modern matte dark charcoal architectural trim
      roughness: 0.35,
    });

    // Left Wall
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(dims.depth, wallHeight), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-dims.width / 2, wallHeight / 2, 0);
    room.add(leftWall);

    const leftBaseboard = new THREE.Mesh(new THREE.BoxGeometry(dims.depth, 0.08, 0.03), baseboardMat);
    leftBaseboard.rotation.y = Math.PI / 2;
    leftBaseboard.position.set(-dims.width / 2 + 0.015, 0.04, 0);
    leftFacade.add(leftBaseboard);

    // Right Wall
    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(dims.depth, wallHeight), wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(dims.width / 2, wallHeight / 2, 0);
    room.add(rightWall);

    const rightBaseboard = new THREE.Mesh(new THREE.BoxGeometry(dims.depth, 0.08, 0.03), baseboardMat);
    rightBaseboard.rotation.y = -Math.PI / 2;
    rightBaseboard.position.set(dims.width / 2 - 0.015, 0.04, 0);
    rightFacade.add(rightBaseboard);

    // Back Wall Structure with Two Panoramic Window Openings
    const portraitClearance = 1.25; // solid center wall reserved for Employee of the Month kiosk
    const winBayCount = 2;
    const sideMargin = 0.55;
    const available = Math.max(1.4, (dims.width - portraitClearance) / 2 - sideMargin);
    const winBayW = Math.min(2.8, available);
    const winBayH = 1.75;
    const winBayY = 1.65;
    const winBottomY = winBayY - winBayH / 2; // ~0.775m
    const winTopY = winBayY + winBayH / 2; // ~2.525m
    const winCenters = [
      -portraitClearance / 2 - winBayW / 2 - 0.10,
      portraitClearance / 2 + winBayW / 2 + 0.10,
    ];

    // 1. Bottom wall apron below windows
    const backWallBottom = new THREE.Mesh(new THREE.PlaneGeometry(dims.width, winBottomY), wallMat);
    backWallBottom.position.set(0, winBottomY / 2, -dims.depth / 2);
    room.add(backWallBottom);

    // 2. Top wall header above windows
    const headerH = wallHeight - winTopY;
    const backWallTop = new THREE.Mesh(new THREE.PlaneGeometry(dims.width, headerH), wallMat);
    backWallTop.position.set(0, winTopY + headerH / 2, -dims.depth / 2);
    room.add(backWallTop);

    // 3. Center wall column between windows (backing the Employee of the Month kiosk)
    const centerColW = (winCenters[1] - winBayW / 2) - (winCenters[0] + winBayW / 2);
    const backWallCenter = new THREE.Mesh(new THREE.PlaneGeometry(centerColW, winBayH), wallMat);
    backWallCenter.position.set(0, winBayY, -dims.depth / 2);
    room.add(backWallCenter);

    // 4. Outer left wall column
    const leftColW = (winCenters[0] - winBayW / 2) - (-dims.width / 2);
    const backWallLeft = new THREE.Mesh(new THREE.PlaneGeometry(leftColW, winBayH), wallMat);
    backWallLeft.position.set(-dims.width / 2 + leftColW / 2, winBayY, -dims.depth / 2);
    room.add(backWallLeft);

    // 5. Outer right wall column
    const rightColW = (dims.width / 2) - (winCenters[1] + winBayW / 2);
    const backWallRight = new THREE.Mesh(new THREE.PlaneGeometry(rightColW, winBayH), wallMat);
    backWallRight.position.set(dims.width / 2 - rightColW / 2, winBayY, -dims.depth / 2);
    room.add(backWallRight);

    // Back Baseboard
    const backBaseboard = new THREE.Mesh(new THREE.BoxGeometry(dims.width, 0.08, 0.03), baseboardMat);
    backBaseboard.position.set(0, 0.04, -dims.depth / 2 + 0.015);
    backFacade.add(backBaseboard);

    // City vista behind the glass — slightly tinted so it sits in atmosphere
    const vistaTex = createCitySkylineTexture();
    const vistaW = Math.max(dims.width * 1.8, 16.0);
    const vistaH = 5.2;
    const vistaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(vistaW, vistaH),
      new THREE.MeshBasicMaterial({
        map: vistaTex,
        color: 0xe8e4dc,
        toneMapped: false,
      })
    );
    vistaMesh.position.set(0, 2.15, -dims.depth / 2 - 3.4);
    room.add(vistaMesh);

    // Soft atmospheric plane between glass and city (depth + haze)
    const hazeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(vistaW * 0.95, vistaH * 0.9),
      new THREE.MeshBasicMaterial({
        color: 0xc9b8a4,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
    );
    hazeMesh.position.set(0, 2.1, -dims.depth / 2 - 1.4);
    room.add(hazeMesh);

    // Clearer glass — soft sheen, less milky “paper” look
    const glassSheenTex = createGlassSheenTexture();
    const glassMat = new THREE.MeshStandardMaterial({
      map: glassSheenTex,
      color: 0xe8f0f8,
      transparent: true,
      opacity: 0.18,
      roughness: 0.15,
      metalness: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const windowFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.65,
      roughness: 0.25,
    });
    const winZ = -dims.depth / 2;

    for (let w = 0; w < winBayCount; w++) {
      const wx = winCenters[w];
      const frameT = 0.06;
      const frameD = 0.05;

      // Outer window frame rails
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(winBayW + frameT * 2, frameT, frameD), windowFrameMat);
      topRail.position.set(wx, winBayY + winBayH / 2 - frameT / 2, winZ + 0.02);
      backFacade.add(topRail);

      const botRail = new THREE.Mesh(new THREE.BoxGeometry(winBayW + frameT * 2, frameT, frameD), windowFrameMat);
      botRail.position.set(wx, winBayY - winBayH / 2 + frameT / 2, winZ + 0.02);
      backFacade.add(botRail);

      const leftRail = new THREE.Mesh(new THREE.BoxGeometry(frameT, winBayH, frameD), windowFrameMat);
      leftRail.position.set(wx - winBayW / 2 + frameT / 2, winBayY, winZ + 0.02);
      backFacade.add(leftRail);

      const rightRail = new THREE.Mesh(new THREE.BoxGeometry(frameT, winBayH, frameD), windowFrameMat);
      rightRail.position.set(wx + winBayW / 2 - frameT / 2, winBayY, winZ + 0.02);
      backFacade.add(rightRail);

      // Center Mullions dividing window bay into 4 panoramic panes
      const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.035, winBayH, 0.04), windowFrameMat);
      mullionV.position.set(wx, winBayY, winZ + 0.025);
      backFacade.add(mullionV);

      const mullionH = new THREE.Mesh(new THREE.BoxGeometry(winBayW, 0.035, 0.04), windowFrameMat);
      mullionH.position.set(wx, winBayY, winZ + 0.025);
      backFacade.add(mullionH);

      // Translucid Glass Pane
      const glassPane = new THREE.Mesh(new THREE.PlaneGeometry(winBayW, winBayH), glassMat);
      glassPane.position.set(wx, winBayY, winZ + 0.03);
      backFacade.add(glassPane);

      // Polished interior window sill ledge extending into the room
      const sill = new THREE.Mesh(new THREE.BoxGeometry(winBayW + 0.16, 0.04, 0.18), windowFrameMat);
      sill.position.set(wx, winBayY - winBayH / 2 - 0.02, winZ + 0.08);
      backFacade.add(sill);
    }

    // 4. Contemporary Vertical Natural Oak Slatted Accent Wall behind Whiteboard zone
    const slatWallGroup = new THREE.Group();
    slatWallGroup.position.set(dims.width / 2 - 0.02, wallHeight / 2, 0);
    slatWallGroup.rotation.y = -Math.PI / 2;
    rightFacade.add(slatWallGroup);

    // Dark Acoustic Felt Backing Panel
    const slatBack = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    );
    slatBack.position.z = 0.005;
    slatWallGroup.add(slatBack);

    // Natural Oak Vertical Slats
    const oakSlatMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.45, metalness: 0.05 });
    for (let sx = -1.95; sx <= 1.95; sx += 0.15) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.025), oakSlatMat);
      slat.position.set(sx, 0, 0.018);
      slatWallGroup.add(slat);
    }

    // 5. Modern Minimalist Office Wall Clock on Left Wall
    const clockGroup = new THREE.Group();
    clockGroup.position.set(-dims.width / 2 + 0.04, 2.3, -1.8);
    clockGroup.rotation.y = Math.PI / 2;
    leftFacade.add(clockGroup);

    const clockRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.025, 24),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.3, metalness: 0.4 })
    );
    clockRim.rotation.x = Math.PI / 2;
    clockGroup.add(clockRim);

    const clockFace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.028, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
    );
    clockFace.rotation.x = Math.PI / 2;
    clockGroup.add(clockFace);

    // Clock hour markings & hands
    const handMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.006), handMat);
    hourHand.position.set(0.03, 0.03, 0.016);
    hourHand.rotation.z = -Math.PI / 4;
    clockGroup.add(hourHand);

    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.12, 0.006), handMat);
    minHand.position.set(0, 0.05, 0.017);
    clockGroup.add(minHand);

    const secHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.14, 0.004),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    secHand.position.set(-0.02, 0.04, 0.018);
    secHand.rotation.z = Math.PI / 6;
    clockGroup.add(secHand);

    // 6. Framed Modern Architecture / Graphic Art Posters on Left Wall
    const posterGroup = new THREE.Group();
    posterGroup.position.set(-dims.width / 2 + 0.04, 1.85, 2.2);
    posterGroup.rotation.y = Math.PI / 2;
    leftFacade.add(posterGroup);

    const pFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.94, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.4 })
    );
    posterGroup.add(pFrame);

    const pCanvas = document.createElement('canvas');
    pCanvas.width = 256;
    pCanvas.height = 340;
    const pCtx = pCanvas.getContext('2d')!;
    pCtx.fillStyle = '#0f172a';
    pCtx.fillRect(0, 0, 256, 340);
    pCtx.fillStyle = '#38bdf8';
    pCtx.beginPath();
    pCtx.arc(128, 120, 60, 0, Math.PI * 2);
    pCtx.fill();
    pCtx.fillStyle = '#f59e0b';
    pCtx.beginPath();
    pCtx.arc(160, 160, 45, 0, Math.PI * 2);
    pCtx.fill();
    pCtx.fillStyle = '#ffffff';
    pCtx.font = 'bold 20px "Inter", sans-serif';
    pCtx.textAlign = 'center';
    pCtx.fillText('DEV WORKSPACE', 128, 250);
    pCtx.font = '12px monospace';
    pCtx.fillStyle = '#94a3b8';
    pCtx.fillText('DESIGN & CODE ARCHITECTURE', 128, 275);

    const posterSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.88),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(pCanvas), roughness: 0.3 })
    );
    posterSurface.position.z = 0.014;
    posterGroup.add(posterSurface);

    // 7. Entrance door scaled to the miniature agents (~1.15 tall)
    const doorH = 1.15;
    const doorW = 0.55;
    const doorGroup = new THREE.Group();
    doorGroup.position.set(-dims.width / 2 + 0.02, doorH / 2, -dims.depth / 2 + 1.6);
    doorGroup.rotation.y = Math.PI / 2;
    leftFacade.add(doorGroup);

    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.08, doorH + 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 })
    );
    doorGroup.add(doorFrame);

    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorW, doorH, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 })
    );
    doorLeaf.position.z = 0.01;
    doorGroup.add(doorLeaf);

    const doorGlass = new THREE.Mesh(
      new THREE.BoxGeometry(doorW * 0.42, doorH * 0.38, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.35,
        roughness: 0.1,
      })
    );
    doorGlass.position.set(0, doorH * 0.12, 0.02);
    doorGroup.add(doorGlass);

    const handleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.2 });
    const handleLever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.03), handleMat);
    handleLever.position.set(-doorW * 0.32, 0, 0.035);
    doorGroup.add(handleLever);

    // 8. Suspended Modern Architectural Linear LED Pendant Lights
    const linearPendantMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.3 });
    const ledGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Hang linear LED bars directly above desk pod clusters
    const podCount = Math.max(1, Math.ceil(agentCount / 4));
    const podSpacingZ = 3.2;
    const startPodZ = -(podCount - 1) * (podSpacingZ / 2) - 0.4;

    for (let p = 0; p < podCount; p++) {
      const pz = startPodZ + p * podSpacingZ;
      const pendantGroup = new THREE.Group();
      pendantGroup.position.set(0, 2.4, pz);
      room.add(pendantGroup);

      // Sleek black extruded aluminum linear light bar (2.4m long)
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.045, 0.08), linearPendantMat);
      pendantGroup.add(bar);

      // Downward glowing LED diffuser
      const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 0.075), ledGlowMat);
      diffuser.rotation.x = Math.PI / 2;
      diffuser.position.y = -0.023;
      pendantGroup.add(diffuser);

      // Suspension Aircraft Cables
      const cableMat = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
      [-1.0, 1.0].forEach(cx => {
        const cPts = [new THREE.Vector3(cx, 0, 0), new THREE.Vector3(cx, wallHeight - 2.4, 0)];
        const cGeo = new THREE.BufferGeometry().setFromPoints(cPts);
        pendantGroup.add(new THREE.Line(cGeo, cableMat));
      });
    }

    // 9. Employee of the Month kiosk — centered on the solid back-wall panel between windows
    const kioskGroup = new THREE.Group();
    kioskGroup.position.set(0, 1.35, -dims.depth / 2 + 0.05);
    backFacade.add(kioskGroup);

    // Slim matte dark titanium bezel
    const kioskBezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.90, 0.022),
      new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.3, metalness: 0.7 })
    );
    kioskGroup.add(kioskBezel);

    // Create high-res dynamic display canvas
    const pCanvas2 = document.createElement('canvas');
    pCanvas2.width = 512;
    pCanvas2.height = 640;
    portraitCanvasRef.current = pCanvas2;

    const pTexture = new THREE.CanvasTexture(pCanvas2);
    portraitTextureRef.current = pTexture;

    // Digital Screen surface
    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.86),
      new THREE.MeshStandardMaterial({ map: pTexture, roughness: 0.15, metalness: 0.05 })
    );
    screenMesh.position.z = 0.012;
    screenMesh.userData = { isPortrait: true };
    portraitMeshRef.current = screenMesh;
    kioskGroup.add(screenMesh);

    updateWallPortrait(topPerformerRef.current);

    // 10. Rolling Glass Whiteboard with Sprint Kanban
    const wbGroup = new THREE.Group();
    wbGroup.position.set(dims.whiteboardPos[0], 0, dims.whiteboardPos[2]);
    wbGroup.rotation.y = -Math.PI / 2;
    room.add(wbGroup);

    const wbAlumMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });

    [-0.9, 0.9].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 12), wbAlumMat);
      leg.position.set(lx, 0.6, 0);
      wbGroup.add(leg);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.45), wbAlumMat);
      foot.position.set(lx, 0.02, 0);
      wbGroup.add(foot);
    });

    const wbW = 2.0;
    const wbH = 1.1;
    const wbFrame = new THREE.Mesh(new THREE.BoxGeometry(wbW + 0.04, wbH + 0.04, 0.03), wbAlumMat);
    wbFrame.position.set(0, 0.85, 0);
    wbGroup.add(wbFrame);

    const wbSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(wbW, wbH),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.05 })
    );
    wbSurface.position.set(0, 0.85, 0.018);
    wbSurface.userData = { isWhiteboard: true };
    whiteboardMeshRef.current = wbSurface;
    wbGroup.add(wbSurface);

    // Marker Tray with Dry-Erase Markers
    const markerTray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.015, 0.05), wbAlumMat);
    markerTray.position.set(0, 0.31, 0.025);
    wbGroup.add(markerTray);

    const markerColors = [0x000000, 0x2563eb, 0xdc2626, 0x16a34a];
    markerColors.forEach((mColor, i) => {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.09, 8),
        new THREE.MeshStandardMaterial({ color: mColor, roughness: 0.4 })
      );
      marker.rotation.z = Math.PI / 2;
      marker.position.set(-0.15 + i * 0.1, 0.325, 0.03);
      wbGroup.add(marker);
    });

    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 1024;
    boardCanvas.height = 560;
    const boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    const boardScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(wbW, wbH),
      new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.35, metalness: 0.02 })
    );
    boardScreen.position.set(0, 0.85, 0.02);
    boardScreen.userData = { isWhiteboard: true };
    wbGroup.add(boardScreen);
    whiteboardMeshRef.current = boardScreen;
    boardCanvasRef.current = boardCanvas;
    boardTextureRef.current = boardTexture;
    paintBoardRef.current();

    // 11. Coffee bar & kitchenette
    const credenzaGroup = createCoffeeBar();
    credenzaGroup.position.set(dims.coffeePos[0], dims.coffeePos[1], dims.coffeePos[2]);
    room.add(credenzaGroup);

    // 12. Lounge seating
    const loungeGroup = createLoungeSet();
    loungeGroup.position.set(-dims.width / 2 + 3.2, 0, dims.depth / 2 - 1.6);
    room.add(loungeGroup);

    // 13. Fiddle-leaf planter
    const plantGroup = createOfficePlant();
    plantGroup.position.set(-dims.width / 2 + 1.1, 0, dims.depth / 2 - 4.4);
    room.add(plantGroup);

    // 14. Metal filing cabinets (layout reserved this spot)
    const cabinets = createFilingCabinets();
    cabinets.position.set(dims.filingCabinetsPos[0], 0, dims.filingCabinetsPos[2]);
    cabinets.rotation.y = -Math.PI / 2;
    room.add(cabinets);
  };

  // HELPER: Update or draw tiny sprite status badge above agent head
  const updateStatusBadge = (canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, agent: Agent, autoState?: AutonomousAgentState) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = agent.status === 'thinking' ? '#f59e0b' : '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 12);
    ctx.fill();
    ctx.stroke();

    // Agent name
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(agent.name, canvas.width / 2, 32);

    // Activity / Model status subtitle
    ctx.font = '13px monospace';
    let activityText: string = agent.model || 'gemini-3.5-flash-lite';
    const hasUnread = (pendingReportsRef.current || []).some(r => r.agentId === agent.id);
    if (agent.status === 'speaking') {
      ctx.fillStyle = '#34d399';
      activityText = '● Falando';
    } else if (hasUnread) {
      ctx.fillStyle = '#fbbf24';
      activityText = '💬 Nova mensagem';
    } else if (agent.status === 'thinking') {
      ctx.fillStyle = '#fbbf24';
      activityText = '● Pensando...';
    } else if (autoState && autoState.state !== 'at_desk') {
      ctx.fillStyle = '#94a3b8';
      if (autoState.poiType === 'coffee') activityText = 'Pausa do café';
      else if (autoState.poiType === 'water') activityText = 'Bebendo água';
      else if (autoState.poiType === 'whiteboard') activityText = 'No quadro';
      else activityText = 'Em deslocamento';
    } else {
      ctx.fillStyle = '#38bdf8';
      activityText = agent.currentActivity === 'writing_paper' ? 'Anotando (bloco)' : 'Refinando (CRT)';
    }

    ctx.fillText(activityText, canvas.width / 2, 52);
    texture.needsUpdate = true;
  };

  const updateSpeechBalloon = (
    canvas: HTMLCanvasElement | undefined,
    texture: THREE.CanvasTexture | undefined,
    sprite: THREE.Sprite | undefined,
    preview: string | null,
  ) => {
    if (!sprite || !canvas || !texture) return;
    if (!preview) {
      sprite.visible = false;
      return;
    }
    sprite.visible = true;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Comic speech balloon
    const pad = 14;
    const w = canvas.width;
    const h = canvas.height - 18;
    ctx.fillStyle = 'rgba(255, 251, 235, 0.96)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(pad, 8, w - pad * 2, h - 8, 16);
    ctx.fill();
    ctx.stroke();

    // Tail pointing down to head
    ctx.beginPath();
    ctx.moveTo(w / 2 - 12, h);
    ctx.lineTo(w / 2, h + 16);
    ctx.lineTo(w / 2 + 12, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 251, 235, 0.96)';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines: string[] = [];
    const words = preview.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - pad * 2 - 20 && line) {
        lines.push(line);
        line = word;
        if (lines.length >= 3) break;
      } else {
        line = test;
      }
    }
    if (line && lines.length < 3) lines.push(line);
    if (words.length > 0 && lines.join(' ').length < preview.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
    }
    const startY = 8 + (h - 8) / 2 - ((lines.length - 1) * 13);
    lines.forEach((l, i) => {
      ctx.fillText(l, w / 2, startY + i * 26);
    });
    texture.needsUpdate = true;
  };

  // SYNC WORKSTATIONS (DESKS) AND MINIATURE EMPLOYEES
  const syncEntities = (currentAgents: Agent[]) => {
    const currentAgentIds = new Set(currentAgents.map(a => a.id));
    const desksGroup = desksGroupRef.current;
    const agentsGroup = agentsGroupRef.current;

    // 1. Remove deleted entities
    deskMeshesMap.current.forEach((deskData, id) => {
      if (!currentAgentIds.has(id)) {
        desksGroup.remove(deskData.deskGroup);
        deskMeshesMap.current.delete(id);
      }
    });

    agentMeshesMap.current.forEach((agentData, id) => {
      if (!currentAgentIds.has(id)) {
        agentsGroup.remove(agentData.humanoidGroup);
        agentMeshesMap.current.delete(id);
        autonomousStatesRef.current.delete(id);
      }
    });

    // 2. Add or update workstations and miniature employees
    currentAgents.forEach((agent, index) => {
      const transform = computeDeskPosition(index, currentAgents.length);
      const deskX = transform.pos[0];
      const deskZ = transform.pos[2];
      const deskRotY = transform.rotationY;
      const seatX = transform.seatPos[0];
      const seatZ = transform.seatPos[2];
      const seatRotY = transform.seatRotationY;

      // Desk Workstation
      let deskItem = deskMeshesMap.current.get(agent.id);
      if (!deskItem) {
        deskItem = createMiniatureDeskWorkstation(agent);
        desksGroup.add(deskItem.deskGroup);
        deskMeshesMap.current.set(agent.id, deskItem);
      }
      deskItem.deskGroup.position.set(deskX, 0, deskZ);
      deskItem.deskGroup.rotation.y = deskRotY;

      // Miniature Humanoid Employee Character (RollerCoaster Tycoon Peep proportion)
      let agentItem = agentMeshesMap.current.get(agent.id);
      if (!agentItem) {
        agentItem = createMiniatureHumanoidMesh(agent, index);
        agentsGroup.add(agentItem.humanoidGroup);
        agentMeshesMap.current.set(agent.id, agentItem);

        // Seated facing desk CRT with hips and knees properly bent
        agentItem.humanoidGroup.position.set(seatX, agentItem.animParts.sitY, seatZ);
        agentItem.humanoidGroup.rotation.y = seatRotY;

        if (agentItem.animParts.leftHip) {
          agentItem.animParts.leftHip.rotation.x = -Math.PI / 2 + 0.08;
          agentItem.animParts.rightHip.rotation.x = -Math.PI / 2 + 0.08;
          agentItem.animParts.leftKnee.rotation.x = Math.PI / 2 - 0.08;
          agentItem.animParts.rightKnee.rotation.x = Math.PI / 2 - 0.08;
          agentItem.animParts.leftShoulder.rotation.x = -0.7;
          agentItem.animParts.rightShoulder.rotation.x = -0.7;
          agentItem.animParts.leftElbow.rotation.x = -0.75;
          agentItem.animParts.rightElbow.rotation.x = -0.75;
        }

        autonomousStatesRef.current.set(agent.id, {
          agentId: agent.id,
          state: 'at_desk',
          poiType: 'coffee',
          targetPos: new THREE.Vector3(seatX, 0, seatZ),
          targetFacingY: seatRotY,
          deskPos: new THREE.Vector3(seatX, 0, seatZ),
          deskFacingY: seatRotY,
          currentPos: new THREE.Vector3(seatX, 0, seatZ),
          currentFacingY: seatRotY,
          stayTimer: 0,
          nextActionTimer: 10 + Math.random() * 14,
          walkCycle: 0,
          pathIndex: 0,
          stuckTimer: 0,
          lastProgressPos: new THREE.Vector3(seatX, 0, seatZ),
        });

        updateStatusBadge(agentItem.statusCanvas, agentItem.statusTexture, agent);
      } else {
        const auto = autonomousStatesRef.current.get(agent.id);
        if (auto) {
          auto.deskPos.set(seatX, 0, seatZ);
          auto.deskFacingY = seatRotY;
          if (auto.state === 'at_desk') {
            auto.currentPos.set(seatX, 0, seatZ);
            auto.currentFacingY = seatRotY;
            agentItem.humanoidGroup.position.set(seatX, agentItem.animParts.sitY, seatZ);
            agentItem.humanoidGroup.rotation.y = seatRotY;
          }
        }
        updateStatusBadge(agentItem.statusCanvas, agentItem.statusTexture, agent, auto);
      }
    });
  };

  // MAIN SETUP (Runs ONCE on mount)
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = Math.max(container.clientWidth || window.innerWidth, 1);
    const height = Math.max(container.clientHeight || (window.innerHeight - 64), 1);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2332);
    scene.fog = new THREE.FogExp2(0x1a2332, 0.028);
    sceneRef.current = scene;

    // Camera (Elevated Tycoon / Diorama framing)
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    rendererRef.current = renderer;

    container.replaceChildren(renderer.domElement);

    // Warm interior, cool window light — keep rim subtle so city stays calm
    const ambientLight = new THREE.AmbientLight(0xfff1e0, 0.45);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xdbe7f3, 0xb8956a, 0.48);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffe0b8, 0.95);
    sunLight.position.set(4.5, 9, -8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.bias = -0.00025;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 28;
    sunLight.shadow.camera.left = -8;
    sunLight.shadow.camera.right = 8;
    sunLight.shadow.camera.top = 8;
    sunLight.shadow.camera.bottom = -8;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xcbd5e1, 0.28);
    fillLight.position.set(-7, 9, 4);
    scene.add(fillLight);

    const frontLight = new THREE.DirectionalLight(0xfff7ed, 0.22);
    frontLight.position.set(0, 7, 9);
    scene.add(frontLight);

    const rimLight = new THREE.DirectionalLight(0xa8c0d4, 0.14);
    rimLight.position.set(-3, 4, 10);
    scene.add(rimLight);

    // Add Scene Subgroups
    scene.add(roomGroupRef.current);
    scene.add(desksGroupRef.current);
    scene.add(agentsGroupRef.current);
    scene.add(beamMeshesGroup.current);

    // Initial Build
    rebuildRoom(scene, agentsRef.current.length);
    syncEntities(agentsRef.current);

    // Resize Observer
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(entry.contentRect.width, 1);
        const h = Math.max(entry.contentRect.height, 1);
        if (cameraRef.current && rendererRef.current) {
          cameraRef.current.aspect = w / h;
          cameraRef.current.updateProjectionMatrix();
          rendererRef.current.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Interactive pointer handlers
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      if (viewModeRef.current === 'first-person' || viewModeRef.current === 'vr-stereo') {
        fpState.current.isDragging = true;
        fpState.current.prevMouseX = clientX;
        fpState.current.prevMouseY = clientY;
      } else {
        orbitState.current.isDragging = true;
        orbitState.current.prevX = clientX;
        orbitState.current.prevY = clientY;
      }
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      if (viewModeRef.current === 'first-person' || viewModeRef.current === 'vr-stereo') {
        if (!fpState.current.isDragging) return;
        const deltaX = clientX - fpState.current.prevMouseX;
        const deltaY = clientY - fpState.current.prevMouseY;
        fpState.current.prevMouseX = clientX;
        fpState.current.prevMouseY = clientY;

        fpState.current.yaw -= deltaX * 0.0035;
        fpState.current.pitch -= deltaY * 0.003;
        fpState.current.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, fpState.current.pitch));
      } else {
        if (!orbitState.current.isDragging) return;
        const dx = clientX - orbitState.current.prevX;
        const dy = clientY - orbitState.current.prevY;
        orbitState.current.prevX = clientX;
        orbitState.current.prevY = clientY;

        orbitState.current.theta -= dx * 0.007;
        orbitState.current.phi = Math.max(0.25, Math.min(Math.PI / 2.2, orbitState.current.phi - dy * 0.007));
      }
    };

    const handlePointerUp = () => {
      fpState.current.isDragging = false;
      orbitState.current.isDragging = false;
    };

    const handleWheel = (e: WheelEvent) => {
      if (viewModeRef.current === 'isometric') {
        orbitState.current.radius = Math.max(3.5, Math.min(20, orbitState.current.radius + e.deltaY * 0.01));
      }
    };

    const handleCanvasClick = (e: MouseEvent) => {
      if (!cameraRef.current || !sceneRef.current || !mountRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);

      // Check Whiteboard click
      if (whiteboardMeshRef.current) {
        const wbHits = raycaster.intersectObject(whiteboardMeshRef.current, true);
        if (wbHits.length > 0) {
          if (onOpenWhiteboardRef.current) onOpenWhiteboardRef.current();
          return;
        }
      }

      // Check Employee of the Month Wall Portrait click
      if (portraitMeshRef.current) {
        const pHits = raycaster.intersectObject(portraitMeshRef.current, true);
        if (pHits.length > 0) {
          if (onOpenLeaderboardRef.current) onOpenLeaderboardRef.current();
          return;
        }
      }

      // Check Agent humanoid or Desk click
      const hitList: { agentId: string; distance: number }[] = [];

      agentMeshesMap.current.forEach((item, agentId) => {
        const hits = raycaster.intersectObjects(item.humanoidGroup.children, true);
        if (hits.length > 0) hitList.push({ agentId, distance: hits[0].distance });
      });

      let bestScreenAgentId: string | null = null;
      let bestScreenDist = Infinity;
      deskMeshesMap.current.forEach((item, agentId) => {
        const screenHits = raycaster.intersectObject(item.crtScreen, false);
        if (screenHits.length > 0 && screenHits[0].distance < bestScreenDist) {
          bestScreenDist = screenHits[0].distance;
          bestScreenAgentId = agentId;
        }
        const hits = raycaster.intersectObjects(item.deskGroup.children, true);
        if (hits.length > 0) hitList.push({ agentId, distance: hits[0].distance });
      });

      if (bestScreenAgentId && onOpenMonitorRef.current) {
        onOpenMonitorRef.current(bestScreenAgentId);
        return;
      }

      if (hitList.length > 0) {
        hitList.sort((a, b) => a.distance - b.distance);
        const clickedId = hitList[0].agentId;
        setIsFollowing(true);
        isFollowingRef.current = true;
        if (onSelectAgentRef.current) onSelectAgentRef.current(clickedId);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') fpState.current.keys.w = true;
      if (k === 's' || k === 'arrowdown') fpState.current.keys.s = true;
      if (k === 'a' || k === 'arrowleft') fpState.current.keys.a = true;
      if (k === 'd' || k === 'arrowright') fpState.current.keys.d = true;
      if (k === 'escape') {
        setIsFollowing(false);
        isFollowingRef.current = false;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') fpState.current.keys.w = false;
      if (k === 's' || k === 'arrowdown') fpState.current.keys.s = false;
      if (k === 'a' || k === 'arrowleft') fpState.current.keys.a = false;
      if (k === 'd' || k === 'arrowright') fpState.current.keys.d = false;
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    dom.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('touchmove', handlePointerMove, { passive: true });
    window.addEventListener('touchend', handlePointerUp);
    dom.addEventListener('wheel', handleWheel, { passive: true });
    dom.addEventListener('click', handleCanvasClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // ANIMATION & BEHAVIOR LOOP
    const clock = new THREE.Timer();
    clock.connect(document);

    const animate = () => {
      animFrameId.current = requestAnimationFrame(animate);
      clock.update();
      const delta = Math.min(clock.getDelta(), 0.1);
      const time = clock.getElapsed();

      const dims = computeOfficeDimensions(agentsRef.current.length);
      const floorObstacles = buildFloorObstacles(dims, agentsRef.current.length);
      const mode = viewModeRef.current;

      const agentBlockersFor = (selfId: string): AgentBlocker[] => {
        const blockers: AgentBlocker[] = [];
        autonomousStatesRef.current.forEach((other, otherId) => {
          if (otherId === selfId) return;
          // Only other walkers gently steer — never hard-block progress
          const seated = other.state === 'at_desk' || (other.state === 'at_poi' && other.seatedPoi);
          if (seated) return;
          blockers.push({
            x: other.currentPos.x,
            z: other.currentPos.z,
            radius: 0.22,
          });
        });
        return blockers;
      };

      // AUTONOMOUS AGENT IDLE BEHAVIOR & MOVEMENT SIMULATION
      autonomousStatesRef.current.forEach((autoState, agentId) => {
        const agent = agentsRef.current.find(a => a.id === agentId);
        const meshData = agentMeshesMap.current.get(agentId);
        if (!agent || !meshData) return;

        // Migrate any leftover report-queue states from older sessions
        if ((autoState.state as string) === 'approaching_player' || (autoState.state as string) === 'waiting_near_player') {
          autoState.state = 'walking_to_desk';
          autoState.targetPos.copy(autoState.deskPos);
          autoState.targetFacingY = autoState.deskFacingY;
        }

        const humanoid = meshData.humanoidGroup;
        const anim = meshData.animParts;
        const hasActiveTask = (boardNotesRef.current || []).some(
          n => (n.kind === 'Task' || n.kind === 'Handoff') &&
               (n.assigneeId === agentId || n.title?.includes(agent.name)) &&
               n.status !== 'done' &&
               n.status !== 'completed' &&
               n.status !== 'failed' &&
               n.status !== 'reassigned' &&
               n.status !== 'cancelled' &&
               n.status !== 'blocked'
        );
        const monitorFrame = monitorsRefLocal.current?.current?.[agentId];
        const isBrowsing = Boolean(
          monitorFrame?.src &&
          typeof monitorFrame.updatedAt === 'number' &&
          (Date.now() - monitorFrame.updatedAt) < 3500
        );
        const isBusy = agent.status === 'thinking' || Boolean(thinkingAgentsRef.current?.[agentId]) || hasActiveTask;
        const isSpeaking = agent.status === 'speaking';
        const isSelected = selectedAgentIdRef.current === agentId;
        const isTargeted = lastTargetedAgentIdRef.current === agentId;
        const agentReports = (pendingReportsRef.current || []).filter(r => r.agentId === agentId);
        const hasPendingReport = agentReports.length > 0;

        // Dynamic badge + speech balloon
        const badgeKey = `${isSpeaking ? 'speaking' : isBusy ? 'thinking' : agent.status}:${isBrowsing}:${autoState.state}:${hasPendingReport}:${agentReports[0]?.id || ''}`;
        if (autoState._lastBadgeKey !== badgeKey) {
          autoState._lastBadgeKey = badgeKey;
          const displayAgent = isSpeaking
            ? { ...agent, status: 'speaking' as const }
            : isBusy
              ? { ...agent, status: 'thinking' as const }
              : agent;
          updateStatusBadge(meshData.statusCanvas, meshData.statusTexture, displayAgent, autoState);
          const preview = hasPendingReport
            ? agentReports[0].content.replace(/\s+/g, ' ').trim().slice(0, 90)
            : null;
          updateSpeechBalloon(
            meshData.balloonCanvas,
            meshData.balloonTexture,
            meshData.balloonSprite,
            preview,
          );
        }

        // Stay put while the player has them selected or is aiming at them.
        const isFrozen = isSelected || isTargeted;

        // Live browser session: walk back to the desk and sit (never teleport)
        if (isBrowsing) {
          autoState.assignedSlotKey = undefined;
          autoState.seatedPoi = false;
          autoState.path = undefined;
          autoState.pathIndex = 0;
          if (autoState.state === 'at_desk') {
            autoState.currentPos.copy(autoState.deskPos);
            autoState.targetPos.copy(autoState.deskPos);
            autoState.targetFacingY = autoState.deskFacingY;
            humanoid.position.set(autoState.deskPos.x, anim.sitY, autoState.deskPos.z);
            humanoid.rotation.y = autoState.deskFacingY;
            applySitPose(anim);
            return;
          }
          if (autoState.state !== 'walking_to_desk') {
            autoState.state = 'walking_to_desk';
            autoState.targetPos.copy(autoState.deskPos);
            autoState.targetFacingY = autoState.deskFacingY;
            autoState.walkCycle = 0;
            autoState.stuckTimer = 0;
            autoState.path = findPath(
              autoState.currentPos,
              autoState.deskPos,
              dims,
              floorObstacles,
            );
            autoState.pathIndex = 0;
            humanoid.position.y = 0;
            applyStandPose(anim);
          }
          // Fall through to walking_to_desk handling below
        }

        if (isFrozen && !isBrowsing) {
          // Hold exactly where they are — no wander, no teleport, no return walk.
          if (autoState.state === 'at_desk') {
            humanoid.position.set(autoState.deskPos.x, anim.sitY, autoState.deskPos.z);
            humanoid.rotation.y = autoState.deskFacingY;
            applySitPose(anim);
          } else if (autoState.state === 'at_poi' && autoState.seatedPoi) {
            humanoid.position.set(autoState.currentPos.x, anim.sitY, autoState.currentPos.z);
            humanoid.rotation.y = autoState.targetFacingY;
            applySitPose(anim);
          } else {
            humanoid.position.set(autoState.currentPos.x, 0, autoState.currentPos.z);
            applyStandPose(anim);
          }
          return;
        }

        // State Machine for Autonomous Movement
        if (autoState.state === 'at_desk') {
          autoState.currentPos.copy(autoState.deskPos);
          humanoid.position.set(autoState.deskPos.x, anim.sitY, autoState.deskPos.z);
          humanoid.rotation.y = autoState.deskFacingY;
          applySitPose(anim);

          if (!isBrowsing && !isFrozen) {
            autoState.nextActionTimer -= delta;
            if (autoState.nextActionTimer <= 0) {
              const availableSlots = getAvailablePOISlots(dims, Array.from(autonomousStatesRef.current.values()));
              if (availableSlots.length > 0) {
                const chosenSlot = availableSlots[Math.floor(Math.random() * availableSlots.length)];
                autoState.poiType = chosenSlot.poiType;
                autoState.assignedSlotKey = chosenSlot.key;
                autoState.seatedPoi = !!chosenSlot.seated;
                autoState.targetPos.copy(chosenSlot.pos);
                autoState.targetFacingY = chosenSlot.facingY;
                autoState.state = 'walking_to_poi';
                autoState.stayTimer = 8 + Math.random() * 8;
                autoState.walkCycle = 0;
                autoState.path = findPath(
                  autoState.currentPos,
                  chosenSlot.pos,
                  dims,
                  floorObstacles,
                );
                autoState.pathIndex = 0;
                autoState.stuckTimer = 0;
                autoState.lastProgressPos.copy(autoState.currentPos);
                humanoid.position.y = 0;
                applyStandPose(anim);
              } else {
                autoState.nextActionTimer = 8 + Math.random() * 8;
              }
            }
          }
        } else if (autoState.state === 'walking_to_poi' || autoState.state === 'walking_to_desk') {
          const moveSpeed = 2.15 * delta;
          const finalGoal = autoState.targetPos;
          const distToFinal = autoState.currentPos.distanceTo(finalGoal);

          // Ensure we have a clear A* route around furniture
          if (!autoState.path || autoState.path.length === 0) {
            autoState.path = findPath(autoState.currentPos, finalGoal, dims, floorObstacles);
            autoState.pathIndex = 0;
          }

          // Advance along waypoints
          while (
            autoState.path &&
            autoState.pathIndex < autoState.path.length - 1 &&
            autoState.currentPos.distanceTo(autoState.path[autoState.pathIndex]) < 0.18
          ) {
            autoState.pathIndex += 1;
          }

          const steerGoal =
            autoState.path && autoState.pathIndex < autoState.path.length
              ? autoState.path[autoState.pathIndex]
              : finalGoal;

          if (distToFinal > 0.12) {
            const before = autoState.currentPos.clone();
            const blockers =
              autoState.stuckTimer > 0.4 || distToFinal < 0.5 ? [] : agentBlockersFor(agentId);

            const faceYaw = stepToward(
              autoState.currentPos,
              steerGoal,
              moveSpeed,
              dims,
              blockers,
            );

            const moved = before.distanceTo(autoState.currentPos);
            const progress = before.distanceTo(finalGoal) - autoState.currentPos.distanceTo(finalGoal);
            if (moved < moveSpeed * 0.1 || progress < -0.02) {
              autoState.stuckTimer += delta;
              if (autoState.stuckTimer > 0.5) {
                // Replan from current position
                autoState.path = findPath(autoState.currentPos, finalGoal, dims, floorObstacles);
                autoState.pathIndex = 0;
                autoState.stuckTimer = 0;
              }
            } else {
              autoState.stuckTimer = Math.max(0, autoState.stuckTimer - delta);
              autoState.lastProgressPos.copy(autoState.currentPos);
            }

            clampToRoom(autoState.currentPos, dims);

            autoState.walkCycle += delta * 15;
            humanoid.rotation.y = faceYaw;

            const swing = Math.sin(autoState.walkCycle);
            const hipY = typeof anim.hipY === 'number' ? anim.hipY : 0.38;
            const stanceAngle = Math.abs(swing) * 0.38;
            const groundedPelvisY = -hipY * (1 - Math.cos(stanceAngle));

            humanoid.position.set(
              autoState.currentPos.x,
              groundedPelvisY,
              autoState.currentPos.z,
            );

            if (anim.leftHip && anim.rightHip) {
              anim.leftHip.rotation.x = swing * 0.38;
              anim.rightHip.rotation.x = -swing * 0.38;
            }
            if (anim.leftKnee && anim.rightKnee) {
              anim.leftKnee.rotation.x = swing > 0 ? swing * 0.55 : 0;
              anim.rightKnee.rotation.x = swing < 0 ? -swing * 0.55 : 0;
            }
            if (anim.leftShoulder && anim.rightShoulder) {
              anim.leftShoulder.rotation.x = -swing * 0.3;
              anim.rightShoulder.rotation.x = swing * 0.3;
            }
          } else {
            autoState.path = undefined;
            autoState.pathIndex = 0;
            autoState.stuckTimer = 0;
            if (autoState.state === 'walking_to_poi') {
              autoState.state = 'at_poi';
              autoState.currentPos.copy(autoState.targetPos);
              if (autoState.seatedPoi) {
                humanoid.position.set(autoState.targetPos.x, anim.sitY, autoState.targetPos.z);
                humanoid.rotation.y = autoState.targetFacingY;
                applySitPose(anim);
                if (anim.leftShoulder) anim.leftShoulder.rotation.x = 0;
                if (anim.rightShoulder) anim.rightShoulder.rotation.x = 0;
              } else {
                humanoid.position.set(autoState.targetPos.x, 0, autoState.targetPos.z);
                humanoid.rotation.y = autoState.targetFacingY;
                applyStandPose(anim);
              }
            } else {
              autoState.assignedSlotKey = undefined;
              autoState.seatedPoi = false;
              autoState.state = 'at_desk';
              autoState.nextActionTimer = 12 + Math.random() * 16;
              autoState.currentPos.copy(autoState.deskPos);
              humanoid.position.set(autoState.deskPos.x, anim.sitY, autoState.deskPos.z);
              humanoid.rotation.y = autoState.deskFacingY;
              applySitPose(anim);
            }
          }
        } else if (autoState.state === 'at_poi') {
          if (autoState.seatedPoi) {
            humanoid.position.set(autoState.currentPos.x, anim.sitY, autoState.currentPos.z);
            applySitPose(anim);
          } else {
            humanoid.position.set(autoState.currentPos.x, 0, autoState.currentPos.z);
          }
          autoState.stayTimer -= delta;
          if (autoState.stayTimer <= 0 || isBrowsing) {
            autoState.assignedSlotKey = undefined;
            autoState.seatedPoi = false;
            autoState.path = findPath(
              autoState.currentPos,
              autoState.deskPos,
              dims,
              floorObstacles,
            );
            autoState.pathIndex = 0;
            autoState.stuckTimer = 0;
            autoState.state = 'walking_to_desk';
            autoState.targetPos.copy(autoState.deskPos);
            autoState.targetFacingY = autoState.deskFacingY;
            autoState.walkCycle = 0;
            humanoid.position.y = 0;
            applyStandPose(anim);
          } else {
            humanoid.rotation.y = autoState.targetFacingY;
            if (autoState.seatedPoi) {
              // Quiet sit in the lounge chair
              if (anim.leftShoulder) anim.leftShoulder.rotation.x = 0;
              if (anim.rightShoulder) anim.rightShoulder.rotation.x = Math.sin(time * 0.6) * 0.05;
            } else if (autoState.poiType === 'whiteboard') {
              if (anim.rightShoulder) {
                anim.rightShoulder.rotation.x = -Math.PI / 2.3 + Math.sin(time * 3) * 0.1;
              }
            } else if (autoState.poiType === 'coffee' || autoState.poiType === 'water') {
              if (anim.rightShoulder) {
                anim.rightShoulder.rotation.x = -Math.PI / 2.8 + Math.sin(time * 1.5) * 0.12;
              }
            }
          }
        }
      });

      // Soft personal-space separation (walkers only) — never furniture-eject after push
      const allAutoStates = Array.from(autonomousStatesRef.current.values());
      for (let i = 0; i < allAutoStates.length; i++) {
        const a1 = allAutoStates[i];
        for (let j = i + 1; j < allAutoStates.length; j++) {
          const a2 = allAutoStates[j];
          const a1Seated = a1.state === 'at_desk' || (a1.state === 'at_poi' && a1.seatedPoi);
          const a2Seated = a2.state === 'at_desk' || (a2.state === 'at_poi' && a2.seatedPoi);
          if (a1Seated && a2Seated) continue;

          const diff = new THREE.Vector3().subVectors(a1.currentPos, a2.currentPos);
          diff.y = 0;
          const dist = diff.length();
          const minDist = 0.4;
          if (dist < minDist && dist > 0.001) {
            const overlap = (minDist - dist) * 0.35;
            const push = diff.normalize().multiplyScalar(overlap);
            const a1Frozen =
              selectedAgentIdRef.current === a1.agentId
              || lastTargetedAgentIdRef.current === a1.agentId;
            const a2Frozen =
              selectedAgentIdRef.current === a2.agentId
              || lastTargetedAgentIdRef.current === a2.agentId;
            if (!a1Seated && !a1Frozen) {
              a1.currentPos.add(push);
              clampToRoom(a1.currentPos, dims);
            }
            if (!a2Seated && !a2Frozen) {
              a2.currentPos.sub(push);
              clampToRoom(a2.currentPos, dims);
            }
          }
        }
      }

      // SEATED GESTURES & TERMINAL ANIMATIONS
      agentMeshesMap.current.forEach((meshData, agentId) => {
        const agent = agentsRef.current.find(a => a.id === agentId);
        const auto = autonomousStatesRef.current.get(agentId);
        const deskItem = deskMeshesMap.current.get(agentId);
        if (!agent || !meshData) return;

        const humanoid = meshData.humanoidGroup;
        const anim = meshData.animParts;
        const isSelected = selectedAgentIdRef.current === agentId;
        const agentThinking = Boolean(thinkingAgentsRef.current?.[agentId]);
        const agentHasTask = (boardNotesRef.current || []).some(
          n => (n.kind === 'Task' || n.kind === 'Handoff') &&
               (n.assigneeId === agentId || n.title?.includes(agent.name)) &&
               n.status !== 'done' &&
               n.status !== 'completed' &&
               n.status !== 'failed' &&
               n.status !== 'reassigned' &&
               n.status !== 'cancelled' &&
               n.status !== 'blocked'
        );
        const liveMonitor = monitorsRefLocal.current?.current?.[agentId];
        const isAgentBrowsing = Boolean(
          liveMonitor?.src &&
          typeof liveMonitor.updatedAt === 'number' &&
          (Date.now() - liveMonitor.updatedAt) < 3500
        );
        const isAgentBusy = agent.status === 'thinking' || agentThinking || agentHasTask;
        const isUsingComputer = isAgentBrowsing || agent.currentActivity === 'using_computer' || agent.activeItem === 'computer';
        const isWritingPaper = agent.currentActivity === 'writing_paper' || agent.activeItem === 'pencil_paper';
        const isSpeaking = agent.status === 'speaking';
        const isThinking = agent.status === 'thinking' || isAgentBusy;
        const isAtDesk = !auto || auto.state === 'at_desk';

        // Floor selection ring
        if (deskItem && deskItem.selectionPlate) {
          deskItem.selectionPlate.visible = isSelected;
        }

        // Desk LCD: live browser page, otherwise the idle terminal glow
        if (deskItem && deskItem.crtScreen) {
          const mat = deskItem.crtScreen.material as THREE.MeshBasicMaterial;
          const frame = monitorsRefLocal.current?.current[agentId];
          if (frame && deskItem.screenCanvas && deskItem.screenTexture && frame.seq !== deskItem.screenSeq && !deskItem.painting) {
            deskItem.painting = true;
            const paintSeq = frame.seq;
            const img = new Image();
            img.onload = () => {
              const canvas = deskItem.screenCanvas!;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
                ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
                ctx.fillStyle = '#e2e8f0';
                ctx.font = '10px monospace';
                const url = frame.url || '';
                ctx.fillText(url.slice(0, 62), 6, canvas.height - 5);
              }
              if (deskItem.screenTexture) deskItem.screenTexture.needsUpdate = true;
              deskItem.screenSeq = paintSeq;
              deskItem.livePage = true;
              deskItem.painting = false;
            };
            img.onerror = () => {
              deskItem.painting = false;
            };
            img.src = frame.src;
          }
          if (mat.map !== deskItem.screenTexture && deskItem.screenTexture) {
            mat.map = deskItem.screenTexture;
            mat.needsUpdate = true;
          }
        }

        // Seated upper body & leg postures
        if (isAtDesk) {
          humanoid.position.y = anim.sitY + Math.sin(time * 2 + anim.offset) * 0.004;
          if (auto) {
            humanoid.position.x = auto.deskPos.x;
            humanoid.position.z = auto.deskPos.z;
            humanoid.rotation.y = auto.deskFacingY;
          }

          // Sitting leg pose (thighs 90 deg forward, knees 90 deg down, sitting on chair cushion)
          if (anim.leftHip && anim.rightHip) {
            anim.leftHip.rotation.x = -Math.PI / 2;
            anim.rightHip.rotation.x = -Math.PI / 2;
          }
          if (anim.leftKnee && anim.rightKnee) {
            anim.leftKnee.rotation.x = Math.PI / 2;
            anim.rightKnee.rotation.x = Math.PI / 2;
          }

          if (anim.head) {
            if (isSpeaking) {
              anim.head.rotation.x = Math.sin(time * 7) * 0.08;
            } else if (isThinking || isAgentBusy) {
              anim.head.rotation.x = 0.08;
              anim.head.rotation.y = Math.sin(time * 2) * 0.08;
            } else if (isWritingPaper) {
              anim.head.rotation.x = 0.22;
              anim.head.rotation.y = -0.1;
            } else if (isUsingComputer) {
              anim.head.rotation.x = 0.05;
              anim.head.rotation.y = Math.sin(time * 1.5) * 0.04;
            } else {
              anim.head.rotation.x = 0;
              anim.head.rotation.y = 0;
            }
          }

          if (anim.rightShoulder && anim.leftShoulder) {
            if (isWritingPaper) {
              anim.leftShoulder.rotation.x = -Math.PI / 3.6;
              anim.rightShoulder.rotation.x = -Math.PI / 3.0;
              anim.rightShoulder.rotation.y = -0.25 + Math.sin(time * 6) * 0.06;
              if (anim.heldPen) anim.heldPen.visible = true;
            } else if (isUsingComputer || isThinking || isAgentBusy) {
              anim.leftShoulder.rotation.x = -Math.PI / 3.4;
              anim.rightShoulder.rotation.x = -Math.PI / 3.4;
              const typeSpeed = isAgentBusy ? 18 : 12;
              anim.leftShoulder.rotation.y = 0.12 + Math.sin(time * typeSpeed) * 0.05;
              anim.rightShoulder.rotation.y = -0.12 + Math.cos(time * typeSpeed) * 0.05;
              if (anim.heldPen) anim.heldPen.visible = false;
            } else {
              anim.leftShoulder.rotation.x = -Math.PI / 4.5;
              anim.rightShoulder.rotation.x = -Math.PI / 4.5;
              if (anim.heldPen) anim.heldPen.visible = false;
            }
          }
        }
      });

      // CAMERA RENDERING & DYNAMIC FOLLOW MODE
      const currentCamera = cameraRef.current;
      const currentRenderer = rendererRef.current;
      if (!currentCamera || !currentRenderer) return;

      const vpWidth = currentRenderer.domElement.clientWidth || window.innerWidth;
      const vpHeight = currentRenderer.domElement.clientHeight || window.innerHeight;

      // Handle user walkthrough movement in BOTH first-person AND vr-stereo modes!
      if (mode === 'first-person' || mode === 'vr-stereo') {
        const moveSpeed = 3.2 * delta;
        const forward = new THREE.Vector3(-Math.sin(fpState.current.yaw), 0, -Math.cos(fpState.current.yaw)).normalize();
        const right = new THREE.Vector3(Math.cos(fpState.current.yaw), 0, -Math.sin(fpState.current.yaw)).normalize();

        const moveDir = new THREE.Vector3();
        if (fpState.current.keys.w) moveDir.add(forward);
        if (fpState.current.keys.s) moveDir.sub(forward);
        if (fpState.current.keys.a) moveDir.sub(right);
        if (fpState.current.keys.d) moveDir.add(right);

        const joy = joystickVectorRef.current;
        if (joy && (joy.x !== 0 || joy.y !== 0)) {
          moveDir.add(forward.clone().multiplyScalar(-joy.y));
          moveDir.add(right.clone().multiplyScalar(joy.x));
        }

        if (moveDir.lengthSq() > 0) {
          moveDir.normalize();
          fpState.current.pos.addScaledVector(moveDir, moveSpeed);
          fpState.current.walkTime += delta * 9;
        }

        const halfW = dims.width / 2 - 1.0;
        const halfD = dims.depth / 2 - 1.0;
        fpState.current.pos.x = Math.max(-halfW, Math.min(halfW, fpState.current.pos.x));
        fpState.current.pos.z = Math.max(-halfD, Math.min(halfD, fpState.current.pos.z));
      }

      // Detect agent in front or nearest to crosshair in FPS / VR
      if (mode === 'first-person' || mode === 'vr-stereo') {
        const lookDir = new THREE.Vector3(
          -Math.sin(fpState.current.yaw) * Math.cos(fpState.current.pitch),
          Math.sin(fpState.current.pitch),
          -Math.cos(fpState.current.yaw) * Math.cos(fpState.current.pitch)
        ).normalize();

        let bestAgent: Agent | null = null;
        let bestDist: number | null = null;
        let bestScore = -Infinity;
        const camPos = fpState.current.pos;

        for (const agent of agentsRef.current) {
          const mesh = agentMeshesMap.current.get(agent.id);
          if (!mesh) continue;
          const aPos = mesh.humanoidGroup.position;
          const toA = new THREE.Vector3().subVectors(aPos, camPos);
          const d = toA.length();
          const dir = toA.clone().normalize();
          const dot = dir.dot(lookDir);

          const score = dot * 5.0 - d * 0.35;
          if (((dot > 0.35 && d < 12) || d < 2.5) && score > bestScore) {
            bestScore = score;
            bestAgent = agent;
            bestDist = d;
          }
        }

        const currentBestId = bestAgent?.id || null;
        if (lastTargetedAgentIdRef.current !== currentBestId) {
          lastTargetedAgentIdRef.current = currentBestId;
          if (onTargetedAgentChangeRef.current) {
            onTargetedAgentChangeRef.current(bestAgent, bestDist);
          }
        }
      } else {
        if (lastTargetedAgentIdRef.current !== null) {
          lastTargetedAgentIdRef.current = null;
          if (onTargetedAgentChangeRef.current) {
            onTargetedAgentChangeRef.current(null, null);
          }
        }
      }

      if (mode === 'isometric') {
        currentRenderer.setClearColor(0x0f172a, 1.0);
        currentRenderer.setScissorTest(false);
        currentRenderer.setViewport(0, 0, vpWidth, vpHeight);
        currentRenderer.setScissor(0, 0, vpWidth, vpHeight);

        // Guarantee camera aspect ratio is correctly restored from VR mode (no smashing!)
        const expectedAspect = vpWidth / vpHeight;
        currentCamera.aspect = expectedAspect;
        currentCamera.fov = 40;
        currentCamera.updateProjectionMatrix();

        // Dynamic Follow tracking
        if (isFollowingRef.current && selectedAgentIdRef.current) {
          const auto = autonomousStatesRef.current.get(selectedAgentIdRef.current);
          const mesh = agentMeshesMap.current.get(selectedAgentIdRef.current);
          if (auto && mesh) {
            const livePos = mesh.humanoidGroup.position;
            orbitState.current.target.lerp(new THREE.Vector3(livePos.x, 0.45, livePos.z), delta * 4.5);
          }
        } else if (!selectedAgentIdRef.current) {
          orbitState.current.target.lerp(new THREE.Vector3(0, 0.45, 0), delta * 3.0);
        }

        const targetLook = orbitState.current.target;
        const x = targetLook.x + orbitState.current.radius * Math.sin(orbitState.current.phi) * Math.sin(orbitState.current.theta);
        const y = targetLook.y + orbitState.current.radius * Math.cos(orbitState.current.phi);
        const z = targetLook.z + orbitState.current.radius * Math.sin(orbitState.current.phi) * Math.cos(orbitState.current.theta);

        currentCamera.position.set(x, y, z);
        currentCamera.lookAt(targetLook);

        // Dollhouse cutaway: hide solid wall fixtures when the camera is outside that facade
        const margin = 0.35;
        leftFacadeRef.current && (leftFacadeRef.current.visible = currentCamera.position.x > -dims.width / 2 + margin);
        rightFacadeRef.current && (rightFacadeRef.current.visible = currentCamera.position.x < dims.width / 2 - margin);
        backFacadeRef.current && (backFacadeRef.current.visible = currentCamera.position.z > -dims.depth / 2 + margin);

        currentRenderer.render(scene, currentCamera);
      } else if (mode === 'first-person') {
        currentRenderer.setClearColor(0x0f172a, 1.0);
        currentRenderer.setScissorTest(false);
        currentRenderer.setViewport(0, 0, vpWidth, vpHeight);
        currentRenderer.setScissor(0, 0, vpWidth, vpHeight);

        const expectedAspect = vpWidth / vpHeight;
        currentCamera.aspect = expectedAspect;
        currentCamera.fov = 72;
        currentCamera.updateProjectionMatrix();

        const bob = Math.sin(fpState.current.walkTime) * 0.02;
        currentCamera.position.set(fpState.current.pos.x, fpState.current.pos.y + bob, fpState.current.pos.z);

        const lookDir = new THREE.Vector3(
          -Math.sin(fpState.current.yaw) * Math.cos(fpState.current.pitch),
          Math.sin(fpState.current.pitch),
          -Math.cos(fpState.current.yaw) * Math.cos(fpState.current.pitch)
        ).normalize();
        currentCamera.lookAt(currentCamera.position.clone().add(lookDir));

        if (leftFacadeRef.current) leftFacadeRef.current.visible = true;
        if (rightFacadeRef.current) rightFacadeRef.current.visible = true;
        if (backFacadeRef.current) backFacadeRef.current.visible = true;

        currentRenderer.render(scene, currentCamera);
      } else if (mode === 'vr-stereo') {
        if (leftFacadeRef.current) leftFacadeRef.current.visible = true;
        if (rightFacadeRef.current) rightFacadeRef.current.visible = true;
        if (backFacadeRef.current) backFacadeRef.current.visible = true;

        currentRenderer.setClearColor(0x0f172a, 1.0);
        currentRenderer.setScissorTest(true);
        const wHalf = Math.floor(vpWidth / 2);

        const forward = new THREE.Vector3(-Math.sin(fpState.current.yaw), 0, -Math.cos(fpState.current.yaw)).normalize();
        const right = new THREE.Vector3(Math.cos(fpState.current.yaw), 0, -Math.sin(fpState.current.yaw)).normalize();

        const eyeSeparation = 0.045;
        const bob = Math.sin(fpState.current.walkTime) * 0.02;
        const eyeCenter = fpState.current.pos.clone();
        eyeCenter.y += bob;

        const lookDir = new THREE.Vector3(
          -Math.sin(fpState.current.yaw) * Math.cos(fpState.current.pitch),
          Math.sin(fpState.current.pitch),
          -Math.cos(fpState.current.yaw) * Math.cos(fpState.current.pitch)
        ).normalize();

        const stereoAspect = wHalf / vpHeight;
        currentCamera.aspect = stereoAspect;
        currentCamera.fov = 72;
        currentCamera.updateProjectionMatrix();

        // Left Eye
        currentCamera.position.copy(eyeCenter).add(right.clone().multiplyScalar(-eyeSeparation / 2));
        currentCamera.lookAt(currentCamera.position.clone().add(lookDir));

        currentRenderer.setViewport(0, 0, wHalf, vpHeight);
        currentRenderer.setScissor(0, 0, wHalf, vpHeight);
        currentRenderer.render(scene, currentCamera);

        // Right Eye
        currentCamera.position.copy(eyeCenter).add(right.clone().multiplyScalar(eyeSeparation / 2));
        currentCamera.lookAt(currentCamera.position.clone().add(lookDir));

        currentRenderer.setViewport(wHalf, 0, wHalf, vpHeight);
        currentRenderer.setScissor(wHalf, 0, wHalf, vpHeight);
        currentRenderer.render(scene, currentCamera);

        // Cleanly restore scissor test and full viewport so outside states never get smashed!
        currentRenderer.setScissorTest(false);
        currentRenderer.setViewport(0, 0, vpWidth, vpHeight);
        currentRenderer.setScissor(0, 0, vpWidth, vpHeight);
      }
    };

    animate();

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      resizeObserver.disconnect();
      dom.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      dom.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      dom.removeEventListener('wheel', handleWheel);
      dom.removeEventListener('click', handleCanvasClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.dispose();
      deskMeshesMap.current.clear();
      agentMeshesMap.current.clear();
      autonomousStatesRef.current.clear();
    };
  }, []);

  // SCALE ROOM & UPDATE DESKS WHEN AGENTS ARE ADDED / REMOVED
  useEffect(() => {
    if (!sceneRef.current) return;
    rebuildRoom(sceneRef.current, agents.length);
    syncEntities(agents);
  }, [agents.length]);

  // SYNC AGENT DETAILS WHEN SPECIFIC ATTRIBUTES CHANGE
  useEffect(() => {
    if (!sceneRef.current) return;
    syncEntities(agents);
  }, [agents]);

  const followedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="relative w-full h-full select-none overflow-hidden" ref={mountRef}>
      {/* 3D Canvas mounted here */}

      {/* Severance Isometric Camera Follow Mode Banner */}
      {viewMode === 'isometric' && selectedAgentId && isFollowing && followedAgent && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-3 bg-slate-900/95 backdrop-blur-md border border-slate-700 px-4 py-2 rounded-lg shadow-lg text-xs font-mono transition-all">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <Eye className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-white">Monitorando:</span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-200">
            <span className="font-bold text-white">{followedAgent.name}</span>
            <span className="text-slate-400">({followedAgent.role})</span>
          </div>

          <button
            onClick={() => {
              setIsFollowing(false);
              isFollowingRef.current = false;
            }}
            className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="Liberar câmera para visualização panorâmica (Esc)"
          >
            <Unlock className="w-3 h-3 text-slate-400" />
            <span>Liberar</span>
          </button>
        </div>
      )}
    </div>
  );
};

import * as THREE from 'three';
import { Agent, AvatarType } from '../../../types/agent';

export interface HumanoidAnimParts {
  standY: number;
  baseY: number;
  sitY: number;
  hipY: number;
  offset: number;
  head: THREE.Group;
  torso: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  heldPen: THREE.Mesh;
  coffeeMug: THREE.Mesh;
}

export interface HumanoidMeshResult {
  humanoidGroup: THREE.Group;
  animParts: HumanoidAnimParts;
  statusCanvas: HTMLCanvasElement;
  statusTexture: THREE.CanvasTexture;
  statusSprite: THREE.Sprite;
  balloonCanvas: HTMLCanvasElement;
  balloonTexture: THREE.CanvasTexture;
  balloonSprite: THREE.Sprite;
}

/** Flat voxel look — Crossy Road / office peeps. */
function voxel(color: number, roughness = 0.92): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    flatShading: true,
  });
}

function shade(hex: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((hex & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function markShadow(obj: THREE.Object3D) {
  obj.traverse(child => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

type Outfit = { jacket: number; shirt: number; pants: number; shoes: number; tie: number };

function officeOutfit(avatarType: AvatarType, brand: number): Outfit {
  switch (avatarType) {
    case 'executive_formal':
      return {
        jacket: shade(brand, 0.32),
        shirt: 0xf8fafc,
        pants: 0x1e293b,
        shoes: 0x0f172a,
        tie: brand,
      };
    case 'developer_suit':
      return {
        jacket: shade(brand, 0.5),
        shirt: 0xe2e8f0,
        pants: 0x334155,
        shoes: 0x1c1917,
        tie: shade(brand, 1.1),
      };
    case 'researcher_coat':
      return {
        jacket: 0xf1f5f9,
        shirt: shade(brand, 0.7),
        pants: 0x475569,
        shoes: 0x292524,
        tie: brand,
      };
    case 'cyber_specialist':
      return {
        jacket: shade(brand, 0.4),
        shirt: 0x18181b,
        pants: 0x09090b,
        shoes: 0x09090b,
        tie: 0x22d3ee,
      };
    default:
      return {
        jacket: brand,
        shirt: 0xf8fafc,
        pants: 0x334155,
        shoes: 0x1c1917,
        tie: shade(brand, 0.7),
      };
  }
}

type HairStyle = 'flat' | 'fringe' | 'bob' | 'pony' | 'bun' | 'side';

/**
 * Solid hair CAP over a cube head — always covers the entire top face.
 * Built as overlapping boxes so no skin shows from any camera angle.
 */
function buildVoxelHair(
  head: THREE.Group,
  style: HairStyle,
  hairMat: THREE.MeshStandardMaterial,
  headSize: number,
) {
  const hs = headSize;
  // Full top lid — slightly larger than head so edges never show bald
  box(head, hs * 1.08, hs * 0.28, hs * 1.08, hairMat, 0, hs * 0.4, 0);
  // Back panel (covers rear of cube)
  box(head, hs * 1.08, hs * 0.7, hs * 0.22, hairMat, 0, hs * 0.05, -hs * 0.48);
  // Sideburns / side coverage
  box(head, hs * 0.18, hs * 0.55, hs * 0.9, hairMat, -hs * 0.5, 0, -hs * 0.05);
  box(head, hs * 0.18, hs * 0.55, hs * 0.9, hairMat, hs * 0.5, 0, -hs * 0.05);

  switch (style) {
    case 'flat':
      // Clean bowl — already covered by lid + back
      break;

    case 'fringe':
      // Front fringe brick sitting on forehead
      box(head, hs * 0.95, hs * 0.18, hs * 0.22, hairMat, 0, hs * 0.32, hs * 0.48);
      break;

    case 'side':
      // Asymmetric puff on one side
      box(head, hs * 0.45, hs * 0.22, hs * 0.5, hairMat, hs * 0.28, hs * 0.48, hs * 0.1);
      box(head, hs * 0.7, hs * 0.16, hs * 0.2, hairMat, -hs * 0.1, hs * 0.3, hs * 0.48);
      break;

    case 'bob':
      // Longer side panels + thicker back
      box(head, hs * 0.22, hs * 0.85, hs * 0.75, hairMat, -hs * 0.52, -hs * 0.15, -hs * 0.05);
      box(head, hs * 0.22, hs * 0.85, hs * 0.75, hairMat, hs * 0.52, -hs * 0.15, -hs * 0.05);
      box(head, hs * 1.1, hs * 0.55, hs * 0.28, hairMat, 0, -hs * 0.15, -hs * 0.52);
      box(head, hs * 0.9, hs * 0.16, hs * 0.18, hairMat, 0, hs * 0.28, hs * 0.5);
      break;

    case 'pony':
      box(head, hs * 0.85, hs * 0.16, hs * 0.2, hairMat, 0, hs * 0.28, hs * 0.5);
      // Ponytail bricks hanging off the back
      box(head, hs * 0.28, hs * 0.28, hs * 0.28, hairMat, 0, hs * 0.15, -hs * 0.7);
      box(head, hs * 0.22, hs * 0.55, hs * 0.22, hairMat, 0, -hs * 0.2, -hs * 0.78);
      break;

    case 'bun':
      box(head, hs * 0.7, hs * 0.14, hs * 0.18, hairMat, 0, hs * 0.28, hs * 0.48);
      // Top bun cube
      box(head, hs * 0.4, hs * 0.32, hs * 0.4, hairMat, 0, hs * 0.62, -hs * 0.05);
      break;
  }
}

/**
 * Crossy Road–style voxel office employees.
 * Cube head + solid hair cap, stubby suit body, dot eyes.
 */
export function createMiniatureHumanoidMesh(agent: Agent, index: number): HumanoidMeshResult {
  const root = new THREE.Group();
  root.userData = { agentId: agent.id };

  const isFemale = agent.gender === 'female';
  const skins = [0xffe0b8, 0xf5c896, 0xe0a878, 0xc48a5c, 0x8d5a3c];
  const skinMat = voxel(skins[index % skins.length], 0.88);

  const brand = parseInt(agent.color.replace('#', '0x'), 16) || 0x2563eb;
  const fit = officeOutfit(agent.avatarType, brand);
  const jacketMat = voxel(fit.jacket, 0.9);
  const shirtMat = voxel(fit.shirt, 0.75);
  const pantsMat = voxel(fit.pants, 0.9);
  const shoeMat = voxel(fit.shoes, 0.7);
  const tieMat = voxel(fit.tie, 0.7);

  const hairColors: Record<string, number> = {
    rafa: 0x1c1917,
    beto: 0x44403c,
    laura: 0xe8a84a,
    elisa: 0x1c1917,
    bete: 0x9a3412,
  };
  const hairMat = voxel(hairColors[agent.id] ?? (isFemale ? 0x9a3412 : 0x1c1917), 0.95);

  // --- Proportions (Crossy Road: ~2 heads tall) ---
  const HEAD = 0.22; // cube head size
  const HIP_Y = 0.2;
  // Seat tops are ~0.24–0.28; lift root so the pelvis rests on the cushion
  const SIT_Y = 0.12;
  const torsoW = isFemale ? 0.16 : 0.18;
  const torsoH = 0.16;
  const torsoD = 0.12;

  // ===================== LEGS =====================
  const thighLen = 0.09;
  const shinLen = 0.08;

  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.045, HIP_Y, 0);
    root.add(hip);

    // Thigh block (pivot at top)
    const thigh = box(hip, 0.055, thighLen, 0.06, pantsMat, 0, -thighLen / 2, 0);

    const knee = new THREE.Group();
    knee.position.set(0, -thighLen, 0);
    hip.add(knee);

    box(knee, 0.05, shinLen, 0.055, pantsMat, 0, -shinLen / 2, 0);
    // Shoe brick
    box(knee, 0.06, 0.03, 0.09, shoeMat, 0, -shinLen - 0.01, 0.015);

    void thigh;
    return { hip, knee };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // ===================== HIPS =====================
  box(root, torsoW * 1.05, 0.06, torsoD * 1.05, pantsMat, 0, HIP_Y, 0);

  // ===================== TORSO =====================
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, HIP_Y, 0);
  root.add(torsoGroup);

  // Suit jacket body
  box(torsoGroup, torsoW, torsoH, torsoD, jacketMat, 0, torsoH / 2 + 0.02, 0);

  // Shirt / collar strip at top front
  box(torsoGroup, torsoW * 0.55, 0.04, 0.02, shirtMat, 0, torsoH + 0.01, torsoD / 2 + 0.005);

  // Tie
  box(torsoGroup, 0.025, 0.08, 0.015, tieMat, 0, torsoH * 0.55, torsoD / 2 + 0.008);

  // Lapel lines (darker jacket strips)
  const lapelMat = voxel(shade(fit.jacket, 0.75), 0.9);
  box(torsoGroup, 0.02, torsoH * 0.7, 0.01, lapelMat, -torsoW * 0.22, torsoH * 0.55, torsoD / 2 + 0.006);
  box(torsoGroup, 0.02, torsoH * 0.7, 0.01, lapelMat, torsoW * 0.22, torsoH * 0.55, torsoD / 2 + 0.006);

  // Pocket square for executives
  if (agent.avatarType === 'executive_formal' || agent.avatarType === 'developer_suit') {
    box(torsoGroup, 0.035, 0.02, 0.01, shirtMat, torsoW * 0.28, torsoH * 0.7, torsoD / 2 + 0.008);
  }

  // ===================== HEAD =====================
  const neckY = torsoH + 0.035;
  // Tiny neck brick
  box(torsoGroup, 0.06, 0.03, 0.06, skinMat, 0, neckY, 0);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, neckY + 0.015 + HEAD / 2, 0);
  torsoGroup.add(headGroup);

  // Cube head
  box(headGroup, HEAD, HEAD, HEAD, skinMat, 0, 0, 0);

  // Flat pixel eyes (Crossy Road style) — small black squares on the face, not cylinders
  const eyeMat = voxel(0x0f172a, 0.55);
  const eyeW = 0.032;
  const eyeH = 0.038;
  [-1, 1].forEach(side => {
    box(
      headGroup,
      eyeW,
      eyeH,
      0.01,
      eyeMat,
      side * HEAD * 0.2,
      HEAD * 0.04,
      HEAD / 2 + 0.006,
    );
  });

  // Tiny white glint so they don't look dead
  const glintMat = voxel(0xffffff, 0.4);
  [-1, 1].forEach(side => {
    box(
      headGroup,
      0.01,
      0.01,
      0.01,
      glintMat,
      side * HEAD * 0.2 - 0.006,
      HEAD * 0.04 + 0.008,
      HEAD / 2 + 0.012,
    );
  });

  // Dot eyes only — no mouths (flat Crossy Road face)

  // Hair styles per person — always a solid top cap
  const hairById: Record<string, HairStyle> = {
    rafa: 'side',
    beto: 'flat',
    laura: 'pony',
    elisa: 'bob',
    bete: 'bun',
  };
  const hairStyle =
    hairById[agent.id] ||
    (isFemale ? (index % 2 === 0 ? 'bob' : 'pony') : index % 2 === 0 ? 'flat' : 'fringe');
  buildVoxelHair(headGroup, hairStyle, hairMat, HEAD);

  // Beto glasses — box frames
  if (agent.id === 'beto') {
    const frame = voxel(0x1c1917, 0.4);
    [-1, 1].forEach(side => {
      // Lens plate
      const lens = box(headGroup, 0.07, 0.055, 0.012, voxel(0xbae6fd, 0.3), side * 0.055, 0.02, HEAD / 2 + 0.02);
      (lens.material as THREE.MeshStandardMaterial).transparent = true;
      (lens.material as THREE.MeshStandardMaterial).opacity = 0.35;
      // Frame rim (thicker border via slightly larger dark box behind)
      box(headGroup, 0.078, 0.062, 0.008, frame, side * 0.055, 0.02, HEAD / 2 + 0.014);
    });
    box(headGroup, 0.03, 0.012, 0.01, frame, 0, 0.02, HEAD / 2 + 0.018);
  }

  // ===================== ARMS =====================
  const upperLen = 0.075;
  const foreLen = 0.065;

  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (torsoW / 2 + 0.02), torsoH * 0.85, 0);
    torsoGroup.add(shoulder);

    // Upper arm block
    box(shoulder, 0.045, upperLen, 0.05, jacketMat, 0, -upperLen / 2, 0);

    const elbow = new THREE.Group();
    elbow.position.set(0, -upperLen, 0);
    shoulder.add(elbow);

    box(elbow, 0.04, foreLen, 0.045, jacketMat, 0, -foreLen / 2, 0);
    // Hand brick
    box(elbow, 0.045, 0.035, 0.045, skinMat, 0, -foreLen - 0.01, 0);

    return { shoulder, elbow };
  };

  const left = makeArm(-1);
  const right = makeArm(1);

  const heldPen = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.01, 0.06),
    voxel(0x2563eb, 0.5),
  );
  heldPen.position.set(0, -foreLen - 0.02, 0.03);
  heldPen.visible = false;
  right.elbow.add(heldPen);

  const coffeeMug = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.04, 0.035),
    voxel(0xf8fafc, 0.4),
  );
  coffeeMug.position.set(0, -foreLen - 0.02, 0.025);
  coffeeMug.visible = false;
  right.elbow.add(coffeeMug);

  // ===================== UI =====================
  const statusCanvas = document.createElement('canvas');
  statusCanvas.width = 256;
  statusCanvas.height = 64;
  const statusTexture = new THREE.CanvasTexture(statusCanvas);
  const statusSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: statusTexture, transparent: true, depthTest: false }),
  );
  statusSprite.scale.set(0.65, 0.16, 1);
  statusSprite.position.set(0, 0.72, 0);
  root.add(statusSprite);

  const balloonCanvas = document.createElement('canvas');
  balloonCanvas.width = 320;
  balloonCanvas.height = 140;
  const balloonTexture = new THREE.CanvasTexture(balloonCanvas);
  const balloonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: balloonTexture, transparent: true, depthTest: false }),
  );
  balloonSprite.scale.set(1.05, 0.46, 1);
  balloonSprite.position.set(0, 0.95, 0);
  balloonSprite.visible = false;
  root.add(balloonSprite);

  markShadow(root);

  return {
    humanoidGroup: root,
    animParts: {
      standY: 0,
      baseY: SIT_Y,
      sitY: SIT_Y,
      hipY: HIP_Y,
      offset: index * 1.5,
      head: headGroup,
      torso: torsoGroup,
      leftShoulder: left.shoulder,
      rightShoulder: right.shoulder,
      leftElbow: left.elbow,
      rightElbow: right.elbow,
      leftHip: leftLeg.hip,
      rightHip: rightLeg.hip,
      leftKnee: leftLeg.knee,
      rightKnee: rightLeg.knee,
      heldPen,
      coffeeMug,
    },
    statusCanvas,
    statusTexture,
    statusSprite,
    balloonCanvas,
    balloonTexture,
    balloonSprite,
  };
}

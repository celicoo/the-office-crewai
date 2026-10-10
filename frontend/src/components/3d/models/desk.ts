import * as THREE from 'three';
import { Agent } from '../../../types/agent';

export interface DeskWorkstationResult {
  deskGroup: THREE.Group;
  crtScreen: THREE.Mesh;
  paperNotepad: THREE.Mesh;
  selectionPlate: THREE.Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTexture: THREE.CanvasTexture;
  screenSeq: number;
  painting: boolean;
  livePage: boolean;
}

export function createMiniatureDeskWorkstation(agent: Agent): DeskWorkstationResult {
  const deskGroup = new THREE.Group();
  deskGroup.userData = { agentId: agent.id };

  const deskWidth = 0.96;
  const deskDepth = 0.52;
  const deskHeight = 0.38;

  // 1. Desk Top Surface (Warm Scandinavian Natural Birch / Light Oak)
  const deskTop = new THREE.Mesh(
    new THREE.BoxGeometry(deskWidth, 0.024, deskDepth),
    new THREE.MeshStandardMaterial({ color: 0xf5ede4, roughness: 0.35, metalness: 0.02 })
  );
  deskTop.position.set(0, deskHeight, 0);
  deskGroup.add(deskTop);

  // Modern Matte Black Powder-Coated Steel Loop Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.6, roughness: 0.35 });
  [-(deskWidth / 2 - 0.04), deskWidth / 2 - 0.04].forEach(lx => {
    // Loop leg frame
    const legH = new THREE.Mesh(new THREE.BoxGeometry(0.025, deskHeight, 0.025), legMat);
    legH.position.set(lx, deskHeight / 2, -deskDepth / 2 + 0.04);
    deskGroup.add(legH);

    const legF = new THREE.Mesh(new THREE.BoxGeometry(0.025, deskHeight, 0.025), legMat);
    legF.position.set(lx, deskHeight / 2, deskDepth / 2 - 0.04);
    deskGroup.add(legF);

    const legFoot = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, deskDepth - 0.04), legMat);
    legFoot.position.set(lx, 0.01, 0);
    deskGroup.add(legFoot);
  });

  // 2. Contemporary Low Acoustic Felt Privacy Screen (Heather Charcoal / Slate Blue)
  const divider = new THREE.Mesh(
    new THREE.BoxGeometry(deskWidth, 0.18, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 })
  );
  divider.position.set(0, deskHeight + 0.09, 0.25);
  deskGroup.add(divider);

  // 3. Selection Floor Plate
  const selectionPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(deskWidth + 0.2, deskDepth + 0.4),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  selectionPlate.rotation.x = -Math.PI / 2;
  selectionPlate.position.y = 0.003;
  selectionPlate.visible = false;
  deskGroup.add(selectionPlate);

  // 4. Modern Widescreen LED Monitor on Articulated Metal Arm
  const monitorGroup = new THREE.Group();
  monitorGroup.position.set(0, deskHeight, 0.14);
  deskGroup.add(monitorGroup);

  // Articulated Heavy-Duty Desk Clamp & Monitor Arm
  const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.25 });
  const clampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.035, 12), armMat);
  clampBase.position.set(0, 0.015, 0.06);
  monitorGroup.add(clampBase);

  const armPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 10), armMat);
  armPillar.position.set(0, 0.095, 0.06);
  monitorGroup.add(armPillar);

  const armElbow = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.10), armMat);
  armElbow.position.set(0, 0.17, 0.01);
  armElbow.rotation.x = -0.3;
  monitorGroup.add(armElbow);

  // Chassis sits behind the LCD (toward +Z / away from the chair).
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.35 });
  const monitorBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.40, 0.24, 0.012),
    bezelMat
  );
  monitorBezel.position.set(0, 0.20, -0.032);
  monitorGroup.add(monitorBezel);

  // Thin front bezel rim around the LCD (open center so the page is not covered)
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 });
  const rimParts: Array<[number, number, number, number, number, number]> = [
    [0.40, 0.012, 0.004, 0, 0.20 + 0.114, -0.040], // top
    [0.40, 0.012, 0.004, 0, 0.20 - 0.114, -0.040], // bottom
    [0.012, 0.216, 0.004, -0.194, 0.20, -0.040], // left
    [0.012, 0.216, 0.004, 0.194, 0.20, -0.040], // right
  ];
  for (const [w, h, d, x, y, z] of rimParts) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat);
    rim.position.set(x, y, z);
    monitorGroup.add(rim);
  }

  // Realistic Modern Code IDE & Analytics Dashboard Screen Canvas
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 640;
  screenCanvas.height = 360;
  const sCtx = screenCanvas.getContext('2d')!;

  // VS Code Dark Theme background
  sCtx.fillStyle = '#1e1e1e';
  sCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);

  // Window title bar & tabs
  sCtx.fillStyle = '#252526';
  sCtx.fillRect(0, 0, screenCanvas.width, 22);

  // macOS window control buttons
  sCtx.fillStyle = '#ef4444';
  sCtx.beginPath();
  sCtx.arc(12, 11, 4, 0, Math.PI * 2);
  sCtx.fill();
  sCtx.fillStyle = '#f59e0b';
  sCtx.beginPath();
  sCtx.arc(24, 11, 4, 0, Math.PI * 2);
  sCtx.fill();
  sCtx.fillStyle = '#10b981';
  sCtx.beginPath();
  sCtx.arc(36, 11, 4, 0, Math.PI * 2);
  sCtx.fill();

  // Active file tab
  sCtx.fillStyle = '#1e1e1e';
  sCtx.fillRect(52, 2, 110, 20);
  sCtx.fillStyle = '#38bdf8';
  sCtx.font = '10px monospace';
  sCtx.fillText('App.tsx', 64, 15);

  sCtx.fillStyle = '#94a3b8';
  sCtx.fillText('service.ts', 175, 15);

  // Sidebar / Explorer strip
  sCtx.fillStyle = '#2d2d2d';
  sCtx.fillRect(0, 22, 42, screenCanvas.height - 42);

  // Editor Lines with Syntax Colors
  const codeLines = [
    { num: '1', tokens: [{ text: 'import ', col: '#c586c0' }, { text: '{ useState }', col: '#9cdcfe' }] },
    { num: '2', tokens: [{ text: 'export async ', col: '#c586c0' }, { text: 'function ', col: '#569cd6' }, { text: 'runTask', col: '#dcdcaa' }] },
    { num: '3', tokens: [{ text: '  const agent = ', col: '#d4d4d4' }, { text: `"${agent.name.split(' ')[0]}"`, col: '#ce9178' }] },
    { num: '4', tokens: [{ text: '  const status = ', col: '#d4d4d4' }, { text: '"PRODUTIVO"', col: '#4ec9b0' }] },
    { num: '5', tokens: [{ text: '  return ', col: '#c586c0' }, { text: 'agent.compute()', col: '#dcdcaa' }] },
    { num: '6', tokens: [{ text: '  // Sprints & entregas ok', col: '#6a9955' }] },
    { num: '7', tokens: [{ text: '  console.log("OK 100%")', col: '#ce9178' }] },
  ];

  sCtx.font = '11px monospace';
  codeLines.forEach((line, idx) => {
    const y = 42 + idx * 21;
    sCtx.fillStyle = '#6e7681';
    sCtx.fillText(line.num, 48, y);
    let x = 66;
    line.tokens.forEach(tok => {
      sCtx.fillStyle = tok.col;
      sCtx.fillText(tok.text, x, y);
      x += sCtx.measureText(tok.text).width;
    });
  });

  // Bottom Status Bar
  sCtx.fillStyle = '#007acc';
  sCtx.fillRect(0, screenCanvas.height - 20, screenCanvas.width, 20);
  sCtx.fillStyle = '#ffffff';
  sCtx.font = '10px monospace';
  sCtx.fillText(`✓ ${agent.name} • TypeScript • UTF-8 • 100% Pronto`, 10, screenCanvas.height - 6);

  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  // LCD faces the chair (-Z). PlaneGeometry defaults to +Z, so flip it.
  const crtScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.368, 0.207),
    new THREE.MeshBasicMaterial({
      map: screenTex,
      toneMapped: false,
      side: THREE.FrontSide,
    })
  );
  crtScreen.userData.kind = 'monitor';
  crtScreen.rotation.y = Math.PI;
  crtScreen.position.set(0, 0.20, -0.042);
  crtScreen.renderOrder = 2;
  monitorGroup.add(crtScreen);

  // Subtle Power LED
  const pwrLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.0025, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  pwrLed.position.set(0.17, 0.09, -0.041);
  monitorGroup.add(pwrLed);

  // 5. Sleek Desk Mat (Large Charcoal Felt Desk Pad)
  const deskMatMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.004, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
  );
  deskMatMesh.position.set(0.02, deskHeight + 0.014, -0.06);
  deskGroup.add(deskMatMesh);

  // 6. Modern Aluminum Chiclet Keyboard (Apple Magic Keyboard / MX Keys style)
  const kbGroup = new THREE.Group();
  kbGroup.position.set(-0.04, deskHeight + 0.018, -0.06);
  deskGroup.add(kbGroup);

  const kbBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.008, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.2 })
  );
  kbGroup.add(kbBase);

  // Low-profile chiclet keycap grid
  const keyMatDark = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
  const keyGrid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.075), keyMatDark);
  keyGrid.position.set(0, 0.005, 0);
  kbGroup.add(keyGrid);

  // 7. Modern Ergonomic Wireless Optical Mouse
  const mouseGroup = new THREE.Group();
  mouseGroup.position.set(0.18, deskHeight + 0.018, -0.06);
  deskGroup.add(mouseGroup);

  const mouseBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.018, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35 })
  );
  mouseGroup.add(mouseBody);

  const scrollWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.008, 8),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 })
  );
  scrollWheel.rotation.z = Math.PI / 2;
  scrollWheel.position.set(0, 0.011, -0.015);
  mouseGroup.add(scrollWheel);

  // 8. Ceramic Coffee Mug
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.024, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 })
  );
  mug.position.set(-0.36, deskHeight + 0.038, -0.06);
  deskGroup.add(mug);

  // 9. Miniature Desk Succulent in White Ceramic Pot
  const plantPot = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.045, 0.045),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
  );
  plantPot.position.set(0.36, deskHeight + 0.035, 0.08);
  deskGroup.add(plantPot);

  const succulentLeafMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.5 });
  for (let s = 0; s < 5; s++) {
    const sAngle = (s / 5) * Math.PI * 2;
    const sLeaf = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 4), succulentLeafMat);
    sLeaf.position.set(
      0.36 + Math.sin(sAngle) * 0.012,
      deskHeight + 0.06,
      0.08 + Math.cos(sAngle) * 0.012
    );
    sLeaf.rotation.x = Math.sin(sAngle) * 0.4;
    sLeaf.rotation.z = Math.cos(sAngle) * 0.4;
    deskGroup.add(sLeaf);
  }

  // 10. Minimalist Paper Notepad & Pen
  const paperNotepad = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.006, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
  );
  paperNotepad.position.set(0.32, deskHeight + 0.015, -0.08);
  paperNotepad.rotation.y = -0.15;
  deskGroup.add(paperNotepad);

  const pen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.11, 6),
    new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.5, roughness: 0.3 })
  );
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = -0.15;
  pen.position.set(0.32, deskHeight + 0.02, -0.08);
  deskGroup.add(pen);

  // 11. Soft office chair (rounded, matches chibi scale)
  const chairGroup = new THREE.Group();
  chairGroup.position.set(0, 0, -0.24);
  deskGroup.add(chairGroup);

  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.75,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.7,
    roughness: 0.3,
  });

  const chairSeat = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), seatMat);
  chairSeat.scale.set(1.05, 0.28, 1.0);
  chairSeat.position.y = 0.24;
  chairGroup.add(chairSeat);

  const chairBack = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), seatMat);
  chairBack.scale.set(1.0, 1.15, 0.28);
  chairBack.position.set(0, 0.42, -0.1);
  chairBack.rotation.x = -0.12;
  chairGroup.add(chairBack);

  [-0.13, 0.13].forEach(ax => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.08, 3, 6), frameMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(ax, 0.34, 0);
    chairGroup.add(arm);
  });

  const chairStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.18, 10),
    frameMat,
  );
  chairStem.position.y = 0.12;
  chairGroup.add(chairStem);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.5 });
  for (let s = 0; s < 5; s++) {
    const angle = (s / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.13), frameMat);
    spoke.position.set(Math.sin(angle) * 0.065, 0.022, Math.cos(angle) * 0.065);
    spoke.rotation.y = angle;
    chairGroup.add(spoke);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 8), wheelMat);
    wheel.position.set(Math.sin(angle) * 0.13, 0.011, Math.cos(angle) * 0.13);
    wheel.rotation.z = Math.PI / 2;
    chairGroup.add(wheel);
  }

  return { deskGroup, crtScreen, paperNotepad, selectionPlate, screenCanvas, screenTexture: screenTex, screenSeq: 0, painting: false, livePage: false };
}

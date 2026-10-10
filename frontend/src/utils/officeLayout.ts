// Dynamic Severance / Lumon Office Layout - Miniature Tycoon Scale
// Scaled for isometric miniature agents (RollerCoaster Tycoon / Diorama proportion)

export interface OfficeDimensions {
  width: number;
  depth: number;
  windowZ: number;
  coffeePos: [number, number, number];
  waterPos: [number, number, number];
  whiteboardPos: [number, number, number];
  confTablePos: [number, number, number];
  filingCabinetsPos: [number, number, number];
  kierPortraitPos: [number, number, number];
  windowLookPoints: [number, number, number][];
}

export function computeOfficeDimensions(agentCount: number): OfficeDimensions {
  const podCount = Math.max(1, Math.ceil(agentCount / 4));

  // Tight around the desk pods, with a margin for the lounge and whiteboard.
  // Another pod of four agents lengthens the room; width stays until a second column is needed.
  const columns = Math.max(1, Math.ceil(podCount / 4));
  const width = 8.5 + columns * 1.8;
  const depth = 6.4 + podCount * 2.6;
  const windowZ = -depth / 2 + 0.8;

  // Refreshment station (miniature credenza with drip coffee & water cooler)
  const coffeePos: [number, number, number] = [-width / 2 + 2.5, 0, depth / 2 - 2.8];
  const waterPos: [number, number, number] = [-width / 2 + 1.3, 0, depth / 2 - 2.8];

  // Rolling corporate whiteboard on the right wall
  const whiteboardPos: [number, number, number] = [width / 2 - 2.2, 0, 0];

  // Miniature conference / break table
  const confTablePos: [number, number, number] = [0, 0, depth / 2 - 3.2];

  // Vintage metal filing cabinets
  const filingCabinetsPos: [number, number, number] = [width / 2 - 2.0, 0, depth / 2 - 2.8];

  // Top Performer Employee framed picture centered on back wall
  const kierPortraitPos: [number, number, number] = [0, 1.9, -depth / 2 + 0.06];

  // Panoramic wall view look points
  const windowLookPoints: [number, number, number][] = [
    [-width / 4, 0, -depth / 2 + 1.2],
    [-width / 8, 0, -depth / 2 + 1.2],
    [width / 8, 0, -depth / 2 + 1.2],
    [width / 4, 0, -depth / 2 + 1.2],
  ];

  return {
    width,
    depth,
    windowZ,
    coffeePos,
    waterPos,
    whiteboardPos,
    confTablePos,
    filingCabinetsPos,
    kierPortraitPos,
    windowLookPoints,
  };
}

export interface DeskTransform {
  pos: [number, number, number];
  rotationY: number;
  seatPos: [number, number, number];
  seatRotationY: number;
}

export function computeDeskPosition(index: number, totalAgents: number): DeskTransform {
  // Miniature 4-Desk Cluster Pods (RollerCoaster Tycoon style proportion)
  const podIndex = Math.floor(index / 4);
  const slotInPod = index % 4;

  const podSpacingZ = 3.2;
  const totalPods = Math.max(1, Math.ceil(totalAgents / 4));
  const startPodZ = -(totalPods - 1) * (podSpacingZ / 2) - 0.4;
  const podCenterZ = startPodZ + podIndex * podSpacingZ;
  const podCenterX = 0;

  // In a 4-desk pod:
  // Slots 0 & 1 face +Z (towards center partition)
  // Slots 2 & 3 face -Z (towards center partition)
  const deskOffsetX = 0.65;
  const deskOffsetZ = 0.52;

  let x = podCenterX;
  let z = podCenterZ;
  let rotationY = 0;

  switch (slotInPod) {
    case 0: // Back-left desk, facing +Z
      x = podCenterX - deskOffsetX;
      z = podCenterZ - deskOffsetZ;
      rotationY = 0;
      break;
    case 1: // Back-right desk, facing +Z
      x = podCenterX + deskOffsetX;
      z = podCenterZ - deskOffsetZ;
      rotationY = 0;
      break;
    case 2: // Front-left desk, facing -Z
      x = podCenterX - deskOffsetX;
      z = podCenterZ + deskOffsetZ;
      rotationY = Math.PI;
      break;
    case 3: // Front-right desk, facing -Z
      x = podCenterX + deskOffsetX;
      z = podCenterZ + deskOffsetZ;
      rotationY = Math.PI;
      break;
  }

  // Chair seat position in miniature space:
  // Local chair offset is (0, 0, -0.24)
  const seatOffsetX = -0.24 * Math.sin(rotationY);
  const seatOffsetZ = -0.24 * Math.cos(rotationY);

  const seatPos: [number, number, number] = [x + seatOffsetX, 0, z + seatOffsetZ];
  const seatRotationY = rotationY;

  return {
    pos: [x, 0, z],
    rotationY,
    seatPos,
    seatRotationY,
  };
}

import * as THREE from 'three';

/** Shared helpers for room-scale props (coffee bar, lounge, plants, cabinets). */

export function createCoffeeBar(): THREE.Group {
  const group = new THREE.Group();

  const walnut = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.45 });
  const quartz = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.18, metalness: 0.06 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.85, roughness: 0.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35, metalness: 0.25 });

  // Cabinet body with toe kick
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.48, 0.62), walnut);
  body.position.y = 0.28;
  group.add(body);

  const toeKick = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.06, 0.58), black);
  toeKick.position.set(0, 0.03, 0.01);
  group.add(toeKick);

  // Door seams
  [-0.45, 0, 0.45].forEach(x => {
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.4, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.6 }),
    );
    seam.position.set(x, 0.3, 0.315);
    group.add(seam);
  });

  // Handles
  [-0.7, -0.2, 0.3, 0.7].forEach(x => {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8),
      steel,
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(x, 0.3, 0.325);
    group.add(handle);
  });

  // Quartz top with slight overhang
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.032, 0.66), quartz);
  top.position.y = 0.536;
  group.add(top);

  // Espresso machine
  const machine = new THREE.Group();
  machine.position.set(0.4, 0.55, 0);
  group.add(machine);

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.26), steel);
  chassis.position.y = 0.15;
  machine.add(chassis);

  const groupHead = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 12), black);
  groupHead.rotation.x = Math.PI / 2;
  groupHead.position.set(0, 0.08, 0.14);
  machine.add(groupHead);

  const portafilter = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), black);
  portafilter.rotation.x = Math.PI / 2;
  portafilter.position.set(0, 0.08, 0.2);
  machine.add(portafilter);

  const dripTray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.12), black);
  dripTray.position.set(0, 0.02, 0.14);
  machine.add(dripTray);

  const steamWand = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), steel);
  steamWand.position.set(0.12, 0.1, 0.1);
  steamWand.rotation.z = 0.35;
  machine.add(steamWand);

  // Cup warmer rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.008, 0.08), black);
  rail.position.set(0, 0.31, -0.02);
  machine.add(rail);

  // Glass carafe with coffee
  const carafe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.05, 0.13, 14),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.75,
      roughness: 0.08,
      thickness: 0.02,
      transparent: true,
      opacity: 0.85,
    }),
  );
  carafe.position.set(0.72, 0.62, 0.04);
  group.add(carafe);

  const brew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.042, 0.07, 12),
    new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.55 }),
  );
  brew.position.set(0.72, 0.59, 0.04);
  group.add(brew);

  const carafeLid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.045, 0.02, 12),
    black,
  );
  carafeLid.position.set(0.72, 0.69, 0.04);
  group.add(carafeLid);

  // Stacked mugs
  const mugMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  for (let m = 0; m < 3; m++) {
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.048, 12), mugMat);
    mug.position.set(0.1, 0.575 + m * 0.05, 0.1);
    group.add(mug);
    const mugHandle = new THREE.Mesh(
      new THREE.TorusGeometry(0.014, 0.003, 6, 10, Math.PI),
      mugMat,
    );
    mugHandle.rotation.y = Math.PI / 2;
    mugHandle.position.set(0.128, 0.575 + m * 0.05, 0.1);
    group.add(mugHandle);
  }

  // Water cooler
  const cooler = new THREE.Group();
  cooler.position.set(-0.6, 0, 0);
  group.add(cooler);

  const coolerBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.82, 0.3), black);
  coolerBody.position.y = 0.41;
  cooler.add(coolerBody);

  const niche = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.25, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.5 }),
  );
  niche.position.set(0, 0.55, 0.12);
  cooler.add(niche);

  const tapCold = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  tapCold.position.set(-0.04, 0.6, 0.15);
  cooler.add(tapCold);

  const tapHot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444 }),
  );
  tapHot.position.set(0.04, 0.6, 0.15);
  cooler.add(tapHot);

  // Drip grille
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.008, 0.12),
    steel,
  );
  grille.position.set(0, 0.44, 0.14);
  cooler.add(grille);

  // Brand badge
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.004),
    new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.3 }),
  );
  badge.position.set(0, 0.72, 0.152);
  cooler.add(badge);

  return group;
}

export function createLoungeSet(): THREE.Group {
  const group = new THREE.Group();

  const oak = new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.45, metalness: 0.02 });
  const oakDark = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.5 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.85 });
  const velvetDark = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.88 });

  // Round coffee table with lower shelf
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.028, 28), oak);
  tableTop.position.y = 0.3;
  group.add(tableTop);

  const tableEdge = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.012, 8, 28),
    oakDark,
  );
  tableEdge.rotation.x = Math.PI / 2;
  tableEdge.position.y = 0.29;
  group.add(tableEdge);

  const shelf = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.016, 24), oak);
  shelf.position.y = 0.12;
  group.add(shelf);

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.3, 8), oakDark);
    leg.position.set(Math.sin(angle) * 0.2, 0.15, Math.cos(angle) * 0.2);
    group.add(leg);
  }

  // Soft rounded lounge chairs
  [-0.95, 0.95].forEach((cx, idx) => {
    const chair = new THREE.Group();
    chair.position.set(cx, 0, 0.15);
    chair.rotation.y = idx === 0 ? Math.PI / 3 : -Math.PI / 3;
    group.add(chair);

    // Rounded seat cushion
    const seat = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), velvet);
    seat.scale.set(1.05, 0.32, 1.05);
    seat.position.y = 0.22;
    chair.add(seat);

    // Soft backrest
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), velvetDark);
    back.scale.set(1.0, 0.95, 0.35);
    back.position.set(0, 0.42, -0.16);
    back.rotation.x = -0.15;
    chair.add(back);

    // Rounded arms
    [-0.2, 0.2].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), velvet);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(ax, 0.32, 0.02);
      chair.add(arm);
    });

    // Tapered wood legs
    [-0.14, 0.14].forEach(lx => {
      [-0.14, 0.14].forEach(lz => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.2, 8), oakDark);
        leg.position.set(lx, 0.1, lz);
        chair.add(leg);
      });
    });
  });

  return group;
}

export function createOfficePlant(): THREE.Group {
  const group = new THREE.Group();

  const planter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.18, 0.45, 18),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.22 }),
  );
  planter.position.y = 0.225;
  group.add(planter);

  // Fluting rings
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.205 - i * 0.005, 0.004, 6, 24),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08 + i * 0.08;
    group.add(ring);
  }

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.195, 0.195, 0.04, 16),
    new THREE.MeshStandardMaterial({ color: 0x27170e, roughness: 0.92 }),
  );
  soil.position.y = 0.43;
  group.add(soil);

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a2c11, roughness: 0.7 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });
  const leafDark = new THREE.MeshStandardMaterial({
    color: 0x166534,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });

  // Main trunk
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.9, 8), stemMat);
  trunk.position.y = 0.85;
  group.add(trunk);

  // Branch stems + fiddle leaves
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + (i % 2) * 0.35;
    const height = 0.7 + (i / 10) * 0.65;
    const reach = 0.12 + (i % 3) * 0.04;

    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.01, reach, 6),
      stemMat,
    );
    branch.position.set(
      Math.sin(angle) * reach * 0.5,
      height,
      Math.cos(angle) * reach * 0.5,
    );
    branch.rotation.z = Math.sin(angle) * 0.9;
    branch.rotation.x = Math.cos(angle) * 0.9;
    group.add(branch);

    // Leaf as stretched sphere (organic oval)
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), i % 2 ? leafMat : leafDark);
    leaf.scale.set(0.55, 0.12, 1.15);
    leaf.position.set(Math.sin(angle) * reach, height + 0.02, Math.cos(angle) * reach);
    leaf.rotation.y = angle;
    leaf.rotation.x = 0.45 + (i % 3) * 0.08;
    leaf.rotation.z = (i % 2) * 0.2 - 0.1;
    group.add(leaf);
  }

  return group;
}

export function createFilingCabinets(): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.55, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.4 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.25 });

  for (let c = 0; c < 2; c++) {
    const cab = new THREE.Group();
    cab.position.set(c * 0.55 - 0.28, 0, 0);
    group.add(cab);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 0.45), metal);
    body.position.y = 0.525;
    cab.add(body);

    // Drawers
    for (let d = 0; d < 4; d++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.02), dark);
      drawer.position.set(0, 0.18 + d * 0.24, 0.225);
      cab.add(drawer);

      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.02), handleMat);
      handle.position.set(0, 0.18 + d * 0.24, 0.245);
      cab.add(handle);
    }

    // Label plate on top drawer
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.04, 0.006),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 }),
    );
    label.position.set(0, 0.9, 0.23);
    cab.add(label);
  }

  return group;
}

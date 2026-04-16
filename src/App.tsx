import { Canvas, useFrame } from '@react-three/fiber';
import {
  Float,
  RoundedBox,
  Sparkles,
} from '@react-three/drei';
import {
  createRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import * as THREE from 'three';

const CHANNEL_LENGTH = 18;
const CHANNEL_WIDTH = 3.8;
const COIN_COUNT = 22;
const PRIZE_CENTER = new THREE.Vector3(0, 0.38, -4.05);
const ROD_BASE = new THREE.Vector3(0, 4.35, 5.85);

type PointerState = {
  x: number;
  y: number;
  shake: number;
};

type CoinState = {
  id: number;
  weight: number;
  prize: string;
  color: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  rotation: number;
  tilt: number;
  spin: number;
  bob: number;
  scale: number;
  state: 'river' | 'attached' | 'cooldown';
  respawnAt: number;
};

type AwardResult = {
  prize: string;
  weight: number;
  color: string;
  jackpot: boolean;
};

type CatchInfo = {
  prize: string;
  weight: number;
  firmness: string;
};

type GameplayState = {
  coins: CoinState[];
  tipPos: THREE.Vector3;
  tipVel: THREE.Vector3;
  magnetPos: THREE.Vector3;
  magnetVel: THREE.Vector3;
  attachedCoinId: number | null;
  shakeEnergy: number;
  elapsed: number;
};

const PRIZE_LEVELS = [
  { minWeight: 0.86, label: '终极大奖', color: '#ff6fb2' },
  { minWeight: 0.72, label: '金奖', color: '#ffd45d' },
  { minWeight: 0.58, label: '银奖', color: '#d9ebff' },
  { minWeight: 0.44, label: '铜奖', color: '#ffb37c' },
  { minWeight: 0, label: '幸运奖', color: '#9bf29d' },
] as const;

function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomRiverZ() {
  const spread = Math.random() < 0.65 ? 1.25 : 0.7;
  return (Math.random() * 2 - 1) * randomRange(0.35, spread);
}

function prizeForWeight(weight: number) {
  return PRIZE_LEVELS.find((level) => weight >= level.minWeight) ?? PRIZE_LEVELS.at(-1)!;
}

function firmnessForWeight(weight: number) {
  if (weight >= 0.86) return '牢牢吸住';
  if (weight >= 0.72) return '非常稳';
  if (weight >= 0.58) return '有点难甩';
  if (weight >= 0.44) return '能明显摇松';
  return '容易甩掉';
}

function createCoin(id: number, x = randomRange(-11, 11)): CoinState {
  const weight = 0.24 + Math.pow(Math.random(), 2.3) * 0.76;
  const prize = prizeForWeight(weight);

  return {
    id,
    weight,
    prize: prize.label,
    color: prize.color,
    x,
    y: -0.18,
    z: randomRiverZ(),
    speed: randomRange(1.05, 1.85),
    rotation: Math.random() * Math.PI * 2,
    tilt: randomRange(-0.14, 0.14),
    spin: randomRange(0.9, 2.1),
    bob: Math.random() * Math.PI * 2,
    scale: 0.88 + weight * 0.25,
    state: 'river',
    respawnAt: 0,
  };
}

function respawnCoin(coin: CoinState) {
  Object.assign(
    coin,
    createCoin(coin.id, -CHANNEL_LENGTH / 2 - 2 - Math.random() * 5.5),
  );
}

function cooldownCoin(coin: CoinState, delay: number) {
  coin.state = 'cooldown';
  coin.respawnAt = delay;
}

function setBezierPoint(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
) {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const inv3 = inv2 * inv;
  const t2 = t * t;
  const t3 = t2 * t;

  out.set(
    inv3 * p0.x + 3 * inv2 * t * p1.x + 3 * inv * t2 * p2.x + t3 * p3.x,
    inv3 * p0.y + 3 * inv2 * t * p1.y + 3 * inv * t2 * p2.y + t3 * p3.y,
    inv3 * p0.z + 3 * inv2 * t * p1.z + 3 * inv * t2 * p2.z + t3 * p3.z,
  );

  return out;
}

function smoothSpring(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  target: THREE.Vector3,
  strength: number,
  damping: number,
  delta: number,
) {
  velocity.x += (target.x - position.x) * strength * delta;
  velocity.y += (target.y - position.y) * strength * delta;
  velocity.z += (target.z - position.z) * strength * delta;
  velocity.multiplyScalar(Math.exp(-damping * delta));
  position.addScaledVector(velocity, delta);
}

function App() {
  const pointerRef = useRef<PointerState>({
    x: 0,
    y: 0,
    shake: 0,
  });
  const [attached, setAttached] = useState<CatchInfo | null>(null);
  const [lastAward, setLastAward] = useState<AwardResult | null>(null);
  const [stats, setStats] = useState({
    opened: 0,
    jackpot: 0,
  });

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
      pointerRef.current.shake = Math.min(
        pointerRef.current.shake + Math.hypot(event.movementX, event.movementY) * 0.02,
        24,
      );
    };

    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  const handleAward = (award: AwardResult) => {
    setLastAward(award);
    setStats((current) => ({
      opened: current.opened + 1,
      jackpot: current.jackpot + (award.jackpot ? 1 : 0),
    }));
  };

  return (
    <div className="app-shell">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 7.8, 13.8], fov: 39 }}
      >
        <color attach="background" args={['#ffeaf3']} />
        <fog attach="fog" args={['#ffeaf3', 12, 24]} />
        <GameScene
          pointerRef={pointerRef}
          onCatchChange={setAttached}
          onAward={handleAward}
        />
      </Canvas>

      <div className="hud hud-title">
        <p className="eyebrow">Mario Party 风格 3D 小游戏</p>
        <h1>水流钓金币</h1>
        <p className="subtitle">
          在浅浅的金币水道里钓起金币，摇掉轻币，把最重的那枚送进圆盘开奖。
        </p>
      </div>

      <div className="hud hud-left">
        <h2>操作</h2>
        <ul>
          <li>移动鼠标：带动固定在前缘的钓竿扫过河道与开奖圆盘。</li>
          <li>快速左右甩动鼠标：让钓竿和钓线剧烈摆动，甩掉较轻的金币。</li>
          <li>把保留下来的金币带到中间圆盘上方：自动开奖并回收金币。</li>
        </ul>
        <p className="hint">
          更重的金币会更牢地吸在磁铁上，也会把钓竿明显拽入水中。
        </p>
      </div>

      <div className="hud hud-right">
        <h2>本轮信息</h2>
        {attached ? (
          <div className="card">
            <strong>{attached.prize}</strong>
            <span>重量 {attached.weight.toFixed(2)}</span>
            <span>{attached.firmness}</span>
          </div>
        ) : (
          <div className="card muted">
            <strong>尚未吸到金币</strong>
            <span>让磁铁贴近河道里的金币试试。</span>
          </div>
        )}

        <h2>开奖记录</h2>
        {lastAward ? (
          <div className="card" style={{ borderColor: lastAward.color }}>
            <strong style={{ color: lastAward.color }}>{lastAward.prize}</strong>
            <span>开奖重量 {lastAward.weight.toFixed(2)}</span>
            <span>{lastAward.jackpot ? '这枚就是终极大奖' : '还可以继续筛更重的'}</span>
          </div>
        ) : (
          <div className="card muted">
            <strong>还没开出奖品</strong>
            <span>把金币送到中央圆盘后开奖。</span>
          </div>
        )}

        <div className="stats">
          <div>
            <span>已开奖</span>
            <strong>{stats.opened}</strong>
          </div>
          <div>
            <span>终极大奖</span>
            <strong>{stats.jackpot}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameScene({
  pointerRef,
  onCatchChange,
  onAward,
}: {
  pointerRef: MutableRefObject<PointerState>;
  onCatchChange: (info: CatchInfo | null) => void;
  onAward: (award: AwardResult) => void;
}) {
  const coins = useMemo(() => {
    const xs = Array.from({ length: COIN_COUNT }, () => randomRange(-11, 11)).sort(
      (left, right) => left - right,
    );
    return xs.map((x, index) => createCoin(index, x));
  }, []);

  const state = useRef<GameplayState>({
    coins,
    tipPos: new THREE.Vector3(0, 2.35, 2.4),
    tipVel: new THREE.Vector3(),
    magnetPos: new THREE.Vector3(0, 0.18, 1.6),
    magnetVel: new THREE.Vector3(),
    attachedCoinId: null,
    shakeEnergy: 0,
    elapsed: 0,
  });
  const lastAttached = useRef<number | null>(null);

  useFrame((_, delta) => {
    const game = state.current;
    game.elapsed += delta;
    game.shakeEnergy = Math.min(
      game.shakeEnergy * Math.exp(-4.6 * delta) + pointerRef.current.shake,
      28,
    );
    pointerRef.current.shake = 0;

    const attachedCoin =
      game.attachedCoinId === null ? null : game.coins[game.attachedCoinId];
    const load = attachedCoin?.weight ?? 0;

    const targetTip = new THREE.Vector3(
      THREE.MathUtils.clamp(pointerRef.current.x * 5.5, -5.6, 5.6),
      2.18 - load * 0.72,
      THREE.MathUtils.mapLinear(pointerRef.current.y, -1, 1, 4.8, -4.75),
    );

    smoothSpring(game.tipPos, game.tipVel, targetTip, 16, 6.2, delta);

    const desiredMagnet = new THREE.Vector3(
      game.tipPos.x,
      game.tipPos.y - (2.08 + load * 0.78),
      game.tipPos.z,
    );
    const magnetForce = desiredMagnet
      .clone()
      .sub(game.magnetPos)
      .multiplyScalar(11.5)
      .addScaledVector(game.tipVel, 1.65);

    magnetForce.y -= 5.8 + load * 8.8;
    if (game.magnetPos.y < 0.18) {
      magnetForce.x += Math.sin(game.elapsed * 7.2 + game.magnetPos.z) * 0.9;
      magnetForce.z += Math.cos(game.elapsed * 8.4 + game.magnetPos.x) * 0.7;
    }

    game.magnetVel.addScaledVector(magnetForce, delta);
    game.magnetVel.multiplyScalar(Math.exp(-3.4 * delta));
    game.magnetPos.addScaledVector(game.magnetVel, delta);
    game.magnetPos.x = THREE.MathUtils.clamp(game.magnetPos.x, -6.25, 6.25);
    game.magnetPos.z = THREE.MathUtils.clamp(game.magnetPos.z, -5.25, 5.15);
    game.magnetPos.y = THREE.MathUtils.clamp(game.magnetPos.y, -0.52, 1.45);
    if (game.magnetPos.y <= -0.52 && game.magnetVel.y < 0) {
      game.magnetVel.y *= -0.12;
    }

    for (const coin of game.coins) {
      if (coin.state === 'cooldown') {
        coin.respawnAt -= delta;
        if (coin.respawnAt <= 0) {
          respawnCoin(coin);
        }
        continue;
      }

      if (coin.state === 'attached') {
        const follow = 1 - Math.exp(-delta * 10.5);
        coin.x = THREE.MathUtils.lerp(coin.x, game.magnetPos.x, follow);
        coin.y = THREE.MathUtils.lerp(
          coin.y,
          game.magnetPos.y - (0.3 + coin.weight * 0.08),
          follow,
        );
        coin.z = THREE.MathUtils.lerp(coin.z, game.magnetPos.z, follow);
        coin.rotation += delta * (2.8 + game.magnetVel.length() * 0.75);
        coin.tilt = THREE.MathUtils.lerp(coin.tilt, game.magnetVel.x * 0.08, 0.1);
      } else {
        coin.x += coin.speed * delta;
        coin.y = -0.19 + Math.sin(game.elapsed * 1.9 + coin.bob) * 0.03;
        coin.rotation += delta * coin.spin;
        coin.tilt = Math.sin(game.elapsed * 1.25 + coin.bob) * 0.14;
        if (coin.x > CHANNEL_LENGTH / 2 + 3) {
          respawnCoin(coin);
        }
      }
    }

    if (game.attachedCoinId === null && game.magnetPos.y < 0.24) {
      let bestMatch: CoinState | null = null;
      let bestDistance = Infinity;

      for (const coin of game.coins) {
        if (coin.state !== 'river') continue;

        const distance = game.magnetPos.distanceToSquared(
          new THREE.Vector3(coin.x, coin.y, coin.z),
        );
        const captureRadius = 0.17 + coin.weight * 0.28;

        if (distance < captureRadius * captureRadius && distance < bestDistance) {
          bestDistance = distance;
          bestMatch = coin;
        }
      }

      if (bestMatch) {
        bestMatch.state = 'attached';
        game.attachedCoinId = bestMatch.id;
      }
    }

    const currentCoin =
      game.attachedCoinId === null ? null : game.coins[game.attachedCoinId];
    if (currentCoin) {
      const shakeScore =
        game.shakeEnergy +
        game.magnetVel.length() * 2.4 +
        Math.abs(game.tipVel.x) * 1.8 +
        Math.abs(game.tipVel.z) * 1.8;
      const detachThreshold = 6.1 + currentCoin.weight * 12.5;
      if (shakeScore > detachThreshold) {
        cooldownCoin(currentCoin, 0.95 + Math.random() * 1.15);
        game.attachedCoinId = null;
      } else {
        const prizeDistance = Math.hypot(
          currentCoin.x - PRIZE_CENTER.x,
          currentCoin.z - PRIZE_CENTER.z,
        );
        if (prizeDistance < 1.14 && currentCoin.y < 1.15 && game.magnetPos.z < -2.55) {
          onAward({
            prize: currentCoin.prize,
            weight: currentCoin.weight,
            color: currentCoin.color,
            jackpot: currentCoin.prize === '终极大奖',
          });
          cooldownCoin(currentCoin, 1.45 + Math.random() * 1.1);
          game.attachedCoinId = null;
        }
      }
    }

    if (lastAttached.current !== game.attachedCoinId) {
      lastAttached.current = game.attachedCoinId;
      if (game.attachedCoinId === null) {
        onCatchChange(null);
      } else {
        const coin = game.coins[game.attachedCoinId];
        onCatchChange({
          prize: coin.prize,
          weight: coin.weight,
          firmness: firmnessForWeight(coin.weight),
        });
      }
    }
  });

  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight intensity={0.9} color="#fff7f1" groundColor="#ffc2e4" />
      <directionalLight
        castShadow
        position={[7, 11, 5]}
        intensity={1.5}
        color="#fff8cf"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={28}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.64, 0]} receiveShadow>
        <planeGeometry args={[30, 24]} />
        <meshToonMaterial color="#ffc7de" />
      </mesh>

      <Float speed={1.4} rotationIntensity={0.12} floatIntensity={0.1}>
        <group position={[-8.8, 5.8, -6]}>
          <mesh castShadow>
            <sphereGeometry args={[0.8, 18, 18]} />
            <meshToonMaterial color="#ffffff" />
          </mesh>
          <mesh castShadow position={[0.75, 0.1, 0]}>
            <sphereGeometry args={[0.6, 18, 18]} />
            <meshToonMaterial color="#ffffff" />
          </mesh>
          <mesh castShadow position={[1.25, -0.08, 0]}>
            <sphereGeometry args={[0.48, 18, 18]} />
            <meshToonMaterial color="#ffffff" />
          </mesh>
        </group>
      </Float>
      <Float speed={1.2} rotationIntensity={0.09} floatIntensity={0.12}>
        <group position={[8.2, 6.6, -4.4]}>
          <mesh castShadow>
            <sphereGeometry args={[0.72, 18, 18]} />
            <meshToonMaterial color="#fff7fe" />
          </mesh>
          <mesh castShadow position={[0.68, 0.05, 0]}>
            <sphereGeometry args={[0.52, 18, 18]} />
            <meshToonMaterial color="#fff7fe" />
          </mesh>
        </group>
      </Float>

      <ShallowRiver />
      <PrizePlatform />
      <MascotPig />
      <FishingRig state={state} />
      {coins.map((coin) => (
        <RiverCoin key={coin.id} coin={coin} />
      ))}
      <Sparkles
        count={22}
        scale={[2.9, 1.35, 2.9]}
        position={[0, 1.2, -4.05]}
        color="#ffe27d"
        size={6}
        speed={0.35}
      />
    </>
  );
}

function ShallowRiver() {
  return (
    <group position={[0, 0, 0]}>
      <RoundedBox
        args={[CHANNEL_LENGTH + 3, 0.9, CHANNEL_WIDTH + 2]}
        radius={0.42}
        smoothness={5}
        position={[0, -0.22, 0]}
        receiveShadow
      >
        <meshToonMaterial color="#9fd3ff" />
      </RoundedBox>

      <RoundedBox
        args={[CHANNEL_LENGTH + 1.3, 0.62, CHANNEL_WIDTH + 0.5]}
        radius={0.32}
        smoothness={5}
        position={[0, -0.12, 0]}
        receiveShadow
      >
        <meshToonMaterial color="#62b6ff" />
      </RoundedBox>

      <RoundedBox
        args={[CHANNEL_LENGTH + 2.3, 0.65, 0.62]}
        radius={0.2}
        smoothness={4}
        position={[0, 0.34, CHANNEL_WIDTH / 2 + 0.68]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial color="#ffe6a9" />
      </RoundedBox>
      <RoundedBox
        args={[CHANNEL_LENGTH + 2.3, 0.65, 0.62]}
        radius={0.2}
        smoothness={4}
        position={[0, 0.34, -CHANNEL_WIDTH / 2 - 0.68]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial color="#ffe6a9" />
      </RoundedBox>

      <RoundedBox
        args={[1.7, 0.45, 2]}
        radius={0.18}
        smoothness={4}
        position={[0, 0.2, 5.5]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial color="#fff1bf" />
      </RoundedBox>

      <WaterSurface />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[CHANNEL_LENGTH + 0.5, CHANNEL_WIDTH]} />
        <meshToonMaterial color="#3d96db" />
      </mesh>
    </group>
  );
}

function WaterSurface() {
  const surfaceRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const mesh = surfaceRef.current;
    if (!mesh) return;
    const positions = mesh.geometry.attributes.position;
    const time = state.clock.elapsedTime;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      positions.setZ(
        index,
        Math.sin(x * 0.55 + time * 2.2) * 0.055 +
          Math.cos(y * 1.7 + time * 1.3) * 0.022,
      );
    }

    positions.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });

  return (
    <>
      <mesh
        ref={surfaceRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.12, 0]}
        receiveShadow
      >
        <planeGeometry args={[CHANNEL_LENGTH + 0.55, CHANNEL_WIDTH, 44, 12]} />
        <meshPhysicalMaterial
          color="#6fe4ff"
          roughness={0.18}
          metalness={0.05}
          clearcoat={1}
          transmission={0.2}
          transparent
          opacity={0.72}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.122, 0]}>
        <planeGeometry args={[CHANNEL_LENGTH + 0.2, CHANNEL_WIDTH - 0.35]} />
        <meshBasicMaterial color="#d2fbff" transparent opacity={0.15} />
      </mesh>
    </>
  );
}

function PrizePlatform() {
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!pulseRef.current) return;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.1) * 0.04;
    pulseRef.current.scale.set(pulse, 1, pulse);
  });

  return (
    <group position={[0, 0, -4.05]}>
      <RoundedBox
        args={[3.6, 0.55, 3.6]}
        radius={1.55}
        smoothness={6}
        position={[0, 0.08, 0]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial color="#fff2a8" />
      </RoundedBox>

      <mesh ref={pulseRef} position={[0, 0.38, 0]} receiveShadow>
        <cylinderGeometry args={[1.2, 1.45, 0.12, 48]} />
        <meshToonMaterial color="#ff9fbe" />
      </mesh>
      <mesh position={[0, 0.47, 0]}>
        <cylinderGeometry args={[0.82, 1.02, 0.08, 48]} />
        <meshToonMaterial color="#fff8d5" />
      </mesh>
      <mesh position={[0, 0.56, 0]}>
        <torusGeometry args={[0.84, 0.05, 16, 48]} />
        <meshToonMaterial color="#ffd761" />
      </mesh>
    </group>
  );
}

function MascotPig() {
  return (
    <Float speed={1.5} rotationIntensity={0.08} floatIntensity={0.08}>
      <group position={[4.6, 0.22, -4.25]}>
        <mesh position={[0, 0.14, 0]} receiveShadow>
          <cylinderGeometry args={[1.5, 1.85, 0.34, 32]} />
          <meshToonMaterial color="#ffd866" />
        </mesh>
        {[-0.65, -0.2, 0.35, 0.8].map((x, index) => (
          <mesh
            // eslint-disable-next-line react/no-array-index-key
            key={`pile-${index}`}
            castShadow
            position={[x, 0.36 + (index % 2) * 0.08, (index % 2) * 0.18 - 0.15]}
            rotation={[0, index * 0.4, 0.12]}
          >
            <cylinderGeometry args={[0.28, 0.28, 0.08, 24]} />
            <meshToonMaterial color="#ffd45d" />
          </mesh>
        ))}

        <group position={[0, 1.3, 0]}>
          <mesh castShadow position={[0, 0.9, 0]}>
            <sphereGeometry args={[0.82, 28, 28]} />
            <meshToonMaterial color="#ff9cc6" />
          </mesh>
          <mesh castShadow position={[0, 2.05, 0]}>
            <sphereGeometry args={[0.62, 28, 28]} />
            <meshToonMaterial color="#ffb0cf" />
          </mesh>
          <mesh castShadow position={[-0.28, 2.5, -0.05]} rotation={[0, 0, 0.45]}>
            <coneGeometry args={[0.16, 0.36, 18]} />
            <meshToonMaterial color="#ff8ebb" />
          </mesh>
          <mesh castShadow position={[0.28, 2.5, -0.05]} rotation={[0, 0, -0.45]}>
            <coneGeometry args={[0.16, 0.36, 18]} />
            <meshToonMaterial color="#ff8ebb" />
          </mesh>
          <mesh castShadow position={[0, 1.96, 0.53]}>
            <sphereGeometry args={[0.26, 22, 22]} />
            <meshToonMaterial color="#ff86b7" />
          </mesh>
          <mesh castShadow position={[-0.2, 2.12, 0.56]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshToonMaterial color="#51365a" />
          </mesh>
          <mesh castShadow position={[0.2, 2.12, 0.56]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshToonMaterial color="#51365a" />
          </mesh>

          <mesh castShadow position={[-0.72, 1.15, 0]} rotation={[0, 0, 0.82]}>
            <capsuleGeometry args={[0.14, 0.55, 8, 14]} />
            <meshToonMaterial color="#ff9cc6" />
          </mesh>
          <mesh castShadow position={[0.72, 1.15, 0]} rotation={[0, 0, -1.05]}>
            <capsuleGeometry args={[0.14, 0.82, 8, 14]} />
            <meshToonMaterial color="#ff9cc6" />
          </mesh>
          <mesh castShadow position={[1.28, 2.1, 0]} rotation={[0.2, 0.3, -0.2]}>
            <cylinderGeometry args={[0.32, 0.32, 0.11, 30]} />
            <meshToonMaterial color="#ffd761" />
          </mesh>
          <mesh castShadow position={[-0.32, 0.15, 0.1]}>
            <capsuleGeometry args={[0.14, 0.48, 8, 14]} />
            <meshToonMaterial color="#ff8ebd" />
          </mesh>
          <mesh castShadow position={[0.32, 0.15, 0.1]}>
            <capsuleGeometry args={[0.14, 0.48, 8, 14]} />
            <meshToonMaterial color="#ff8ebd" />
          </mesh>
        </group>
      </group>
    </Float>
  );
}

function RiverCoin({ coin }: { coin: CoinState }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    group.visible = coin.state !== 'cooldown';
    group.position.set(coin.x, coin.y, coin.z);
    group.rotation.set(0.12 + coin.tilt, coin.rotation, -0.16);
    group.scale.setScalar(coin.scale);
  });

  return (
    <group ref={groupRef}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.34, 0.11, 36]} />
        <meshToonMaterial color={coin.color} />
      </mesh>
      <mesh position={[0, 0.062, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.02, 32]} />
        <meshToonMaterial color="#fff2bc" />
      </mesh>
      <mesh position={[0, -0.062, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.02, 32]} />
        <meshToonMaterial color="#fff2bc" />
      </mesh>
      <mesh position={[0, 0.073, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.215, 0.024, 14, 32]} />
        <meshToonMaterial color="#ffe16d" />
      </mesh>
      <mesh position={[0, -0.073, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.215, 0.024, 14, 32]} />
        <meshToonMaterial color="#ffe16d" />
      </mesh>
      <mesh position={[0, 0.09, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.18, 0.025, 0.04]} />
        <meshToonMaterial color="#fff8dd" />
      </mesh>
      <mesh position={[0, 0.09, 0]} rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[0.18, 0.025, 0.04]} />
        <meshToonMaterial color="#fff8dd" />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <boxGeometry args={[0.04, 0.025, 0.18]} />
        <meshToonMaterial color="#fff8dd" />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <boxGeometry args={[0.18, 0.025, 0.04]} />
        <meshToonMaterial color="#fff8dd" />
      </mesh>
    </group>
  );
}

function FishingRig({ state }: { state: MutableRefObject<GameplayState> }) {
  const rodRefs = useMemo(
    () => Array.from({ length: 15 }, () => createRef<THREE.Mesh>()),
    [],
  );
  const lineRefs = useMemo(
    () => Array.from({ length: 19 }, () => createRef<THREE.Mesh>()),
    [],
  );
  const magnetRef = useRef<THREE.Group>(null);
  const rippleRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const game = state.current;
    const load =
      game.attachedCoinId === null ? 0 : game.coins[game.attachedCoinId].weight;
    const rodCtrlA = new THREE.Vector3().copy(ROD_BASE).lerp(game.tipPos, 0.3);
    rodCtrlA.y += 0.8 - load * 0.25;
    rodCtrlA.z -= 0.25;

    const rodCtrlB = new THREE.Vector3().copy(ROD_BASE).lerp(game.tipPos, 0.74);
    rodCtrlB.y += 0.15 - load * 0.58;
    rodCtrlB.z += 0.08;

    const rodPoint = new THREE.Vector3();
    for (let index = 0; index < rodRefs.length; index += 1) {
      const ref = rodRefs[index].current;
      if (!ref) continue;
      const t = index / (rodRefs.length - 1);
      setBezierPoint(rodPoint, ROD_BASE, rodCtrlA, rodCtrlB, game.tipPos, t);
      ref.position.copy(rodPoint);
      const scale = 0.19 - t * 0.11;
      ref.scale.setScalar(Math.max(0.05, scale));
    }

    const lineCtrlA = new THREE.Vector3(
      game.tipPos.x + game.tipVel.x * 0.12,
      game.tipPos.y - 0.55 - load * 0.18,
      game.tipPos.z + game.tipVel.z * 0.12,
    );
    const lineCtrlB = new THREE.Vector3(
      game.magnetPos.x - game.magnetVel.x * 0.06,
      game.magnetPos.y + 0.7 + load * 0.2,
      game.magnetPos.z - game.magnetVel.z * 0.06,
    );
    const linePoint = new THREE.Vector3();
    for (let index = 0; index < lineRefs.length; index += 1) {
      const ref = lineRefs[index].current;
      if (!ref) continue;
      const t = index / (lineRefs.length - 1);
      setBezierPoint(linePoint, game.tipPos, lineCtrlA, lineCtrlB, game.magnetPos, t);
      ref.position.copy(linePoint);
      const scale = 0.045 - t * 0.012;
      ref.scale.setScalar(Math.max(0.012, scale));
    }

    if (magnetRef.current) {
      magnetRef.current.position.copy(game.magnetPos);
      magnetRef.current.rotation.set(
        game.magnetVel.z * 0.1,
        game.elapsed * 1.1,
        -game.magnetVel.x * 0.1,
      );
    }

    if (rippleRef.current) {
      const visible = game.magnetPos.y < 0.18;
      rippleRef.current.visible = visible;
      rippleRef.current.position.set(game.magnetPos.x, 0.13, game.magnetPos.z);
      const rippleScale =
        0.55 +
        Math.min(game.magnetVel.length() * 0.22 + load * 0.55, 1.2) +
        Math.sin(game.elapsed * 7.8) * 0.04;
      rippleRef.current.scale.set(rippleScale, rippleScale, rippleScale);
    }
  });

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 3.9, 5.95]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 1.3, 18]} />
        <meshToonMaterial color="#ffcb73" />
      </mesh>
      <RoundedBox
        args={[1.45, 0.42, 0.72]}
        radius={0.16}
        smoothness={4}
        position={[0, 3.55, 5.95]}
        castShadow
        receiveShadow
      >
        <meshToonMaterial color="#8f5b4a" />
      </RoundedBox>

      {rodRefs.map((ref, index) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={`rod-node-${index}`}
          ref={ref}
          castShadow
        >
          <sphereGeometry args={[1, 18, 18]} />
          <meshToonMaterial color={index < rodRefs.length - 3 ? '#ffb347' : '#fff4c2'} />
        </mesh>
      ))}

      {lineRefs.map((ref, index) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={`line-node-${index}`}
          ref={ref}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color="#f2fdff" />
        </mesh>
      ))}

      <group ref={magnetRef}>
        <mesh castShadow>
          <torusGeometry args={[0.18, 0.05, 14, 24]} />
          <meshToonMaterial color="#ff627d" />
        </mesh>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.3, 18]} />
          <meshToonMaterial color="#ff9dad" />
        </mesh>
        <mesh castShadow position={[0, -0.16, 0]}>
          <sphereGeometry args={[0.08, 14, 14]} />
          <meshToonMaterial color="#ffeef3" />
        </mesh>
      </group>

      <mesh ref={rippleRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[0.55, 0.03, 8, 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.42} />
      </mesh>
    </group>
  );
}

export default App;

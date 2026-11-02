import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Effects } from './quality'
import { angleAt, BENCH_RADIUS, SLOTS, WALL_RADIUS, type Walker } from './walker'

const BARRIER_RADIUS = WALL_RADIUS - 0.55
const FLOOR_RADIUS = WALL_RADIUS - 0.2
const SKY_RADIUS = 150

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

const paint = (width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Soft round blob, repeated across the seam so the sky wraps without a line. */
function blob(c: CanvasRenderingContext2D, width: number, x: number, y: number, radius: number, color: string, alpha: number) {
  for (const offset of [0, -width, width]) {
    const cx = x + offset
    if (cx + radius < 0 || cx - radius > width) continue
    const gradient = c.createRadialGradient(cx, y, 0, cx, y, radius)
    c.globalAlpha = alpha
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, 'transparent')
    c.fillStyle = gradient
    c.fillRect(cx - radius, y - radius, radius * 2, radius * 2)
  }
  c.globalAlpha = 1
}

/** The Milky Way, painted once into an equirectangular map so rendering it costs one draw. */
function bakeSky(width: number) {
  const height = width / 2
  const unit = width / 2048
  const random = seeded(4242)
  const gauss = () => (random() + random() + random() + random() - 2) / 2
  return paint(width, height, (c) => {
    const base = c.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#05061a')
    base.addColorStop(0.5, '#080920')
    base.addColorStop(1, '#05061a')
    c.fillStyle = base
    c.fillRect(0, 0, width, height)

    const bandY = (x: number) => height * (0.5 + Math.sin((x / width) * Math.PI * 2 + 0.6) * 0.2)
    const colors = ['#4b5be0', '#7c4fd8', '#3a86d8', '#c05fb8']
    c.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 420; i++) {
      const x = random() * width
      blob(c, width, x, bandY(x) + gauss() * 105 * unit, (50 + random() * 90) * unit, colors[Math.floor(random() * colors.length)]!, 0.05)
    }
    // The bright core sits on one side of the sky, away from the opening view of a painting.
    for (let i = 0; i < 170; i++) {
      const x = width * 0.72 + gauss() * 520 * unit
      blob(c, width, x, bandY(x) + gauss() * 62 * unit, (24 + random() * 60) * unit, i % 3 ? '#ffd9a8' : '#ffb6c9', 0.13)
    }
    c.globalCompositeOperation = 'source-over'
    for (let i = 0; i < 240; i++) {
      const x = random() * width
      blob(c, width, x, bandY(x) + gauss() * 34 * unit, (10 + random() * 34) * unit, '#050514', 0.42)
    }
    c.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 4200; i++) {
      const x = random() * width
      const near = random() > 0.3
      const y = near ? bandY(x) + gauss() * 190 * unit : random() * height
      c.fillStyle = `rgba(235, 238, 255, ${0.15 + random() * 0.55})`
      const size = (random() > 0.97 ? 2 : 1) * Math.max(unit, 0.7)
      c.fillRect(x, y, size, size)
    }
    c.globalCompositeOperation = 'source-over'
  })
}

export function softDot(inner: string, outer: string) {
  return paint(256, 256, (c) => {
    const gradient = c.createRadialGradient(128, 128, 0, 128, 128, 128)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(0.4, outer)
    gradient.addColorStop(1, 'transparent')
    c.fillStyle = gradient
    c.fillRect(0, 0, 256, 256)
  })
}

function Sky({ size }: { size: number }) {
  const map = useMemo(() => bakeSky(size), [size])
  const ref = useRef<THREE.Mesh>(null!)
  useLayoutEffect(() => () => map.dispose(), [map])
  useFrame(({ camera, clock }) => {
    ref.current.position.copy(camera.position)
    ref.current.rotation.y = clock.elapsedTime * 0.002
  })
  return (
    <mesh ref={ref} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 40, 24]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  )
}

const STAR_VERTEX = /* glsl */ `
  attribute float size;
  attribute float depth;
  attribute float phase;
  attribute vec3 tint;
  uniform float time;
  uniform float pixels;
  varying vec3 vTint;
  varying float vGlow;
  void main() {
    // Near layers shift more as the camera moves, which is what gives the sky its depth.
    vec3 world = position + cameraPosition * (1.0 - depth);
    vTint = tint;
    vGlow = 0.72 + 0.28 * sin(time * 1.3 + phase);
    gl_PointSize = size * pixels;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  varying float vGlow;
  void main() {
    float fade = 1.0 - smoothstep(0.05, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vTint * vGlow * fade, fade);
  }
`

/** Three shells of stars in one draw call, separated only by how far they drift with the camera. */
function Stars({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const random = seeded(99)
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const depths = new Float32Array(count)
    const phases = new Float32Array(count)
    const tints = new Float32Array(count * 3)
    const palette = [
      [0.86, 0.9, 1],
      [0.72, 0.8, 1],
      [1, 0.92, 0.78],
    ]
    for (let i = 0; i < count; i++) {
      const layer = i % 3
      const radius = [46, 80, 120][layer]!
      const y = random() * 2 - 1
      const around = random() * Math.PI * 2
      const ring = Math.sqrt(1 - y * y)
      positions[i * 3] = Math.cos(around) * ring * radius
      positions[i * 3 + 1] = y * radius
      positions[i * 3 + 2] = Math.sin(around) * ring * radius
      sizes[i] = [2.6, 1.9, 1.3][layer]! * (0.7 + random() * 0.8)
      depths[i] = [0.86, 0.93, 0.98][layer]!
      phases[i] = random() * Math.PI * 2
      tints.set(palette[Math.floor(random() * palette.length)]!, i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    g.setAttribute('depth', new THREE.BufferAttribute(depths, 1))
    g.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
    g.setAttribute('tint', new THREE.BufferAttribute(tints, 3))
    return g
  }, [count])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        uniforms: { time: { value: 0 }, pixels: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  useLayoutEffect(() => () => geometry.dispose(), [geometry])
  useLayoutEffect(() => () => material.dispose(), [material])
  useFrame(({ clock, viewport }) => {
    material.uniforms.time!.value = clock.elapsedTime
    material.uniforms.pixels!.value = viewport.dpr
  })
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-9} />
}

const NEBULAE = [
  { position: [-70, 22, -60], scale: 95, color: '#6a4fd8' },
  { position: [78, -12, -40], scale: 80, color: '#2f7fd0' },
  { position: [30, 34, 86], scale: 90, color: '#b0509f' },
  { position: [-64, -30, 62], scale: 80, color: '#3f5fd8' },
  { position: [6, 62, -40], scale: 70, color: '#7c6cf0' },
] as const

function Nebulae({ count }: { count: number }) {
  const map = useMemo(() => softDot('rgba(255,255,255,.55)', 'rgba(255,255,255,.16)'), [])
  useLayoutEffect(() => () => map.dispose(), [map])
  return (
    <>
      {NEBULAE.slice(0, count).map(({ position, scale, color }) => (
        <sprite key={color + scale} position={position} scale={[scale, scale, 1]} renderOrder={-8}>
          <spriteMaterial map={map} color={color} opacity={0.09} transparent depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </>
  )
}

function bandedPlanet(colors: string[], seed: number) {
  const random = seeded(seed)
  const map = paint(512, 256, (c) => {
    let y = 0
    while (y < 256) {
      const band = 8 + random() * 34
      c.fillStyle = colors[Math.floor(random() * colors.length)]!
      c.fillRect(0, y, 512, band + 1)
      y += band
    }
    c.globalAlpha = 0.16
    for (let i = 0; i < 90; i++) {
      c.fillStyle = colors[Math.floor(random() * colors.length)]!
      const x = random() * 512
      const py = random() * 256
      c.beginPath()
      c.ellipse(x, py, 20 + random() * 50, 2 + random() * 5, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  })
  map.wrapS = THREE.RepeatWrapping
  return map
}

function ringTexture() {
  const random = seeded(31)
  return paint(512, 16, (c) => {
    for (let x = 0; x < 512; x += 2) {
      const edge = Math.min(x / 40, (512 - x) / 40, 1)
      c.fillStyle = `rgba(${225 + random() * 30}, ${205 + random() * 30}, ${170 + random() * 50}, ${(0.22 + random() * 0.55) * edge})`
      c.fillRect(x, 0, 2, 16)
    }
  })
}

/** Ringlike geometry whose u runs across the ring, so a strip texture reads as banding. */
function ringGeometry(inner: number, outer: number) {
  const geometry = new THREE.RingGeometry(inner, outer, 72, 1)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i++) {
    const radius = Math.hypot(position.getX(i), position.getY(i))
    uv.setXY(i, (radius - inner) / (outer - inner), 0.5)
  }
  return geometry
}

/** The ringed planet at the heart of the platform; the pedestal is the solid part the cat walks round. */
function Heart() {
  const parts = useMemo(
    () => ({
      planet: bandedPlanet(['#d9925a', '#e8b071', '#b86a4a', '#f0cf98', '#a65a52'], 77),
      ring: ringTexture(),
      ringShape: ringGeometry(0.98, 1.46),
      glow: softDot('rgba(255,214,150,.75)', 'rgba(255,170,110,.2)'),
    }),
    [],
  )
  useLayoutEffect(
    () => () => {
      parts.planet.dispose()
      parts.ring.dispose()
      parts.ringShape.dispose()
      parts.glow.dispose()
    },
    [parts],
  )
  const planet = useRef<THREE.Mesh>(null!)
  const moons = useRef<THREE.Group>(null!)
  useFrame((_, delta) => {
    planet.current.rotation.y += delta * 0.12
    moons.current.rotation.y -= delta * 0.3
  })
  return (
    <group>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[BENCH_RADIUS - 0.04, BENCH_RADIUS, 0.14, 48]} />
        <meshLambertMaterial color="#232866" emissive="#141844" />
      </mesh>
      <mesh position={[0, 0.145, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BENCH_RADIUS - 0.06, 0.016, 8, 72]} />
        <meshBasicMaterial color="#f4c95d" toneMapped={false} />
      </mesh>
      <sprite position={[0, 1.7, 0]} scale={[3.8, 3.8, 1]} renderOrder={2}>
        <spriteMaterial map={parts.glow} opacity={0.55} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <group position={[0, 1.7, 0]} rotation={[0.42, 0, 0.22]}>
        <mesh ref={planet}>
          <sphereGeometry args={[0.66, 32, 24]} />
          <meshBasicMaterial map={parts.planet} toneMapped={false} />
        </mesh>
        <mesh geometry={parts.ringShape} rotation={[Math.PI / 2, 0, 0]} renderOrder={3}>
          <meshBasicMaterial map={parts.ring} side={THREE.DoubleSide} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <group ref={moons} position={[0, 1.2, 0]}>
        <mesh position={[1.5, 0.25, 0]}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshBasicMaterial color="#cfd6ff" toneMapped={false} />
        </mesh>
        <mesh position={[-0.9, -0.2, 1.05]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          <meshBasicMaterial color="#f4c95d" toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function floorTexture() {
  const size = 1024
  return paint(size, size, (c) => {
    const mid = size / 2
    const scale = mid / FLOOR_RADIUS
    c.translate(mid, mid)
    const glass = c.createRadialGradient(0, 0, 0, 0, 0, mid)
    glass.addColorStop(0, 'rgba(62, 72, 160, .3)')
    glass.addColorStop(0.72, 'rgba(36, 44, 118, .2)')
    glass.addColorStop(0.97, 'rgba(90, 110, 220, .34)')
    glass.addColorStop(1, 'rgba(120, 140, 255, .06)')
    c.fillStyle = glass
    c.beginPath()
    c.arc(0, 0, mid, 0, Math.PI * 2)
    c.fill()

    c.strokeStyle = 'rgba(190, 205, 255, .3)'
    for (const [radius, width] of [[2.6, 1.5], [4.3, 1], [5.6, 2], [7.05, 1], [8.1, 1.5]] as const) {
      c.lineWidth = width
      c.beginPath()
      c.arc(0, 0, radius * scale, 0, Math.PI * 2)
      c.stroke()
    }
    // A gold mark at each viewing spot quietly shows where the pictures are best seen from.
    for (let slot = 0; slot < SLOTS; slot++) {
      const angle = angleAt(slot)
      const x = Math.sin(angle) * scale
      const y = -Math.cos(angle) * scale
      c.strokeStyle = 'rgba(190, 205, 255, .16)'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x * 2.6, y * 2.6)
      c.lineTo(x * 8.1, y * 8.1)
      c.stroke()
      c.fillStyle = 'rgba(244, 201, 93, .8)'
      c.beginPath()
      c.arc(x * 7.05, y * 7.05, 3.5, 0, Math.PI * 2)
      c.fill()
    }
  })
}

function barrierTexture() {
  return paint(4, 64, (c) => {
    const gradient = c.createLinearGradient(0, 64, 0, 0)
    gradient.addColorStop(0, 'rgba(130, 160, 255, .85)')
    gradient.addColorStop(1, 'rgba(130, 160, 255, 0)')
    c.fillStyle = gradient
    c.fillRect(0, 0, 4, 64)
  })
}

function Platform({ walker }: { walker: Walker }) {
  const parts = useMemo(() => ({ floor: floorTexture(), barrier: barrierTexture() }), [])
  const barrier = useRef<THREE.MeshBasicMaterial>(null!)
  useLayoutEffect(
    () => () => {
      parts.floor.dispose()
      parts.barrier.dispose()
    },
    [parts],
  )
  useFrame(({ clock }) => {
    // The barrier wakes as the cat comes near, which explains why it cannot walk further.
    const near = THREE.MathUtils.clamp((walker.radius - 7.3) / 0.9, 0, 1)
    barrier.current.opacity = 0.16 + Math.sin(clock.elapsedTime * 0.8) * 0.03 + near * 0.5
  })
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
        <circleGeometry args={[FLOOR_RADIUS, 72]} />
        <meshBasicMaterial map={parts.floor} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.36, 0]} renderOrder={1}>
        <cylinderGeometry args={[BARRIER_RADIUS, BARRIER_RADIUS, 0.72, 96, 1, true]} />
        <meshBasicMaterial ref={barrier} map={parts.barrier} side={THREE.DoubleSide} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BARRIER_RADIUS, 0.022, 8, 120]} />
        <meshBasicMaterial color="#a9bcff" toneMapped={false} />
      </mesh>
    </>
  )
}

function Asteroids({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const belt = useRef<THREE.Group>(null!)
  useEffect(() => {
    const random = seeded(58)
    const place = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2
      const radius = 19 + random() * 13
      place.position.set(Math.cos(angle) * radius, -7 + random() * 12, Math.sin(angle) * radius)
      place.rotation.set(random() * 6, random() * 6, random() * 6)
      place.scale.set(0.12 + random() * 0.4, 0.1 + random() * 0.3, 0.12 + random() * 0.35)
      place.updateMatrix()
      ref.current.setMatrixAt(i, place.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [count])
  useFrame((_, delta) => {
    belt.current.rotation.y += delta * 0.008
  })
  return (
    <group ref={belt}>
      <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshLambertMaterial color="#514d68" flatShading />
      </instancedMesh>
    </group>
  )
}

function FarPlanet() {
  const map = useMemo(() => bandedPlanet(['#2f4f9f', '#3f6fc8', '#27407f', '#6a9ae0'], 13), [])
  const ref = useRef<THREE.Mesh>(null!)
  useLayoutEffect(() => () => map.dispose(), [map])
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.01
  })
  return (
    <mesh ref={ref} position={[-46, 20, 62]} rotation={[0.3, 0, 0.2]}>
      <sphereGeometry args={[9, 32, 24]} />
      <meshLambertMaterial map={map} fog={false} />
    </mesh>
  )
}

const flight = new THREE.Vector3()

function ShootingStar() {
  const map = useMemo(
    () =>
      paint(128, 8, (c) => {
        const gradient = c.createLinearGradient(0, 0, 128, 0)
        gradient.addColorStop(0, 'transparent')
        gradient.addColorStop(1, 'rgba(255, 255, 255, 1)')
        c.fillStyle = gradient
        c.fillRect(0, 0, 128, 8)
      }),
    [],
  )
  const ref = useRef<THREE.Mesh>(null!)
  const state = useRef({ wait: 5, life: 0 })
  useLayoutEffect(() => () => map.dispose(), [map])
  useFrame((_, delta) => {
    const s = state.current
    const mesh = ref.current
    if (s.life > 0) {
      s.life -= delta
      mesh.position.addScaledVector(flight.set(Math.cos(mesh.rotation.y), -0.25, -Math.sin(mesh.rotation.y)), delta * 70)
      mesh.visible = s.life > 0
      return
    }
    s.wait -= delta
    if (s.wait > 0) return
    const around = Math.random() * Math.PI * 2
    mesh.position.set(Math.cos(around) * 60, 24 + Math.random() * 26, Math.sin(around) * 60)
    mesh.rotation.y = around + Math.PI + (Math.random() - 0.5)
    s.wait = 9 + Math.random() * 12
    s.life = 0.7
    mesh.visible = true
  })
  return (
    <mesh ref={ref} visible={false} scale={[14, 0.14, 1]} renderOrder={-7}>
      <planeGeometry />
      <meshBasicMaterial map={map} side={THREE.DoubleSide} transparent depthWrite={false} fog={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

export function Cosmos({ walker, effects, calm }: { walker: Walker; effects: Effects; calm: boolean }) {
  return (
    <>
      <Sky size={effects.skySize} />
      <Stars count={effects.stars} />
      <Nebulae count={effects.nebulae} />
      <FarPlanet />
      {effects.asteroids > 0 && <Asteroids count={effects.asteroids} />}
      {effects.shootingStars && !calm && <ShootingStar />}
      <Platform walker={walker} />
      <Heart />
    </>
  )
}

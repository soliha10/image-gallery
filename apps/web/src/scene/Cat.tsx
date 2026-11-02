import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { clamp, wrapAngle, type Walker } from './walker'

const GINGER = '#ee9a45'
const GINGER_DEEP = '#cf6f22'
const CREAM = '#fdf1df'
const PINK = '#f5a3a3'
const DARK = '#2a1a12'
const SCALE = 0.86
/** Paw travel of one full step, which keeps the feet planted on the floor. */
const STEP_LENGTH = 0.52
const BOUND_LENGTH = 0.86

const lerp = THREE.MathUtils.lerp

const canvasTexture = (width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

const hairs = (c: CanvasRenderingContext2D, width: number, height: number) => {
  c.lineWidth = 2
  for (let i = 0; i < 1400; i++) {
    const x = (i * 197.3) % width
    const y = (i * 71.9) % height
    const tilt = Math.sin(i * 12.9) * 5
    c.strokeStyle = i % 2 ? 'rgba(255, 232, 190, .05)' : 'rgba(150, 70, 20, .04)'
    c.beginPath()
    c.moveTo(x, y)
    c.lineTo(x + tilt, y + 6)
    c.stroke()
  }
}

/** Tabby coat: the spine runs down the middle of the canvas, the belly along its edges. */
function bodyFur() {
  return canvasTexture(512, 256, (c) => {
    const belly = c.createLinearGradient(0, 0, 512, 0)
    belly.addColorStop(0, CREAM)
    belly.addColorStop(0.1, CREAM)
    belly.addColorStop(0.27, GINGER)
    belly.addColorStop(0.73, GINGER)
    belly.addColorStop(0.9, CREAM)
    belly.addColorStop(1, CREAM)
    c.fillStyle = belly
    c.fillRect(0, 0, 512, 256)
    c.strokeStyle = GINGER_DEEP
    c.lineCap = 'round'
    c.lineWidth = 15
    for (let v = 42; v < 226; v += 40) {
      for (const side of [-1, 1]) {
        c.beginPath()
        c.moveTo(256 + side * 8, v)
        c.quadraticCurveTo(256 + side * 62, v - 16, 256 + side * 118, v + 8)
        c.stroke()
      }
    }
    c.lineWidth = 20
    c.beginPath()
    c.moveTo(256, 18)
    c.lineTo(256, 238)
    c.stroke()
    hairs(c, 512, 256)
  })
}

/** Face fur: the tabby M sits on the forehead, a quarter of the way round the sphere. */
function headFur() {
  return canvasTexture(512, 256, (c) => {
    c.fillStyle = GINGER
    c.fillRect(0, 0, 512, 256)
    c.strokeStyle = GINGER_DEEP
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.lineWidth = 8
    c.beginPath()
    c.moveTo(104, 88)
    c.lineTo(114, 56)
    c.lineTo(128, 80)
    c.lineTo(142, 56)
    c.lineTo(152, 88)
    c.stroke()
    for (const [x, tilt] of [[128, 0], [100, -8], [156, 8], [384, 0], [352, -10], [416, 10]] as const) {
      c.beginPath()
      c.moveTo(x, 12)
      c.lineTo(x + tilt, x === 128 ? 40 : 66)
      c.stroke()
    }
    for (const side of [-1, 1]) {
      c.beginPath()
      c.moveTo(128 + side * 78, 128)
      c.quadraticCurveTo(128 + side * 96, 134, 128 + side * 112, 122)
      c.stroke()
    }
    hairs(c, 512, 256)
  })
}

function eyeTexture() {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = '#1d120c'
    c.fillRect(0, 0, 128, 128)
    const iris = c.createRadialGradient(64, 72, 8, 64, 64, 58)
    iris.addColorStop(0, '#fff3a6')
    iris.addColorStop(0.5, '#9bd46b')
    iris.addColorStop(0.86, '#3f9b5a')
    iris.addColorStop(1, '#1d3f2c')
    c.fillStyle = iris
    c.beginPath()
    c.arc(64, 64, 54, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#120a06'
    c.beginPath()
    c.ellipse(64, 64, 22, 40, 0, 0, Math.PI * 2)
    c.fill()
  })
}

/** Light wrapping round the edge of the fur, which gives the soft plush look cheaply. */
function plush<T extends THREE.MeshLambertMaterial>(material: T, strength = 0.42) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      float fringe = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.4);
      gl_FragColor.rgb += diffuseColor.rgb * 0.2 + fringe * vec3(0.6, 0.74, 1.0) * ${strength.toFixed(2)};`,
    )
  }
  return material
}

/** Bean-shaped torso as one surface: chest, waist and rump flow together with no seams. */
function torsoGeometry() {
  const points = [
    [0, -0.47],
    [0.13, -0.45],
    [0.235, -0.36],
    [0.27, -0.2],
    [0.245, -0.02],
    [0.235, 0.12],
    [0.24, 0.26],
    [0.19, 0.4],
    [0.09, 0.47],
    [0, 0.48],
  ].map(([radius, along]) => new THREE.Vector2(radius, along))
  const curve = new THREE.SplineCurve(points)
  const geometry = new THREE.LatheGeometry(curve.getPoints(28), 28)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, 1.05, 1)
  return geometry
}

/** Wide kitten skull with full cheeks and a slightly flattened top. */
function headGeometry() {
  const geometry = new THREE.SphereGeometry(1, 32, 24)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const cheek = Math.exp(-((y + 0.3) ** 2) / 0.14) * 0.14
    position.setXYZ(i, x * (1.12 + cheek), y * (y > 0 ? 0.88 : 0.96), z * 0.98)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Soft rounded ear, thin at the base edge and bent slightly forward. */
function earGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-0.5, 0)
  shape.quadraticCurveTo(-0.34, 0.62, 0, 1)
  shape.quadraticCurveTo(0.34, 0.62, 0.5, 0)
  shape.quadraticCurveTo(0, -0.12, -0.5, 0)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 3, curveSegments: 10 })
  geometry.translate(0, 0, -0.05)
  return geometry
}

/** Glassy eye dome; the iris is projected straight on so it stays round. */
function eyeGeometry() {
  const geometry = new THREE.SphereGeometry(1, 24, 16)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) * 0.5 + 0.5, position.getY(i) * 0.5 + 0.5)
  return geometry
}

const HELMET_RADIUS = 0.42

/** Clear visor: only its edge and one small highlight catch light, so the face stays open. */
function helmetMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal;
        vView = -view.xyz;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 view = normalize(vView);
        float edge = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
        float glint = pow(max(dot(normal, normalize(vec3(-0.5, 0.65, 0.57))), 0.0), 90.0);
        gl_FragColor = vec4(mix(vec3(0.68, 0.8, 1.0), vec3(1.0), glint), edge * 0.62 + glint * 0.7);
      }
    `,
  })
}

const SMILE_ARC = Math.PI * 0.8

/** Procedural kitten: every pose is computed from `walker` so no model file is shipped. */
export function Cat({ walker }: { walker: Walker }) {
  const shapes = useMemo(
    () => ({ torso: torsoGeometry(), head: headGeometry(), ear: earGeometry(), ball: new THREE.SphereGeometry(1, 16, 12), eye: eyeGeometry() }),
    [],
  )
  const materials = useMemo(() => {
    const body = bodyFur()
    const face = headFur()
    const iris = eyeTexture()
    return {
      body: plush(new THREE.MeshLambertMaterial({ map: body })),
      head: plush(new THREE.MeshLambertMaterial({ map: face })),
      plain: plush(new THREE.MeshLambertMaterial({ color: GINGER })),
      stripe: plush(new THREE.MeshLambertMaterial({ color: GINGER_DEEP })),
      cream: plush(new THREE.MeshLambertMaterial({ color: CREAM }), 0.14),
      pink: plush(new THREE.MeshLambertMaterial({ color: PINK }), 0.1),
      eye: new THREE.MeshBasicMaterial({ map: iris }),
      dark: new THREE.MeshBasicMaterial({ color: DARK }),
      shine: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      blush: new THREE.MeshBasicMaterial({ color: '#ff8f7a', transparent: true, opacity: 0.26, depthWrite: false }),
      gold: new THREE.MeshLambertMaterial({ color: '#e7bb52', emissive: '#6b4a10' }),
      helmet: helmetMaterial(),
    }
  }, [])

  const body = useRef<THREE.Group>(null!)
  const head = useRef<THREE.Group>(null!)
  const earL = useRef<THREE.Group>(null!)
  const earR = useRef<THREE.Group>(null!)
  const eyeL = useRef<THREE.Group>(null!)
  const eyeR = useRef<THREE.Group>(null!)
  const closedL = useRef<THREE.Mesh>(null!)
  const closedR = useRef<THREE.Mesh>(null!)
  const tail = useRef<(THREE.Group | null)[]>([])
  const legs = useRef<(THREE.Group | null)[]>([])
  const motion = useRef({ phase: 0, lean: 0, lookYaw: 0, lookPitch: 0 })

  useLayoutEffect(
    () => () => {
      Object.values(shapes).forEach((g) => g.dispose())
      Object.values(materials).forEach((m) => {
        if ('map' in m) m.map?.dispose()
        m.dispose()
      })
    },
    [materials, shapes],
  )

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const { sit, sleep, happy, speed: rawSpeed, turning, gazeYaw, gazeWeight } = walker
    const m = motion.current
    const speed = Math.min(rawSpeed, 4)
    const moving = Math.min(speed / 0.4, 1) * (1 - sit)
    const run = clamp((speed - 1.9) / 1.2, 0, 1)
    m.phase += ((speed * dt) / lerp(STEP_LENGTH, BOUND_LENGTH, run)) * Math.PI * 2
    const phase = m.phase
    const swing = lerp(0.5, 0.9, run) * moving
    const purr = happy > 0 ? 1 : 0

    // Diagonal pairs for the walk, front and back pairs for the bounding run.
    const gait = [0, Math.PI, Math.PI, 0].map((offset, i) => lerp(offset, i < 2 ? 0 : 0.9, run))
    legs.current.forEach((leg, i) => {
      if (!leg) return
      const stepping = Math.sin(phase + gait[i]!) * swing
      const isHind = i >= 2
      const sitAngle = isHind ? -1.2 : 0.66
      leg.rotation.x = lerp(stepping, sitAngle, sit) * (1 - sleep) + (isHind ? -1.5 : -1.35) * sleep
      const lift = Math.max(Math.cos(phase + gait[i]!), 0) * 0.035 * moving
      leg.position.y = -0.13 + lift
    })

    const bob = Math.abs(Math.sin(phase)) * 0.024 * moving + Math.sin(phase) * 0.05 * run
    const breathe = Math.sin(t * (sleep > 0.5 ? 1.3 : 2.2)) * 0.012
    body.current.position.y = lerp(0.46, 0.5, sit) + bob - sleep * 0.27
    body.current.rotation.x = lerp(Math.sin(phase) * 0.14 * run, -0.74, sit * (1 - sleep))
    body.current.scale.set(1 + breathe, 1 + breathe, 1)

    // A turn starts with the head; the body catches up a moment later.
    m.lean += (clamp(turning * 0.1, -0.22, 0.22) - m.lean) * (1 - Math.exp(-dt * 8))
    body.current.rotation.z = -m.lean * moving

    const lead = clamp(turning * 0.16, -0.5, 0.5)
    const yaw = clamp(wrapAngle(gazeYaw), -1, 1) * gazeWeight
    const wander = sit * (1 - gazeWeight) * Math.sin(t * 0.6) * 0.3
    const targetPitch = sleep > 0.5 ? 0.62 : Math.sin(phase * 2) * 0.05 * moving - gazeWeight * 0.3
    const targetYaw = sleep > 0.5 ? 0.4 : yaw + lead + wander
    const follow = 1 - Math.exp(-dt * 6)
    m.lookPitch += (targetPitch - m.lookPitch) * follow
    m.lookYaw += (targetYaw - m.lookYaw) * follow
    head.current.rotation.x = m.lookPitch + sit * 0.74 * (1 - sleep)
    head.current.rotation.y = m.lookYaw
    head.current.rotation.z = purr * Math.sin(t * 7) * 0.09 + (sit * Math.sin(t * 0.23) * 0.08)

    const twitch = Math.sin(t * 1.3) > 0.985 ? 0.35 : 0
    earL.current.rotation.z = 0.3 + twitch
    earR.current.rotation.z = -0.3 - twitch * 0.4

    const blink = Math.sin(t * 0.9 + Math.sin(t * 0.31) * 4) > 0.985
    const shut = sleep > 0.4 || purr > 0 || blink
    eyeL.current.visible = eyeR.current.visible = !shut
    closedL.current.visible = closedR.current.visible = shut

    tail.current.forEach((segment, i) => {
      if (!segment) return
      const wave = Math.sin(t * (purr ? 9 : lerp(1.1, 3.4, moving)) - i * 0.42)
      // Standing it rises in a happy curve; sitting it wraps round the paws.
      const wrap = sit * (1 - sleep) * 0.36
      segment.rotation.y = wave * lerp(0.11, 0.17, moving) * (1 - sleep) * (1 - sit * 0.6) + wrap
      segment.rotation.x = lerp(lerp(0.27 - i * 0.075, 0.08, run), 0.03, sit) + sleep * 0.05
    })
  })

  return (
    <group scale={SCALE}>
      <group ref={body} position={[0, 0.46, 0]}>
        <mesh geometry={shapes.torso} material={materials.body} scale={[0.95, 0.95, 0.9]} />
        <mesh geometry={shapes.ball} material={materials.cream} position={[0, -0.03, 0.31]} scale={[0.165, 0.19, 0.14]} />
        {[-1, 1].map((side) => (
          <mesh key={side} geometry={shapes.ball} material={materials.plain} position={[0.15 * side, -0.04, -0.27]} scale={[0.1, 0.16, 0.17]} />
        ))}

        {[
          [-0.125, 0.26],
          [0.125, 0.26],
          [-0.15, -0.26],
          [0.15, -0.26],
        ].map(([x, z], i) => (
          <group key={i} position={[x!, -0.13, z!]} ref={(g) => void (legs.current[i] = g)}>
            <mesh geometry={shapes.ball} material={materials.plain} position={[0, -0.11, 0]} scale={[0.07, 0.16, 0.076]} />
            <mesh geometry={shapes.ball} material={materials.cream} position={[0, -0.255, 0.024]} scale={[0.08, 0.052, 0.104]} />
            {[-0.035, 0, 0.035].map((toe) => (
              <mesh key={toe} geometry={shapes.ball} material={materials.pink} position={[toe, -0.27, 0.122]} scale={0.011} />
            ))}
          </group>
        ))}

        <group position={[0, 0.1, -0.4]} rotation={[0.5, 0, 0]}>
          <TailChain shapes={shapes} materials={materials} tail={tail} index={0} />
        </group>

        <group ref={head} position={[0, 0.2, 0.47]}>
          <mesh geometry={shapes.head} material={materials.head} scale={[0.235, 0.235, 0.235]} />
          <mesh material={materials.helmet} position={[0, 0.06, 0.03]} renderOrder={4}>
            <sphereGeometry args={[HELMET_RADIUS, 32, 24]} />
          </mesh>
          <mesh material={materials.gold} position={[0, -0.27, -0.08]} rotation={[Math.PI / 2 - 0.42, 0, 0]}>
            <torusGeometry args={[0.215, 0.034, 10, 36]} />
          </mesh>
          {/* Muzzle */}
          {[-1, 1].map((side) => (
            <mesh key={side} geometry={shapes.ball} material={materials.cream} position={[0.05 * side, -0.094, 0.19]} scale={[0.064, 0.052, 0.052]} />
          ))}
          <mesh geometry={shapes.ball} material={materials.cream} position={[0, -0.138, 0.178]} scale={[0.044, 0.032, 0.036]} />
          <mesh material={materials.pink} position={[0, -0.062, 0.24]} rotation={[0.3, 0, Math.PI]} scale={[0.024, 0.02, 0.012]}>
            <coneGeometry args={[1, 1, 3]} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} material={materials.dark} position={[0.025 * side, -0.112, 0.236]} rotation={[0.25, 0, Math.PI + side * 0.1]} scale={0.024}>
              <torusGeometry args={[1, 0.11, 6, 12, Math.PI]} />
            </mesh>
          ))}

          {[-1, 1].map((side) => (
            <group key={side} position={[0.135 * side, 0.17, -0.02]} ref={side < 0 ? earL : earR} rotation={[-0.12, side * -0.22, 0]}>
              <mesh geometry={shapes.ear} material={materials.plain} scale={[0.165, 0.2, 0.1]} />
              <mesh geometry={shapes.ear} material={materials.pink} position={[0, 0.014, 0.02]} scale={[0.1, 0.14, 0.05]} />
            </group>
          ))}

          {[-1, 1].map((side) => (
            <group key={side} position={[0.108 * side, 0.016, 0.2]} rotation={[-0.04, side * 0.46, 0]}>
              <group ref={side < 0 ? eyeL : eyeR}>
                <mesh geometry={shapes.eye} material={materials.eye} scale={[0.064, 0.074, 0.026]} />
                <mesh geometry={shapes.ball} material={materials.shine} position={[-0.02, 0.03, 0.021]} scale={[0.019, 0.021, 0.004]} />
                <mesh geometry={shapes.ball} material={materials.shine} position={[0.022, -0.026, 0.022]} scale={[0.01, 0.01, 0.003]} />
              </group>
              <mesh ref={side < 0 ? closedL : closedR} material={materials.dark} position={[0, -0.022, 0.026]} scale={0.055} visible={false}>
                <torusGeometry args={[1, 0.12, 6, 14, SMILE_ARC]} />
              </mesh>
              <mesh material={materials.blush} position={[side * 0.052, -0.085, 0.006]} rotation={[0, side * 0.25, 0]} scale={[0.046, 0.026, 1]}>
                <circleGeometry args={[1, 16]} />
              </mesh>
            </group>
          ))}

          {[-1, 1].flatMap((side) =>
            [-0.12, 0.05, 0.2].map((tilt) => (
              <mesh
                key={`${side}${tilt}`}
                material={materials.cream}
                position={[0.17 * side, -0.092 + tilt * 0.14, 0.16]}
                rotation={[0, 0, tilt * side]}
                scale={[0.18, 0.0028, 0.0028]}
              >
                <boxGeometry />
              </mesh>
            )),
          )}
        </group>
      </group>
    </group>
  )
}

const TAIL_SEGMENTS = 11

interface TailProps {
  shapes: { ball: THREE.BufferGeometry }
  materials: { plain: THREE.Material; stripe: THREE.Material; cream: THREE.Material }
  tail: React.RefObject<(THREE.Group | null)[]>
  index: number
}

function TailChain({ shapes, materials, tail, index }: TailProps) {
  const radius = 0.064 - index * 0.0026
  const tip = index === TAIL_SEGMENTS - 1
  const material = tip ? materials.cream : index % 4 === 3 ? materials.stripe : materials.plain
  return (
    <group ref={(g) => void (tail.current[index] = g)}>
      <mesh geometry={shapes.ball} material={material} position={[0, 0, -0.04]} scale={[radius, radius, 0.08]} />
      {!tip && (
        <group position={[0, 0, -0.076]}>
          <TailChain shapes={shapes} materials={materials} tail={tail} index={index + 1} />
        </group>
      )}
    </group>
  )
}

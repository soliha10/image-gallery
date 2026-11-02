import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { angleAt, BENCH_RADIUS, SLOTS, WALL_RADIUS } from './walker'

const BOOK_COLORS = ['#7b2d26', '#274c4f', '#a9742c', '#3c2f5c', '#8a5a33', '#2f4a30', '#b08a4e', '#5f2130', '#d8c49c', '#21344f']

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

const polar = (angle: number, radius: number, y: number) =>
  new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius)

function floorTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const c = canvas.getContext('2d')!
  const random = seeded(7)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const l = 24 + random() * 9
      c.fillStyle = `hsl(${24 + random() * 6} 42% ${l}%)`
      c.fillRect(x * 64, y * 64, 64, 64)
      c.strokeStyle = 'rgba(0,0,0,.22)'
      c.lineWidth = 2
      for (let i = 0; i < 4; i++) {
        const along = i * 16
        c.beginPath()
        if ((x + y) % 2) {
          c.moveTo(x * 64, y * 64 + along)
          c.lineTo(x * 64 + 64, y * 64 + along)
        } else {
          c.moveTo(x * 64 + along, y * 64)
          c.lineTo(x * 64 + along, y * 64 + 64)
        }
        c.stroke()
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(5, 5)
  texture.anisotropy = 4
  return texture
}

function rugTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const c = canvas.getContext('2d')!
  c.translate(size / 2, size / 2)
  const ring = (radius: number, color: string) => {
    c.fillStyle = color
    c.beginPath()
    c.arc(0, 0, radius, 0, Math.PI * 2)
    c.fill()
  }
  ring(510, '#d8ac62')
  ring(496, '#6f2424')
  ring(452, '#d8ac62')
  ring(444, '#28324f')
  ring(300, '#d8ac62')
  ring(292, '#6f2424')
  c.fillStyle = '#d8ac62'
  for (let i = 0; i < 28; i++) {
    c.save()
    c.rotate((i / 28) * Math.PI * 2)
    c.beginPath()
    c.moveTo(0, -432)
    c.lineTo(26, -372)
    c.lineTo(0, -312)
    c.lineTo(-26, -372)
    c.fill()
    c.restore()
  }
  for (let i = 0; i < 40; i++) {
    c.save()
    c.rotate((i / 40) * Math.PI * 2)
    c.beginPath()
    c.arc(0, -474, 8, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Round museum seat in the middle of the room, with a lamp the walls can be read by. */
function Bench({ wood }: { wood: string }) {
  const tufts = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2), [])
  return (
    <group>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[BENCH_RADIUS - 0.12, BENCH_RADIUS - 0.06, 0.2, 40]} />
        <meshLambertMaterial color={wood} />
      </mesh>
      <mesh position={[0, 0.34, 0]} scale={[1, 0.17, 1]}>
        <sphereGeometry args={[BENCH_RADIUS, 40, 16]} />
        <meshLambertMaterial color="#6b2c33" />
      </mesh>
      <mesh position={[0, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[BENCH_RADIUS - 0.03, 0.035, 8, 56]} />
        <meshLambertMaterial color="#c79a4b" />
      </mesh>
      {tufts.map((angle) => (
        <mesh key={angle} position={[Math.sin(angle) * 1.02, 0.47, Math.cos(angle) * 1.02]} scale={[0.05, 0.02, 0.05]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshLambertMaterial color="#c79a4b" />
        </mesh>
      ))}
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 1.5, 12]} />
        <meshLambertMaterial color="#b48a3e" />
      </mesh>
      <mesh position={[0, 2.05, 0]}>
        <sphereGeometry args={[0.3, 20, 16]} />
        <meshBasicMaterial color="#ffe0ae" />
      </mesh>
    </group>
  )
}

/** All books share one instanced draw call. */
function Books({ placements }: { placements: { matrix: THREE.Matrix4; color: THREE.Color }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    placements.forEach(({ matrix, color }, i) => {
      ref.current.setMatrixAt(i, matrix)
      ref.current.setColorAt(i, color)
    })
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [placements])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, placements.length]} frustumCulled={false}>
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  )
}

function shelfBooks(angle: number, radius: number, baseY: number, rows: number, width: number, random: () => number) {
  const books: { matrix: THREE.Matrix4; color: THREE.Color }[] = []
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
  const tangent = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle))
  for (let row = 0; row < rows; row++) {
    let along = -width / 2
    while (along < width / 2 - 0.09) {
      const thickness = 0.05 + random() * 0.05
      const height = 0.3 + random() * 0.14
      if (random() > 0.1) {
        const position = polar(angle, radius, baseY + row * 0.52 + height / 2).addScaledVector(tangent, along + thickness / 2)
        const tilt = random() > 0.92 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.14) : new THREE.Quaternion()
        books.push({
          matrix: new THREE.Matrix4().compose(
            position,
            rotation.clone().multiply(tilt),
            new THREE.Vector3(thickness, height, 0.22),
          ),
          color: new THREE.Color(BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]!),
        })
      }
      along += thickness + 0.006
    }
  }
  return books
}

export function Room({ night }: { night: boolean }) {
  const { floor, rug, books, shelves, sconces } = useMemo(() => {
    const random = seeded(42)
    const books: { matrix: THREE.Matrix4; color: THREE.Color }[] = []
    const shelves: { angle: number; radius: number; y: number; width: number; height: number }[] = []
    const sconces: { angle: number }[] = []
    for (let slot = 0; slot < SLOTS; slot++) {
      const between = angleAt(slot + 0.5)
      books.push(...shelfBooks(between, WALL_RADIUS - 0.2, 0.2, 6, 0.58, random))
      shelves.push({ angle: between, radius: WALL_RADIUS - 0.12, y: 1.65, width: 0.66, height: 3.3 })
      sconces.push({ angle: angleAt(slot) })
      for (const offset of [0, 0.5]) {
        const upper = angleAt(slot + offset)
        books.push(...shelfBooks(upper, WALL_RADIUS - 0.2, 4.05, 3, 1.05, random))
      }
    }
    return { floor: floorTexture(), rug: rugTexture(), books, shelves, sconces }
  }, [])

  useLayoutEffect(
    () => () => {
      floor.dispose()
      rug.dispose()
    },
    [floor, rug],
  )

  const wood = night ? '#4a2a18' : '#6b4128'
  const wall = night ? '#3a2019' : '#7d5238'

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[WALL_RADIUS, 72]} />
        <meshLambertMaterial map={floor} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <circleGeometry args={[5.4, 72]} />
        <meshLambertMaterial map={rug} />
      </mesh>
      <Bench wood={wood} />
      <mesh position={[0, 3.5, 0]}>
        <cylinderGeometry args={[WALL_RADIUS, WALL_RADIUS, 7, 72, 1, true]} />
        <meshLambertMaterial color={wall} side={THREE.BackSide} />
      </mesh>
      {/* Wainscot, gallery ledge and upper shelf boards. */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[WALL_RADIUS - 0.04, WALL_RADIUS - 0.04, 0.36, 72, 1, true]} />
        <meshLambertMaterial color={wood} side={THREE.BackSide} />
      </mesh>
      {[3.72, 4.0, 4.52, 5.04, 5.56].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[WALL_RADIUS - (i === 0 ? 0.28 : 0.14), i === 0 ? 0.14 : 0.035, 6, 72]} />
          <meshLambertMaterial color={wood} />
        </mesh>
      ))}
      <mesh position={[0, 7, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[WALL_RADIUS, 48]} />
        <meshBasicMaterial color={night ? '#150c08' : '#3d2a1e'} />
      </mesh>

      {shelves.map(({ angle, radius, y, width, height }, i) => {
        const p = polar(angle, radius, y)
        return (
          <group key={i} position={p} rotation={[0, angle, 0]}>
            <mesh position={[0, 0, -0.02]} scale={[width + 0.1, height, 0.05]}>
              <boxGeometry />
              <meshLambertMaterial color={night ? '#1d0f0a' : '#2f1b12'} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[(width / 2 + 0.03) * side, 0, -0.14]} scale={[0.06, height, 0.3]}>
                <boxGeometry />
                <meshLambertMaterial color={wood} />
              </mesh>
            ))}
            {Array.from({ length: 7 }, (_, row) => (
              <mesh key={row} position={[0, row * 0.52 - height / 2 + 0.1 + 0.04, -0.14]} scale={[width, 0.04, 0.3]}>
                <boxGeometry />
                <meshLambertMaterial color={wood} />
              </mesh>
            ))}
          </group>
        )
      })}

      {sconces.map(({ angle }, i) => (
        <group key={i} position={polar(angle, WALL_RADIUS - 0.16, 3.4)} rotation={[0, angle, 0]}>
          <mesh position={[0, 0, 0]} scale={[0.46, 0.05, 0.05]}>
            <cylinderGeometry args={[1, 1, 1, 8]} />
            <meshBasicMaterial color="#ffd28a" />
          </mesh>
        </group>
      ))}

      <Books placements={books} />
    </>
  )
}

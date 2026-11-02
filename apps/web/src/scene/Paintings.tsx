import { photoUrl, type Photo } from '@gallery/shared'
import { useFrame, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { angleAt, indexForSlot, mod, SLOTS, WALL_RADIUS, type Walker } from './walker'

const MAX_WIDTH = 1.42
const MAX_HEIGHT = 1.95
const FRAME = 0.045
const HALO_MARGIN = 1.1
const DRIFT = 0.05
const STARS_PER_SLOT = 5
const HALO_TINTS = ['#8f7cff', '#5fa0ff', '#f5c98a', '#c77ce0']
export const PAINTING_Y = 1.85
const FRAME_RADIUS = WALL_RADIUS - 0.16
/** A little larger than a frame, so one at the edge of the screen counts as seen. */
const VIEW_MARGIN = 1.6
const SHARP_RANGE = 2.5
const AHEAD_RANGE = 5
const CACHE_SIZE = SLOTS + 10
const PLAQUE_RANGE = 5.2
const PLAQUE_WIDTH = 0.6
const PLAQUE_HEIGHT = 0.14

class TextureCache {
  private readonly entries = new Map<string, { texture: THREE.Texture | null; used: number }>()
  private readonly loader = new THREE.TextureLoader().setCrossOrigin('anonymous')
  private clock = 0

  get(url: string, anisotropy: number) {
    const entry = this.entries.get(url)
    if (entry) {
      entry.used = ++this.clock
      return entry.texture
    }
    const created = { texture: null as THREE.Texture | null, used: ++this.clock }
    this.entries.set(url, created)
    this.loader.load(
      url,
      (texture) => {
        if (!this.entries.has(url)) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = anisotropy
        created.texture = texture
      },
      undefined,
      () => this.entries.delete(url),
    )
    this.evict()
    return null
  }

  private evict() {
    while (this.entries.size > CACHE_SIZE) {
      const [oldest] = [...this.entries].sort(([, a], [, b]) => a.used - b.used)
      if (!oldest) return
      oldest[1].texture?.dispose()
      this.entries.delete(oldest[0])
    }
  }

  dispose() {
    this.entries.forEach(({ texture }) => texture?.dispose())
    this.entries.clear()
  }
}

function haloTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const c = canvas.getContext('2d')!
  const light = c.createRadialGradient(64, 64, 18, 64, 64, 64)
  light.addColorStop(0, 'rgba(255, 255, 255, .6)')
  light.addColorStop(0.6, 'rgba(255, 255, 255, .2)')
  light.addColorStop(1, 'rgba(255, 255, 255, 0)')
  c.fillStyle = light
  c.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Small star figure for an empty frame: its stars and the lines between them share one buffer. */
function constellationBuffer() {
  let seed = 271
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return Array.from({ length: SLOTS }, () => {
    const points = Array.from({ length: STARS_PER_SLOT }, (_, i) => [(i / (STARS_PER_SLOT - 1) - 0.5) * 1.5 + random() * 0.2, (random() - 0.5) * 1.5] as const)
    return points.slice(1).flatMap((point, i) => [points[i]!, point])
  })
}

function clip(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

function drawPlaque(canvas: HTMLCanvasElement, photo: Photo) {
  const c = canvas.getContext('2d')!
  const { width, height } = canvas
  c.clearRect(0, 0, width, height)
  c.fillStyle = 'rgba(16, 18, 48, .92)'
  c.fillRect(0, 0, width, height)
  c.strokeStyle = 'rgba(244, 201, 93, .7)'
  c.lineWidth = 3
  c.strokeRect(3, 3, width - 6, height - 6)
  c.fillStyle = '#eef0ff'
  c.textAlign = 'center'
  c.font = '600 42px Fraunces, Georgia, serif'
  c.fillText(clip(c, photo.title, width - 56), width / 2, 60)
  c.fillStyle = '#f4c95d'
  c.font = '500 27px Manrope, system-ui, sans-serif'
  c.fillText(clip(c, photo.credit ?? photo.description, width - 56), width / 2, 104)
}

interface Slot {
  group: THREE.Group
  canvas: THREE.Mesh
  frame: THREE.Mesh
  material: THREE.MeshBasicMaterial
  photoId: string | null
  index: number | null
  width: number
  height: number
}

export interface PaintingsHandle {
  hit(raycaster: THREE.Raycaster): number | null
  /** Walk index on a frame, or null for an empty frame. */
  indexOf(slot: number): number | null
  corners(slot: number): THREE.Vector3[]
  sync(): void
}

interface Props {
  walker: Walker
  photos: Photo[]
  textureWidth: 400 | 800
  drift: boolean
}

const placement = new THREE.Object3D()

export const Paintings = forwardRef<PaintingsHandle, Props>(function Paintings({ walker, photos, textureWidth, drift }, ref) {
  const camera = useThree((s) => s.camera)
  const blank = useMemo(() => new THREE.DataTexture(new Uint8Array([46, 32, 24, 255]), 1, 1), [])
  const cache = useMemo(() => new TextureCache(), [])
  const slots = useRef<Slot[]>([])
  const photosRef = useRef(photos)
  const shownList = useRef<Photo[]>([])
  const glows = useRef<THREE.InstancedMesh>(null!)
  const plaques = useRef<THREE.InstancedMesh>(null!)
  const label = useRef<THREE.Mesh>(null!)
  const labelFor = useRef<string | null>(null)
  photosRef.current = photos

  const parts = useMemo(
    () => ({
      plane: new THREE.PlaneGeometry(1, 1),
      box: new THREE.BoxGeometry(1, 1, 1),
      frame: new THREE.MeshBasicMaterial({ color: '#f6dfa8', toneMapped: false }),
      glass: new THREE.MeshBasicMaterial({ color: '#191c4c', transparent: true, opacity: 0.8, toneMapped: false }),
      haloMap: haloTexture(),
      figures: constellationBuffer(),
      sky: new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(SLOTS * (STARS_PER_SLOT - 1) * 2 * 3).fill(-999), 3)),
      frustum: new THREE.Frustum(),
      viewProjection: new THREE.Matrix4(),
      sphere: new THREE.Sphere(new THREE.Vector3(), VIEW_MARGIN),
    }),
    [],
  )

  const plaqueText = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 140
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
    return { canvas, map, material: new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, toneMapped: false }) }
  }, [])

  const slotProps = useMemo(
    () =>
      Array.from({ length: SLOTS }, (_, slot) => {
        const angle = angleAt(slot)
        return {
          slot,
          angle,
          position: [Math.sin(angle) * FRAME_RADIUS, PAINTING_Y, Math.cos(angle) * FRAME_RADIUS] as const,
          material: new THREE.MeshBasicMaterial({ map: blank, toneMapped: false }),
        }
      }),
    [blank],
  )

  useEffect(
    () => () => {
      cache.dispose()
      blank.dispose()
      parts.plane.dispose()
      parts.box.dispose()
      parts.frame.dispose()
      parts.glass.dispose()
      parts.haloMap.dispose()
      parts.sky.dispose()
      plaqueText.map.dispose()
      plaqueText.material.dispose()
      slotProps.forEach(({ material }) => material.dispose())
    },
    [blank, cache, parts, plaqueText, slotProps],
  )

  // Unused instances collapse to nothing until a frame claims them.
  useEffect(() => {
    const none = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let s = 0; s < SLOTS; s++) {
      glows.current.setMatrixAt(s, none)
      plaques.current.setMatrixAt(s, none)
      glows.current.setColorAt(s, new THREE.Color(HALO_TINTS[s % HALO_TINTS.length]))
    }
  }, [])

  useImperativeHandle(ref, () => ({
    hit(raycaster) {
      const visible = slots.current.filter((s) => s.group.visible)
      const [hit] = raycaster.intersectObjects(visible.flatMap((s) => [s.canvas, s.frame]))
      if (!hit) return null
      return slots.current.findIndex((s) => s.canvas === hit.object || s.frame === hit.object)
    },
    indexOf: (slot) => slots.current[mod(slot, SLOTS)]?.index ?? null,
    corners(slot) {
      const entry = slots.current[mod(slot, SLOTS)]
      if (!entry) return []
      entry.group.updateWorldMatrix(true, false)
      return [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([x, y]) =>
        new THREE.Vector3((x! * entry.width) / 2, (y! * entry.height) / 2, 0.06).applyMatrix4(entry.group.matrixWorld),
      )
    },
    sync: () => update(0, true),
  }))

  const placeExtras = (s: number, slot: Slot) => {
    const angle = angleAt(s)
    const hidden = !slot.group.visible
    const y = slot.group.position.y
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    placement.rotation.set(0, angle + Math.PI, 0)

    placement.position.set(sin * (FRAME_RADIUS + 0.08), y, cos * (FRAME_RADIUS + 0.08))
    placement.scale.set(hidden ? 0 : slot.width + HALO_MARGIN * 2, hidden ? 0 : slot.height + HALO_MARGIN * 2, 1)
    placement.updateMatrix()
    glows.current.setMatrixAt(s, placement.matrix)

    placement.position.set(sin * (FRAME_RADIUS - 0.04), y - slot.height / 2 - FRAME - 0.13, cos * (FRAME_RADIUS - 0.04))
    placement.scale.set(hidden ? 0 : PLAQUE_WIDTH + 0.04, hidden ? 0 : PLAQUE_HEIGHT + 0.04, 0.02)
    placement.updateMatrix()
    plaques.current.setMatrixAt(s, placement.matrix)
  }

  /** Empty frames become a small constellation; used ones park their stars out of sight. */
  const placeFigure = (s: number, hidden: boolean) => {
    const angle = angleAt(s)
    const buffer = parts.sky.getAttribute('position') as THREE.BufferAttribute
    parts.figures[s]!.forEach(([along, up], i) => {
      const index = s * (STARS_PER_SLOT - 1) * 2 + i
      if (hidden) {
        const x = Math.sin(angle) * FRAME_RADIUS + Math.cos(angle) * along
        const z = Math.cos(angle) * FRAME_RADIUS - Math.sin(angle) * along
        buffer.setXYZ(index, x, PAINTING_Y + up, z)
      } else {
        buffer.setXYZ(index, 0, -999, 0)
      }
    })
    buffer.needsUpdate = true
  }

  const update = (delta: number, force = false) => {
    const list = photosRef.current
    const shown = shownList.current
    // Appending a page keeps the frames as they are; a new filter replaces everything at once.
    const replaced = force || list[0]?.id !== shown[0]?.id || list.length < shown.length
    shownList.current = list

    camera.updateMatrixWorld()
    parts.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    parts.frustum.setFromProjectionMatrix(parts.viewProjection)

    let extrasMoved = drift
    const time = performance.now() / 1000
    slots.current.forEach((slot, s) => {
      if (!slot) return
      if (drift) {
        slot.group.position.y = PAINTING_Y + Math.sin(time * 0.5 + s * 1.7) * DRIFT
        if (slot.group.visible) placeExtras(s, slot)
      }
      const wanted = indexForSlot(walker.pos, s, list.length)
      const photo = wanted === null ? null : list[mod(wanted, list.length)]!
      const changed = wanted !== slot.index || (photo?.id ?? null) !== slot.photoId
      parts.sphere.center.copy(slot.group.position)
      if (changed && (replaced || slot.photoId === null || !parts.frustum.intersectsSphere(parts.sphere))) {
        slot.index = wanted
        slot.group.visible = photo !== null
        slot.photoId = photo?.id ?? null
        placeFigure(s, photo === null)
        if (photo) {
          const aspect = photo.width / photo.height
          slot.width = Math.min(MAX_WIDTH, MAX_HEIGHT * aspect)
          slot.height = slot.width / aspect
          slot.canvas.scale.set(slot.width, slot.height, 1)
          slot.frame.scale.set(slot.width + FRAME * 2, slot.height + FRAME * 2, 0.06)
          slot.material.map = blank
          slot.material.color.setScalar(1)
        }
        placeExtras(s, slot)
        extrasMoved = true
      }
      if (slot.index === null) return

      const current = list[mod(slot.index, list.length)]
      if (!current) return
      const along = mod(s - walker.pos + SLOTS / 2, SLOTS) - SLOTS / 2
      const ahead = along * walker.drift > 0 && Math.abs(along) <= AHEAD_RANGE
      const sharp = textureWidth === 800 && (Math.abs(along) <= SHARP_RANGE || ahead)
      const small = cache.get(photoUrl(current, 400), 4)
      const large = sharp ? cache.get(photoUrl(current, 800), 4) : null
      const texture = large ?? small
      if (texture && slot.material.map !== texture) {
        // Only a new picture fades in; the upgrade to a sharper copy is seamless.
        if (slot.material.map === blank) slot.material.color.setScalar(0.25)
        slot.material.map = texture
      }
      // Pictures near the cat are lit; the others rest in starlight.
      const lit = slot.material.map === blank ? 1 : 1 - Math.min(Math.abs(along) / 4, 1) * 0.22
      const value = slot.material.color.r + (lit - slot.material.color.r) * (1 - Math.exp(-delta * 6))
      slot.material.color.setScalar(value)
    })

    if (extrasMoved) {
      glows.current.instanceMatrix.needsUpdate = true
      if (glows.current.instanceColor) glows.current.instanceColor.needsUpdate = true
      plaques.current.instanceMatrix.needsUpdate = true
    }

    const nearest = walker.nearestSlot
    const slot = slots.current[nearest]
    const photo = slot?.index != null ? list[mod(slot.index, list.length)] : undefined
    const close = !!photo && !!(photo.title || photo.credit) && walker.radius > PLAQUE_RANGE
    if (close && labelFor.current !== photo.id && plaqueText.material.opacity < 0.02) {
      labelFor.current = photo.id
      drawPlaque(plaqueText.canvas, photo)
      plaqueText.map.needsUpdate = true
      const angle = angleAt(nearest)
      label.current.position.set(Math.sin(angle) * (FRAME_RADIUS - 0.06), PAINTING_Y - slot!.height / 2 - FRAME - 0.17, Math.cos(angle) * (FRAME_RADIUS - 0.06))
      label.current.rotation.set(0, angle + Math.PI, 0)
    }
    const showLabel = close && labelFor.current === photo!.id
    plaqueText.material.opacity += ((showLabel ? 1 : 0) - plaqueText.material.opacity) * (1 - Math.exp(-delta * 8))
    label.current.visible = plaqueText.material.opacity > 0.01
    if (slot && labelFor.current === photo?.id) label.current.position.y = slot.group.position.y - slot.height / 2 - FRAME - 0.13
  }

  useFrame((_, delta) => update(delta))

  return (
    <>
      <instancedMesh ref={glows} args={[parts.plane, undefined, SLOTS]} frustumCulled={false} renderOrder={1}>
        <meshBasicMaterial map={parts.haloMap} opacity={0.5} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={plaques} args={[parts.box, parts.glass, SLOTS]} frustumCulled={false} />
      <lineSegments geometry={parts.sky} frustumCulled={false}>
        <lineBasicMaterial color="#8fa6ff" transparent opacity={0.4} depthWrite={false} />
      </lineSegments>
      <points geometry={parts.sky} frustumCulled={false}>
        <pointsMaterial color="#f4e8c8" size={0.07} transparent opacity={0.95} depthWrite={false} />
      </points>
      <mesh ref={label} geometry={parts.plane} material={plaqueText.material} scale={[PLAQUE_WIDTH, PLAQUE_HEIGHT, 1]} visible={false} renderOrder={2} />
      {slotProps.map(({ slot, angle, position, material }) => (
        <group
          key={slot}
          position={position}
          rotation={[0, angle + Math.PI, 0]}
          ref={(group) => {
            if (group && !slots.current[slot]) {
              group.visible = false
              slots.current[slot] = {
                group,
                canvas: group.children[1] as THREE.Mesh,
                frame: group.children[0] as THREE.Mesh,
                material,
                photoId: null,
                index: null,
                width: 1,
                height: 1,
              }
            }
          }}
        >
          <mesh geometry={parts.box} material={parts.frame} />
          <mesh geometry={parts.plane} material={material} position={[0, 0, 0.036]} />
        </group>
      ))}
    </>
  )
})

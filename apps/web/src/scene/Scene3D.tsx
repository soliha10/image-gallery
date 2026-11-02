import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { t } from '../lib/i18n'
import { haptic } from '../lib/telegram'
import { useStore, type Rect } from '../lib/store'
import { sceneBridge } from './bridge'
import { Cat } from './Cat'
import { Controls, type StickView } from './controls'
import { FrameBudget } from './frameBudget'
import { Paintings, type PaintingsHandle } from './Paintings'
import { device, lowerQuality, nextQuality, pixelRatioFor, savedQuality, saveQuality, startingQuality, type Quality } from './quality'
import { Room } from './Room'
import { angleAt, clamp, mod, resolve, SLOTS, slotOfIndex, Walker, WALL_RADIUS, wrapAngle } from './walker'

const CAMERA_LIMIT = WALL_RADIUS - 0.7
const VIEW_CAMERA_RADIUS = 4.5
const VIEW_LOOK_Y = 1.32
const VIEW_CAMERA_Y = 1.75
const PITCH_MIN = 0.1
const PITCH_MAX = 0.75
const GUIDE_KEY = 'scene-guide-seen'
const DPR_STEPS = [600, 1400, 2400]

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const QUALITY_LABELS: Record<Quality, string> = { low: t.qualityLow, medium: t.qualityMedium, high: t.qualityHigh }

function guideSeen() {
  try {
    return localStorage.getItem(GUIDE_KEY) !== null
  } catch {
    return true
  }
}

function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_KEY, '1')
  } catch {
    // Without storage the guide simply shows again next visit.
  }
}

function Dust() {
  const geometry = useMemo(() => {
    const points = new Float32Array(90 * 3)
    for (let i = 0; i < points.length; i += 3) {
      points[i] = (Math.random() - 0.5) * 6
      points[i + 1] = Math.random() * 4
      points[i + 2] = Math.random() * 5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(points, 3))
    return g
  }, [])
  const ref = useRef<THREE.Points>(null!)
  useFrame(({ camera, clock }) => {
    ref.current.position.copy(camera.position)
    ref.current.position.y = Math.sin(clock.elapsedTime * 0.1) * 0.25
    ref.current.quaternion.copy(camera.quaternion)
    ref.current.rotateY(Math.PI)
  })
  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <pointsMaterial color="#ffd9a0" size={0.018} transparent opacity={0.3} depthWrite={false} />
    </points>
  )
}

interface DirectorProps {
  walker: Walker
  controls: Controls
  paintings: React.RefObject<PaintingsHandle | null>
  cat: React.RefObject<THREE.Group | null>
  shadow: React.RefObject<THREE.Mesh | null>
  light: React.RefObject<THREE.PointLight | null>
  pendingOpen: React.RefObject<number | null>
  onOpen: (slot: number, rect: Rect | null) => void
  onResume: () => void
  onSlow: () => void
  onUnusable: () => void
  onTouring: (touring: boolean) => void
  autopilot: boolean
}

/** Moves the cat, camera and key light; all per-frame work bypasses React. */
function Director({ walker, controls, paintings, cat, shadow, light, pendingOpen, onOpen, onResume, onSlow, onUnusable, onTouring, autopilot }: DirectorProps) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const start = { orbit: Math.PI, pitch: 0.3, view: 1, slot: 0, focusX: walker.x, focusZ: walker.z, followAfter: 0, distance: 3.2 }
  const state = useRef(start)
  const setCurrentIndex = useStore((s) => s.setCurrentIndex)
  const photos = useStore((s) => s.photos)
  const lastIndex = useRef<number | null>(null)
  const touring = useRef(false)
  const budget = useMemo(() => new FrameBudget(), [])
  const look = useMemo(() => ({ orbit: new THREE.Vector3(), target: new THREE.Vector3(), view: new THREE.Vector3(), viewTarget: new THREE.Vector3() }), [])

  useEffect(() => {
    lastIndex.current = null
    const count = photos.length
    const taken = new Set(Array.from({ length: Math.min(count, SLOTS) }, (_, i) => slotOfIndex(i, count)))
    walker.filled = (slot) => taken.has(mod(slot, SLOTS))
  }, [photos, walker])

  const placeCamera = (time: number) => {
    const s = state.current
    const eased = s.view * s.view * (3 - 2 * s.view)
    const flat = Math.cos(s.pitch) * s.distance
    look.orbit.set(s.focusX + Math.sin(s.orbit) * flat, 0.55 + Math.sin(s.pitch) * s.distance, s.focusZ + Math.cos(s.orbit) * flat)
    const reach = Math.hypot(look.orbit.x, look.orbit.z)
    if (reach > CAMERA_LIMIT) look.orbit.multiplyScalar(CAMERA_LIMIT / reach).setY(look.orbit.y)
    look.target.set(s.focusX, 0.7, s.focusZ)

    const angle = angleAt(s.slot)
    const drift = reducedMotion ? 0 : Math.sin(time * 0.25) * 0.015
    look.view.set(Math.sin(angle + drift) * VIEW_CAMERA_RADIUS, VIEW_CAMERA_Y, Math.cos(angle + drift) * VIEW_CAMERA_RADIUS)
    look.viewTarget.set(Math.sin(angle) * WALL_RADIUS, VIEW_LOOK_Y, Math.cos(angle) * WALL_RADIUS)

    camera.position.lerpVectors(look.orbit, look.view, eased)
    camera.lookAt(look.target.lerp(look.viewTarget, eased))
    camera.updateMatrixWorld()
  }

  const rectFor = (slot: number): Rect | null => {
    const corners = paintings.current?.corners(slot)
    if (!corners?.length) return null
    const points = corners.map((c) => c.clone().project(camera))
    const xs = points.map((p) => ((p.x + 1) / 2) * size.width)
    const ys = points.map((p) => ((1 - p.y) / 2) * size.height)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
  }

  useEffect(() => {
    sceneBridge.rectFor = (index) => {
      // Closing can follow a swipe to another photo, so the scene wakes on that painting.
      const total = useStore.getState().photos.length
      const pos = total >= SLOTS ? Math.round((walker.pos - index) / total) * total + index : walker.pos + wrapSlots(slotOfIndex(index, total) - walker.pos)
      walker.jumpTo(pos)
      onResume()
      const s = state.current
      s.slot = walker.viewing ?? 0
      s.orbit = angleAt(s.slot) + Math.PI
      s.focusX = walker.x
      s.focusZ = walker.z
      s.view = 1
      placeCamera(0)
      paintings.current?.sync()
      return rectFor(s.slot)
    }
    return () => {
      sceneBridge.rectFor = null
    }
  })

  useEffect(() => {
    const portrait = size.width / size.height < 0.75
    camera.fov = portrait ? 46 : 40
    camera.updateProjectionMatrix()
    state.current.distance = portrait ? 3.5 : 3.1
  }, [camera, size])

  useEffect(() => {
    const typing = (event: KeyboardEvent) => {
      const { lightbox, sheet } = useStore.getState()
      const tag = (event.target as HTMLElement | null)?.tagName
      return lightbox !== null || sheet !== null || tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey
    }
    const down = (event: KeyboardEvent) => {
      if (!typing(event) && controls.key(event.code, true)) event.preventDefault()
    }
    const up = (event: KeyboardEvent) => void controls.key(event.code, false)
    const blur = () => controls.releaseKeys()
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
      removeEventListener('blur', blur)
    }
  }, [controls])

  useFrame(({ clock }, rawDelta) => {
    const verdict = budget.sample(rawDelta)
    if (verdict === 'slow') onSlow()
    if (verdict === 'unusable') onUnusable()

    const dt = Math.min(rawDelta, 0.05)
    const s = state.current
    const time = clock.elapsedTime

    if (controls.lookX !== 0 || controls.lookY !== 0) {
      if (walker.viewing !== null) walker.stopViewing()
      if (pendingOpen.current === null) {
        s.orbit -= controls.lookX
        s.pitch = clamp(s.pitch + controls.lookY, PITCH_MIN, PITCH_MAX)
        s.followAfter = time + 2.5
      }
      controls.lookX = controls.lookY = 0
    }

    // Input is relative to the camera, so "up" always walks away from the viewer.
    const inputX = controls.stickX + controls.keyX * (controls.run ? 1 : 0.75)
    const inputY = controls.stickY + controls.keyY * (controls.run ? 1 : 0.75)
    walker.inputX = inputX * Math.cos(s.orbit) - inputY * Math.sin(s.orbit)
    walker.inputZ = -inputX * Math.sin(s.orbit) - inputY * Math.cos(s.orbit)
    if (inputX !== 0 || inputY !== 0) pendingOpen.current = null

    walker.update(dt, autopilot && !reducedMotion && pendingOpen.current === null)
    if (walker.touring !== touring.current) {
      touring.current = walker.touring
      onTouring(walker.touring)
    }

    const follow = 1 - Math.exp(-dt * 5)
    s.focusX += (walker.x + walker.vx * 0.35 - s.focusX) * follow
    s.focusZ += (walker.z + walker.vz * 0.35 - s.focusZ) * follow

    if (walker.moving && time > s.followAfter) {
      // The camera eases behind the cat, but never swings round when it walks towards the viewer.
      const behind = wrapAngle(walker.heading + Math.PI - s.orbit)
      if (Math.abs(behind) < 2.2) s.orbit += behind * (1 - Math.exp(-dt * 0.9))
    }

    const opening = pendingOpen.current !== null && walker.arrived
    const lightboxOpen = useStore.getState().lightbox !== null
    if (walker.viewing !== null) s.slot = walker.viewing
    const framed = opening || lightboxOpen || walker.viewing !== null
    if (framed) s.orbit += wrapAngle(angleAt(s.slot) + Math.PI - s.orbit) * (1 - Math.exp(-dt * 3))
    s.view = clamp(s.view + ((framed ? 1 : -1) * dt) / (opening ? 0.42 : 1.1), 0, 1)
    placeCamera(time)

    if (cat.current && shadow.current) {
      cat.current.position.set(walker.x, 0, walker.z)
      cat.current.rotation.y = walker.heading
      shadow.current.position.set(walker.x, 0.015, walker.z)
    }
    if (light.current) {
      light.current.position.set(walker.x * 0.9, 3.2, walker.z * 0.9)
    }

    if (photos.length > 0) {
      const walkIndex = paintings.current?.indexOf(walker.nearestSlot)
      const index = walkIndex == null ? null : mod(walkIndex, photos.length)
      if (index !== null && index !== lastIndex.current) {
        if (lastIndex.current !== null && walker.moving) haptic.select()
        lastIndex.current = index
        setCurrentIndex(index)
      }
    }

    if (opening && s.view >= 1) {
      const slot = pendingOpen.current!
      pendingOpen.current = null
      onOpen(slot, rectFor(slot))
    }
  })

  return null
}

const wrapSlots = (delta: number) => mod(delta + SLOTS / 2, SLOTS) - SLOTS / 2

/** Bottom-left joystick that appears under the thumb; a faint ring shows where it lives. */
function Stick({ controls }: { controls: Controls }) {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const coarse = useMemo(() => matchMedia('(pointer: coarse)').matches, [])

  useEffect(() => {
    const view: StickView = {
      show(x, y) {
        if (!base.current) return
        base.current.style.opacity = '1'
        base.current.style.transform = `translate(${x - 56}px, ${y - 56}px)`
        if (ghost.current) ghost.current.style.opacity = '0'
      },
      move(dx, dy) {
        if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`
      },
      hide() {
        if (base.current) base.current.style.opacity = '0'
        if (knob.current) knob.current.style.transform = ''
        if (ghost.current) ghost.current.style.opacity = '1'
      },
    }
    controls.stickView = view
    return () => {
      controls.stickView = null
    }
  }, [controls])

  return (
    <>
      {coarse && (
        <div
          ref={ghost}
          className="pointer-events-none absolute left-7 bottom-[calc(var(--safe-bottom)+150px)] flex size-20 items-center justify-center rounded-full border border-paper/25 transition-opacity"
          aria-hidden
        >
          <span className="size-8 rounded-full bg-paper/20" />
        </div>
      )}
      <div
        ref={base}
        className="pointer-events-none absolute top-0 left-0 z-[6] flex size-28 items-center justify-center rounded-full border-2 border-paper/40 bg-black/20 opacity-0"
        aria-hidden
      >
        <div ref={knob} className="size-12 rounded-full bg-paper/80 shadow-lg" />
      </div>
    </>
  )
}

function Guide({ onClose }: { onClose: () => void }) {
  const lines = matchMedia('(pointer: coarse)').matches ? [t.guideMove, t.guideLook, t.guideTap] : [t.guideKeys, t.guideTap]
  return (
    <div className="rise absolute inset-x-6 top-[calc(var(--safe-top)+150px)] z-20 mx-auto max-w-80 rounded-2xl bg-walnut/90 p-5 text-paper shadow-xl backdrop-blur-md">
      <h2 className="font-display text-xl font-semibold">{t.guideTitle}</h2>
      <ul className="mt-2 space-y-1.5 text-sm leading-snug text-paper/80">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button onClick={onClose} className="mt-4 min-h-11 w-full rounded-xl bg-amber text-sm font-bold text-walnut">
        {t.guideOk}
      </button>
    </div>
  )
}

function SceneButton({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full px-3.5 text-[13px] font-semibold backdrop-blur-sm transition-colors ${active ? 'bg-amber text-walnut' : 'bg-black/35 text-paper'}`}
    >
      {label}
    </button>
  )
}

export default function Scene3D() {
  const walker = useMemo(() => new Walker(), [])
  const controls = useMemo(() => new Controls(), [])
  const paintings = useRef<PaintingsHandle>(null)
  const cat = useRef<THREE.Group>(null)
  const catHit = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const pendingOpen = useRef<number | null>(null)
  const three = useRef<{ camera: THREE.Camera } | null>(null)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  const photos = useStore((s) => s.photos)
  const currentIndex = useStore((s) => s.currentIndex)
  const lightboxOpen = useStore((s) => s.lightbox !== null)
  const openLightbox = useStore((s) => s.openLightbox)
  const loadMore = useStore((s) => s.loadMore)
  const markWebglFailed = useStore((s) => s.markWebglFailed)
  const scheme = document.documentElement.dataset.scheme
  const [quality, setQuality] = useState<Quality>(() => savedQuality() ?? startingQuality(device()))
  const [dpr, setDpr] = useState(1)
  const [visible, setVisible] = useState(!document.hidden)
  const [settled, setSettled] = useState(false)
  const [touring, setTouring] = useState(false)
  const [guide, setGuide] = useState(() => !guideSeen())
  const low = quality === 'low'

  // Sharpness arrives in steps after the room is up, so opening stays quick.
  useEffect(() => {
    const target = pixelRatioFor(quality, window.devicePixelRatio)
    const timers = DPR_STEPS.map((delay, i) =>
      setTimeout(() => setDpr((value) => Math.max(Math.min(value, target), Math.min(1 + ((target - 1) * (i + 1)) / DPR_STEPS.length, target))), delay),
    )
    return () => timers.forEach(clearTimeout)
  }, [quality])

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // The lightbox hides the scene, so rendering stops after the opening transition.
  useEffect(() => {
    if (!lightboxOpen) {
      setSettled(false)
      return
    }
    const timer = setTimeout(() => setSettled(true), 500)
    return () => clearTimeout(timer)
  }, [lightboxOpen])

  useEffect(() => {
    if (photos.length > 0 && currentIndex > photos.length - 12) void loadMore()
  }, [currentIndex, loadMore, photos.length])

  useEffect(() => {
    controls.onActive = () => {
      walker.wake()
      setGuide(false)
    }
    controls.onTap = (x, y) => {
      const element = three.current ? (document.querySelector('[data-scene]') as HTMLElement | null) : null
      if (!element || !three.current) return
      const ndc = new THREE.Vector2((x / element.clientWidth) * 2 - 1, -(y / element.clientHeight) * 2 + 1)
      raycaster.setFromCamera(ndc, three.current.camera)
      walker.wake()
      if (catHit.current && raycaster.intersectObject(catHit.current).length > 0) {
        walker.pet()
        haptic.success()
        return
      }
      const slot = paintings.current?.hit(raycaster)
      if (slot != null) {
        haptic.tap()
        if (walker.viewing === slot) pendingOpen.current = slot
        else {
          pendingOpen.current = null
          walker.visit(slot, true)
        }
        return
      }
      const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0)), new THREE.Vector3())
      if (point) {
        const spot = resolve(point.x, point.z)
        haptic.soft()
        pendingOpen.current = null
        walker.goTo(spot.x, spot.z)
      }
    }
    return () => {
      controls.onActive = controls.onTap = null
    }
  }, [controls, raycaster, walker])

  const changeQuality = (next: Quality, remember: boolean) => {
    setQuality(next)
    setDpr(1)
    if (remember) saveQuality(next)
  }

  return (
    <>
      <div
        data-scene
        className="absolute inset-0 touch-none select-none"
        onPointerDown={(event) => controls.down(event)}
        onPointerMove={(event) => controls.move(event)}
        onPointerUp={(event) => controls.up(event)}
        onPointerCancel={(event) => controls.up(event, true)}
      >
        <Canvas
          dpr={dpr}
          flat
          frameloop={visible && !settled ? 'always' : 'never'}
          camera={{ fov: 46, near: 0.1, far: 40, position: [0, 1.7, 4.9] }}
          gl={{ antialias: !low, powerPreference: 'high-performance', alpha: false }}
          onCreated={(state) => {
            three.current = state
            const canvas = state.gl.domElement
            let restoreTimer = 0
            canvas.addEventListener('webglcontextlost', (event) => {
              event.preventDefault()
              restoreTimer = window.setTimeout(markWebglFailed, 3000)
            })
            canvas.addEventListener('webglcontextrestored', () => clearTimeout(restoreTimer))
          }}
        >
          <color attach="background" args={[scheme === 'light' ? '#3d2a1e' : '#150c08']} />
          <fog attach="fog" args={[scheme === 'light' ? '#3d2a1e' : '#150c08', 11, 30]} />
          <hemisphereLight args={['#ffdfb0', '#4a2c1c', scheme === 'light' ? 2.1 : 1.35]} />
          <pointLight color="#ffd9a0" position={[0, 3.6, 0]} intensity={16} distance={15} decay={1.3} />
          <pointLight ref={light} color="#ffc98a" intensity={9} distance={9} decay={1.5} />

          <Room night={scheme !== 'light'} />
          <Paintings ref={paintings} walker={walker} photos={photos} textureWidth={low ? 400 : 800} />

          <group ref={cat}>
            <Cat walker={walker} />
            <mesh ref={catHit} visible={false} position={[0, 0.4, 0]}>
              <sphereGeometry args={[0.65, 8, 8]} />
            </mesh>
          </group>
          <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.46, 24]} />
            <meshBasicMaterial color="#000" transparent opacity={0.3} depthWrite={false} />
          </mesh>
          {!reducedMotion && !low && <Dust />}

          <Director
            walker={walker}
            controls={controls}
            paintings={paintings}
            cat={cat}
            shadow={shadow}
            light={light}
            pendingOpen={pendingOpen}
            autopilot={!lightboxOpen}
            onResume={() => setSettled(false)}
            onTouring={setTouring}
            onSlow={() => {
              if (quality !== 'low') changeQuality(lowerQuality(quality), false)
              else setDpr(1)
            }}
            onUnusable={() => {
              if (quality !== 'low') changeQuality('low', false)
              else markWebglFailed()
            }}
            onOpen={(slot, rect) => {
              const list = useStore.getState().photos
              const index = paintings.current?.indexOf(slot)
              if (list.length > 0 && index != null) openLightbox(list, mod(index, list.length), rect)
            }}
          />
        </Canvas>
      </div>

      <Stick controls={controls} />
      <div className="absolute top-[calc(var(--safe-top)+60px)] right-4 z-10 flex flex-col items-end gap-2">
        <SceneButton
          label={touring ? t.tourStop : t.tour}
          active={touring}
          onClick={() => {
            haptic.tap()
            setGuide(false)
            if (touring) walker.wake()
            else walker.startTour()
            setTouring(!touring)
          }}
        />
        <SceneButton label={`${t.quality}: ${QUALITY_LABELS[quality]}`} onClick={() => changeQuality(nextQuality(quality), true)} />
      </div>
      {guide && (
        <Guide
          onClose={() => {
            markGuideSeen()
            setGuide(false)
          }}
        />
      )}
    </>
  )
}


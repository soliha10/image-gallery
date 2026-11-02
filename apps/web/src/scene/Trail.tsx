import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Walker } from './walker'

const COUNT = 48
const LIFE = 0.9
const COMET_SPEED = 2

/** Star dust left at the paws; at a run the same sparks stretch into a short comet tail. */
export function Trail({ walker, drop, map }: { walker: Walker; drop: React.RefObject<number>; map: THREE.Texture }) {
  const parts = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3).fill(-999), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    const material = new THREE.PointsMaterial({
      map,
      size: 0.11,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    return { geometry, material, ages: new Float32Array(COUNT).fill(LIFE), rises: new Float32Array(COUNT) }
  }, [map])
  const state = useRef({ next: 0, wait: 0 })

  useLayoutEffect(
    () => () => {
      parts.geometry.dispose()
      parts.material.dispose()
    },
    [parts],
  )

  useFrame((_, delta) => {
    const { geometry, ages, rises } = parts
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute
    const s = state.current
    const dropping = drop.current > 0
    const comet = dropping || walker.speed > COMET_SPEED
    s.wait -= delta
    if ((walker.moving || dropping) && s.wait <= 0) {
      s.wait = comet ? 0.016 : 0.07
      const i = s.next
      s.next = (i + 1) % COUNT
      const back = comet ? 0.42 : 0
      const spread = comet ? 0.08 : 0.2
      positions.setXYZ(
        i,
        walker.x - Math.sin(walker.heading) * back + (Math.random() - 0.5) * spread,
        (comet ? 0.42 : 0.04) + drop.current,
        walker.z - Math.cos(walker.heading) * back + (Math.random() - 0.5) * spread,
      )
      ages[i] = 0
      rises[i] = 0.1 + Math.random() * 0.25
    }
    for (let i = 0; i < COUNT; i++) {
      if (ages[i]! >= LIFE) continue
      ages[i]! += delta
      positions.setY(i, positions.getY(i) + rises[i]! * delta)
      const fade = Math.max(1 - ages[i]! / LIFE, 0)
      colors.setXYZ(i, fade, fade * 0.84, fade * 0.52)
    }
    positions.needsUpdate = true
    colors.needsUpdate = true
  })

  return <points geometry={parts.geometry} material={parts.material} frustumCulled={false} renderOrder={3} />
}

export const SLOTS = 24
export const SPACING = (Math.PI * 2) / SLOTS
export const WALL_RADIUS = 9
/** Where the cat sits to look at a painting. */
export const VIEW_RADIUS = 7.05
export const BENCH_RADIUS = 1.55

const CAT_CLEARANCE = 0.35
const ROOM_LIMIT = WALL_RADIUS - 0.8
const BENCH_LIMIT = BENCH_RADIUS + CAT_CLEARANCE

export const mod = (n: number, m: number) => ((n % m) + m) % m
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
/** Shortest signed turn, in the range -PI to PI. */
export const wrapAngle = (a: number) => mod(a + Math.PI, Math.PI * 2) - Math.PI

/** World angle of a slot position; increasing position moves clockwise seen from above. */
export const angleAt = (pos: number) => -pos * SPACING

/**
 * The room has a fixed ring of frames but the walk is endless: each frame shows the walk
 * index nearest to the cat that lands on that frame.
 */
export const nearestIndexForSlot = (pos: number, slot: number) =>
  Math.round((pos - slot) / SLOTS) * SLOTS + slot

/** Which photo a frame shows. With fewer photos than frames they spread out without repeats. */
export function indexForSlot(pos: number, slot: number, count: number): number | null {
  if (count === 0) return null
  if (count >= SLOTS) return nearestIndexForSlot(pos, slot)
  const index = Math.ceil((slot * count) / SLOTS)
  return slotOfIndex(index, count) === slot ? index : null
}

export const slotOfIndex = (index: number, count: number) =>
  count >= SLOTS ? mod(index, SLOTS) : Math.floor((mod(index, count) * SLOTS) / count)

const WALK_SPEED = 1.5
const RUN_SPEED = 3.4
const SIT_AFTER = 0.25
const AUTO_VIEW_AFTER = 0.7
const AUTO_VIEW_REACH = 0.38
const AUTOPILOT_AFTER = 16
const TOUR_PAUSE = 4.5
const SLEEP_AFTER = 45

/** Pure movement and behaviour state for the cat; the renderer only reads from it. */
export class Walker {
  x = 0
  z = VIEW_RADIUS
  vx = 0
  vz = 0
  /** Radians; the cat faces (sin, cos) on the floor plane. */
  heading = 0
  speed = 0
  /** Heading change per second, which the head leads and the body follows. */
  turning = 0
  /** Unwrapped slot position, counting full laps of the room. */
  pos = 0
  /** Signed drift along the ring, used to load the pictures ahead. */
  drift = 0
  /** Requested direction and strength in world space, set every frame by the controls. */
  inputX = 0
  inputZ = 0
  /** The frame the cat is sitting in front of. */
  viewing: number | null = 0
  touring = false
  /** Seconds since the cat came to a stop. */
  idle = 0
  sit = 0
  sleep = 0
  happy = 0
  /** Bearing of the nearest painting from the cat's nose, weighted by how close it is. */
  gazeYaw = 0
  gazeWeight = 0
  /** Frames without a picture are skipped; the scene replaces this when photos change. */
  filled: (slot: number) => boolean = () => true

  private target: { x: number; z: number; slot: number | null; rush: boolean } | null = null
  private walks = 0
  private autoView = false

  get moving() {
    return this.speed > 0.05
  }

  get arrived() {
    return this.target === null && !this.moving && Math.hypot(this.inputX, this.inputZ) < 0.05
  }

  /** Radius from the centre of the room. */
  get radius() {
    return Math.hypot(this.x, this.z)
  }

  get nearestSlot() {
    return mod(Math.round(this.pos), SLOTS)
  }

  /** Walks to a floor point; points inside the bench or walls resolve to the closest free spot. */
  goTo(x: number, z: number) {
    const free = resolve(x, z)
    this.target = { x: free.x, z: free.z, slot: null, rush: false }
    this.viewing = null
    this.autoView = false
    this.rouse()
  }

  /** Walks to the viewing spot of a frame and sits facing it. */
  visit(slot: number, rush = false) {
    const angle = angleAt(slot)
    this.target = { x: Math.sin(angle) * VIEW_RADIUS, z: Math.cos(angle) * VIEW_RADIUS, slot: mod(slot, SLOTS), rush }
    this.viewing = null
    this.autoView = false
    this.rouse()
  }

  /** Places the cat at a frame immediately, for returning from the lightbox. */
  jumpTo(pos: number) {
    const slot = mod(Math.round(pos), SLOTS)
    const angle = angleAt(slot)
    this.pos = pos
    this.x = Math.sin(angle) * VIEW_RADIUS
    this.z = Math.cos(angle) * VIEW_RADIUS
    this.vx = this.vz = this.speed = 0
    this.heading = angle
    this.target = null
    this.viewing = slot
    this.autoView = false
    this.idle = 0
  }

  /** Free look takes over the camera, so the cat stops holding its pose for a painting. */
  stopViewing() {
    this.viewing = null
    this.autoView = true
  }

  /** Petting keeps the cat awake and purring for a moment. */
  pet() {
    this.happy = 2.4
    this.idle = 0
    this.sleep = 0
  }

  startTour() {
    this.touring = true
    this.walks = 0
    this.visit(this.nextFilled(this.nearestSlot + (this.viewing === null ? 0 : 1)))
  }

  /** Any user input resets the wander budget and ends the tour. */
  wake() {
    this.walks = 0
    this.idle = 0
    this.sleep = 0
    this.touring = false
  }

  update(dt: number, autopilot: boolean) {
    const strength = Math.min(Math.hypot(this.inputX, this.inputZ), 1)
    const manual = strength >= 0.05
    let dirX = 0
    let dirZ = 0
    let limit = 0

    if (manual) {
      this.target = null
      this.viewing = null
      this.autoView = false
      this.wake()
      dirX = this.inputX / Math.hypot(this.inputX, this.inputZ)
      dirZ = this.inputZ / Math.hypot(this.inputX, this.inputZ)
      limit = strength > 0.85 ? RUN_SPEED : WALK_SPEED * Math.min(strength / 0.6, 1)
    } else if (this.target) {
      const dx = this.target.x - this.x
      const dz = this.target.z - this.z
      const distance = Math.hypot(dx, dz)
      if (distance < 0.05) {
        this.viewing = this.target.slot
        this.target = null
      } else {
        dirX = dx / distance
        dirZ = dz / distance
        limit = Math.min(this.target.rush ? RUN_SPEED : WALK_SPEED, distance * 3.5)
      }
    }

    const steered = this.steer(dirX, dirZ)
    const blend = 1 - Math.exp(-dt * 8)
    this.vx += (steered.x * limit - this.vx) * blend
    this.vz += (steered.z * limit - this.vz) * blend

    const free = resolve(this.x + this.vx * dt, this.z + this.vz * dt)
    this.speed = dt > 0 ? Math.hypot(free.x - this.x, free.z - this.z) / dt : 0
    this.x = free.x
    this.z = free.z

    const slotPos = -Math.atan2(this.x, this.z) / SPACING
    const moved = mod(slotPos - this.pos + SLOTS / 2, SLOTS) - SLOTS / 2
    this.pos += moved
    this.drift += ((dt > 0 ? moved / dt : 0) - this.drift) * (1 - Math.exp(-dt * 4))

    this.happy = Math.max(0, this.happy - dt)
    this.turn(dt)
    this.gaze()

    if (this.arrived) {
      this.vx = this.vz = 0
      this.idle += dt
    } else {
      this.idle = 0
    }

    const sitting = this.idle > SIT_AFTER
    const asleep = this.idle > SLEEP_AFTER && this.happy === 0
    this.sit += ((sitting ? 1 : 0) - this.sit) * (1 - Math.exp(-dt * 6))
    this.sleep += ((asleep ? 1 : 0) - this.sleep) * (1 - Math.exp(-dt * 2))

    if (!this.arrived) return

    if (this.viewing === null && !this.autoView && this.idle > AUTO_VIEW_AFTER) {
      this.autoView = true
      const slot = this.nearestSlot
      const near = Math.abs(wrapAngle((this.pos - Math.round(this.pos)) * SPACING)) / SPACING < AUTO_VIEW_REACH
      if (this.radius > VIEW_RADIUS - 0.9 && near && this.filled(slot)) this.viewing = slot
    }

    if (this.touring && this.viewing !== null && this.idle > TOUR_PAUSE) {
      this.visit(this.nextFilled(this.viewing + 1))
      return
    }

    if (autopilot && this.idle > AUTOPILOT_AFTER && this.idle < SLEEP_AFTER && this.happy === 0 && this.walks < 8) {
      this.walks++
      this.visit(this.nextFilled(this.nearestSlot + 1))
    }
  }

  private rouse() {
    this.idle = 0
    this.sleep = 0
  }

  private nextFilled(from: number) {
    for (let i = 0; i < SLOTS; i++) if (this.filled(mod(from + i, SLOTS))) return mod(from + i, SLOTS)
    return mod(from, SLOTS)
  }

  /** Slides around the bench instead of pushing against it, so walks never get stuck. */
  private steer(x: number, z: number) {
    const radius = this.radius
    if (radius > BENCH_LIMIT + 0.5 || radius === 0) return { x, z }
    const outX = this.x / radius
    const outZ = this.z / radius
    if (x * outX + z * outZ >= 0) return { x, z }
    const along = -x * outZ + z * outX
    const side = along >= 0 ? 1 : -1
    return { x: -outZ * side, z: outX * side }
  }

  private turn(dt: number) {
    let wanted = this.heading
    if (this.moving) wanted = Math.atan2(this.vx, this.vz)
    else if (this.viewing !== null) wanted = angleAt(this.viewing)
    const delta = wrapAngle(wanted - this.heading)
    const step = delta * (1 - Math.exp(-dt * 8))
    this.heading = wrapAngle(this.heading + step)
    this.turning = dt > 0 ? step / dt : 0
  }

  private gaze() {
    const angle = angleAt(this.nearestSlot)
    const bearing = Math.atan2(Math.sin(angle) * (WALL_RADIUS - 0.16) - this.x, Math.cos(angle) * (WALL_RADIUS - 0.16) - this.z)
    const yaw = wrapAngle(bearing - this.heading)
    this.gazeYaw = yaw
    const front = clamp((1.9 - Math.abs(yaw)) / 0.5, 0, 1)
    this.gazeWeight = this.filled(this.nearestSlot) ? clamp((this.radius - 4.5) / 1.8, 0, 1) * front : 0
  }
}

/** Keeps a floor point inside the wall and outside the bench. */
export function resolve(x: number, z: number) {
  const radius = Math.hypot(x, z)
  if (radius > ROOM_LIMIT) return { x: (x / radius) * ROOM_LIMIT, z: (z / radius) * ROOM_LIMIT }
  if (radius >= BENCH_LIMIT) return { x, z }
  if (radius < 0.0001) return { x: 0, z: BENCH_LIMIT }
  return { x: (x / radius) * BENCH_LIMIT, z: (z / radius) * BENCH_LIMIT }
}

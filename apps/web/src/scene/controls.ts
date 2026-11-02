const STICK_REACH = 52
const TAP_SLOP = 9
const TAP_TIME = 350
/** The joystick claims touches starting in this part of the screen. */
const STICK_ZONE_X = 0.46
const STICK_ZONE_Y = 0.42

interface Pointer {
  mode: 'stick' | 'look'
  startX: number
  startY: number
  lastX: number
  lastY: number
  time: number
  moved: boolean
}

export interface StickView {
  show(x: number, y: number): void
  move(dx: number, dy: number): void
  hide(): void
}

/** Live user input; the render loop reads it without going through React. */
export class Controls {
  stickX = 0
  stickY = 0
  /** Radians of drag waiting for the camera to take them. */
  lookX = 0
  lookY = 0
  run = false
  stickView: StickView | null = null
  onTap: ((x: number, y: number) => void) | null = null
  onActive: (() => void) | null = null

  private readonly pointers = new Map<number, Pointer>()
  private readonly keys = new Set<string>()

  get keyX() {
    return (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0)
  }

  get keyY() {
    return (this.keys.has('up') ? 1 : 0) - (this.keys.has('down') ? 1 : 0)
  }

  down(event: React.PointerEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const free = ![...this.pointers.values()].some((p) => p.mode === 'stick')
    const inZone = x < box.width * STICK_ZONE_X && y > box.height * (1 - STICK_ZONE_Y)
    const mode = event.pointerType === 'touch' && free && inZone ? 'stick' : 'look'
    this.pointers.set(event.pointerId, {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      time: event.timeStamp,
      moved: false,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (mode === 'stick') this.stickView?.show(x, y)
  }

  move(event: React.PointerEvent<HTMLElement>) {
    const pointer = this.pointers.get(event.pointerId)
    if (!pointer) return
    const dx = event.clientX - pointer.startX
    const dy = event.clientY - pointer.startY
    if (!pointer.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      pointer.moved = true
      this.onActive?.()
    }
    if (pointer.mode === 'stick') {
      if (!pointer.moved) return
      const length = Math.hypot(dx, dy)
      const scale = length > STICK_REACH ? STICK_REACH / length : 1
      this.stickX = (dx * scale) / STICK_REACH
      this.stickY = (-dy * scale) / STICK_REACH
      this.stickView?.move(dx * scale, dy * scale)
      return
    }
    if (pointer.moved) {
      this.lookX += (event.clientX - pointer.lastX) * 0.006
      this.lookY += (event.clientY - pointer.lastY) * 0.004
    }
    pointer.lastX = event.clientX
    pointer.lastY = event.clientY
  }

  up(event: React.PointerEvent<HTMLElement>, cancelled = false) {
    const pointer = this.pointers.get(event.pointerId)
    if (!pointer) return
    this.pointers.delete(event.pointerId)
    if (pointer.mode === 'stick') {
      this.stickX = this.stickY = 0
      this.stickView?.hide()
    }
    if (!cancelled && !pointer.moved && event.timeStamp - pointer.time < TAP_TIME) {
      const box = event.currentTarget.getBoundingClientRect()
      this.onTap?.(event.clientX - box.left, event.clientY - box.top)
    }
  }

  key(code: string, pressed: boolean) {
    const name = KEYS[code]
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.run = pressed
    if (!name) return false
    if (pressed) {
      this.keys.add(name)
      this.onActive?.()
    } else {
      this.keys.delete(name)
    }
    return true
  }

  releaseKeys() {
    this.keys.clear()
    this.run = false
  }
}

const KEYS: Record<string, string> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

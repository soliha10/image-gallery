interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

interface BottomButton {
  show(): void
  hide(): void
  setText(text: string): void
  onClick(handler: () => void): void
  offClick(handler: () => void): void
}

interface WebApp {
  initData: string
  initDataUnsafe: { start_param?: string; user?: { language_code?: string } }
  safeAreaInset?: Insets
  contentSafeAreaInset?: Insets
  platform: string
  isVersionAtLeast(version: string): boolean
  ready(): void
  expand(): void
  requestFullscreen(): void
  disableVerticalSwipes(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  onEvent(event: string, handler: () => void): void
  offEvent(event: string, handler: () => void): void
  showConfirm(message: string, callback: (ok: boolean) => void): void
  openTelegramLink(url: string): void
  openLink(url: string): void
  downloadFile(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void
  BackButton: { show(): void; hide(): void; onClick(h: () => void): void; offClick(h: () => void): void }
  MainButton: BottomButton
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'soft'): void
    selectionChanged(): void
    notificationOccurred(type: 'success' | 'error' | 'warning'): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp }
  }
}

const app = window.Telegram?.WebApp
/** The script also runs in plain browsers, where initData is empty. */
export const tg = app?.initData ? app : undefined

const supports = (version: string) => tg?.isVersionAtLeast(version) ?? false

function applySafeArea() {
  if (!tg) return
  const root = document.documentElement.style
  const { safeAreaInset: safe, contentSafeAreaInset: content } = tg
  root.setProperty('--safe-top', `${(safe?.top ?? 0) + (content?.top ?? 0)}px`)
  root.setProperty('--safe-bottom', `${(safe?.bottom ?? 0) + (content?.bottom ?? 0)}px`)
  root.setProperty('--safe-left', `${safe?.left ?? 0}px`)
  root.setProperty('--safe-right', `${safe?.right ?? 0}px`)
}

export function initTelegram() {
  if (!tg) return
  tg.ready()
  tg.expand()
  applySafeArea()
  for (const event of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) tg.onEvent(event, applySafeArea)
  if (supports('7.7')) tg.disableVerticalSwipes()
  if (supports('7.10')) {
    tg.setHeaderColor('#090a1c')
    tg.setBackgroundColor('#090a1c')
  }
  const mobile = tg.platform === 'ios' || tg.platform === 'android'
  if (mobile && supports('8.0')) tg.requestFullscreen()
}

export const haptic = {
  tap: () => (supports('6.1') ? tg?.HapticFeedback.impactOccurred('light') : undefined),
  soft: () => (supports('6.1') ? tg?.HapticFeedback.impactOccurred('soft') : undefined),
  select: () => (supports('6.1') ? tg?.HapticFeedback.selectionChanged() : undefined),
  success: () => (supports('6.1') ? tg?.HapticFeedback.notificationOccurred('success') : undefined),
}

export function backButton(handler: () => void) {
  if (!tg || !supports('6.1')) return () => undefined
  tg.BackButton.onClick(handler)
  tg.BackButton.show()
  return () => {
    tg.BackButton.offClick(handler)
    tg.BackButton.hide()
  }
}

export function mainButton(text: string, handler: () => void) {
  if (!tg) return null
  tg.MainButton.setText(text)
  tg.MainButton.onClick(handler)
  tg.MainButton.show()
  return () => {
    tg.MainButton.offClick(handler)
    tg.MainButton.hide()
  }
}

export function confirm(message: string) {
  return new Promise<boolean>((resolve) => {
    if (tg && supports('6.2')) tg.showConfirm(message, resolve)
    else resolve(window.confirm(message))
  })
}

export function downloadPhoto(url: string, fileName: string) {
  const absolute = new URL(url, location.href).href
  if (tg && supports('8.0')) tg.downloadFile({ url: absolute, file_name: fileName })
  else if (tg) tg.openLink(absolute)
  else window.open(absolute, '_blank')
}

/** Opens Telegram's share sheet, or copies the link outside Telegram. */
function shareLink(param: string, text: string): 'telegram' | 'copied' {
  const base = import.meta.env.VITE_TG_APP_LINK as string | undefined
  const link = base ? `${base}?startapp=${param}` : `${location.origin}${location.pathname}?startapp=${param}`
  if (tg) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`)
    return 'telegram'
  }
  void navigator.clipboard?.writeText(link)
  return 'copied'
}

export const sharePhoto = (photoId: string, text: string) => shareLink(`photo_${photoId}`, text)

export const shareGallery = (token: string, text: string) => shareLink(`g_${token}`, text)

const startParam = () => app?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp') ?? ''

export function startPhotoId() {
  const param = startParam()
  return param.startsWith('photo_') ? param.slice('photo_'.length) : null
}

export function startGalleryToken() {
  const param = startParam()
  return param.startsWith('g_') ? param.slice('g_'.length) : null
}

export const userLanguage = () => tg?.initDataUnsafe.user?.language_code ?? navigator.language.slice(0, 2)

export interface GroupItem<T> {
  groupId: string
  item: T
}

/**
 * Telegram delivers each photo of an album as a separate update. This buffers them per
 * media_group_id and flushes once no new item has arrived for `quietMs`.
 */
export class MediaGroupCollector<T> {
  private readonly groups = new Map<string, { items: T[]; timer: NodeJS.Timeout }>()

  constructor(
    private readonly quietMs: number,
    private readonly onFlush: (groupId: string, items: T[]) => void,
  ) {}

  add({ groupId, item }: GroupItem<T>) {
    const group = this.groups.get(groupId)
    if (group) clearTimeout(group.timer)
    const items = group?.items ?? []
    items.push(item)
    const timer = setTimeout(() => {
      this.groups.delete(groupId)
      this.onFlush(groupId, items)
    }, this.quietMs)
    this.groups.set(groupId, { items, timer })
  }
}

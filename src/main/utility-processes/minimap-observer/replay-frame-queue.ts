/** 有界 FIFO；满载时淘汰最旧的待处理帧，让最新观察优先。 */
export class ReplayFrameQueue<T> {
  private readonly _items: T[] = []

  constructor(private readonly _capacity: number) {
    if (!Number.isInteger(_capacity) || _capacity < 1) {
      throw new Error('Replay frame queue capacity must be a positive integer')
    }
  }

  public get size(): number {
    return this._items.length
  }

  public push(item: T): T | null {
    const superseded = this._items.length >= this._capacity ? (this._items.shift() ?? null) : null
    this._items.push(item)
    return superseded
  }

  public shift(): T | undefined {
    return this._items.shift()
  }

  public drain(): T[] {
    return this._items.splice(0)
  }

  public clear(): void {
    this._items.length = 0
  }
}

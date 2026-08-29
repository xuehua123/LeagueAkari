import { describe, expect, it } from 'vitest'

import { ReplayFrameQueue } from './replay-frame-queue'

describe('ReplayFrameQueue', () => {
  it('keeps a bounded latest-wins queue and returns the superseded oldest frame', () => {
    const queue = new ReplayFrameQueue<number>(3)

    expect(queue.push(1)).toBeNull()
    expect(queue.push(2)).toBeNull()
    expect(queue.push(3)).toBeNull()
    expect(queue.push(4)).toBe(1)
    expect(queue.size).toBe(3)
    expect(queue.drain()).toEqual([2, 3, 4])
    expect(queue.size).toBe(0)
  })

  it('rejects invalid capacities', () => {
    expect(() => new ReplayFrameQueue(0)).toThrow('positive integer')
    expect(() => new ReplayFrameQueue(1.5)).toThrow('positive integer')
  })
})

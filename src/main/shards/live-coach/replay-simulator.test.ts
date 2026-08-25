import { describe, expect, it } from 'vitest'

import { CoachReplaySimulator } from './replay-simulator'

describe('CoachReplaySimulator', () => {
  it('simulates synchronous replay, generates structured sidecar, and exports markdown report', () => {
    const simulator = new CoachReplaySimulator()
    const sample = simulator.createSampleReplaySession()

    const result = simulator.simulateSynchronous(sample)
    expect(result.totalCues).toBeGreaterThanOrEqual(1)

    const sidecar = simulator.generateSidecar(sample, result.cues)
    expect(sidecar.sessionId).toBe(sample.metadata.sessionId)
    expect(sidecar.totalCues).toBe(result.totalCues)
    expect(sidecar.timeline.length).toBe(result.totalCues)

    const markdown = simulator.generateMarkdownReport(sidecar)
    expect(markdown).toContain('# 对局 AI 教练战术复盘报告')
    expect(markdown).toContain(sample.metadata.sessionId)
  })
})

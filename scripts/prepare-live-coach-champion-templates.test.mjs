import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  parseCliOptions,
  prepareChampionTemplates
} from './prepare-live-coach-champion-templates.mjs'

describe('live coach champion template preparation', () => {
  it('defaults to the current patch and never overwrites a runtime manifest', async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-bootstrap-model-'))
    try {
      const catalogPath = path.join(temporaryDirectory, 'champion-summary.json')
      const sourceDirectory = path.join(temporaryDirectory, 'icons')
      const outputDirectory = path.join(temporaryDirectory, 'models')
      fs.mkdirSync(sourceDirectory)
      fs.mkdirSync(outputDirectory)
      fs.writeFileSync(catalogPath, JSON.stringify([{ id: 1 }, { id: 60_001 }]))

      const image = new PNG({ width: 2, height: 2 })
      image.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
      fs.writeFileSync(path.join(sourceDirectory, '1.png'), PNG.sync.write(image))

      const manifestPath = path.join(outputDirectory, 'manifest.json')
      const acceptedManifest = `${JSON.stringify({
        schemaVersion: 2,
        models: {
          '16.17.1': {
            validation: { status: 'accepted', releaseEligible: true }
          }
        }
      })}\n`
      fs.writeFileSync(manifestPath, acceptedManifest)

      const defaults = parseCliOptions([])
      expect(defaults).toMatchObject({ patch: '16.17.1', help: false })
      const result = await prepareChampionTemplates({
        ...defaults,
        catalogPath,
        outputDirectory,
        sourceBaseUrl: pathToFileURL(`${sourceDirectory}${path.sep}`).toString()
      })

      expect(result.artifact).toMatchObject({
        schemaVersion: 1,
        artifactKind: 'square-portrait-bootstrap',
        releaseEligible: false,
        patch: '16.17.1',
        championCount: 1
      })
      expect(path.basename(result.outputPath)).toBe('champion-icons-16-17-1.json')
      expect(fs.readFileSync(manifestPath, 'utf8')).toBe(acceptedManifest)
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})

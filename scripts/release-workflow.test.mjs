import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci-release.yml', 'utf8'))
const buildSteps = workflow.jobs.build.steps

function step(name) {
  const found = buildSteps.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing release workflow step: ${name}`)
  return found
}

describe('official Windows release distribution gates', () => {
  it('requires signing secrets before the build while leaving non-tag builds unsigned', () => {
    const preflight = step('Require official Windows code-signing credentials')
    const build = step('Build package')

    expect(buildSteps.indexOf(preflight)).toBeLessThan(buildSteps.indexOf(build))
    expect(preflight.if).toContain("runner.os == 'Windows'")
    expect(preflight.if).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(preflight.env.CSC_LINK).toContain('secrets.WINDOWS_CSC_LINK')
    expect(preflight.env.CSC_KEY_PASSWORD).toContain('secrets.WINDOWS_CSC_KEY_PASSWORD')
    expect(build.env.CSC_LINK).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(build.env.CSC_LINK).toContain("|| ''")
    expect(build.env.CSC_KEY_PASSWORD).toContain("|| ''")
  })

  it('verifies Authenticode validity and timestamp before finalizing assets', () => {
    const build = step('Build package')
    const signature = step('Verify official Windows Authenticode signature and timestamp')
    const finalize = step('Normalize release asset names')

    expect(buildSteps.indexOf(build)).toBeLessThan(buildSteps.indexOf(signature))
    expect(buildSteps.indexOf(signature)).toBeLessThan(buildSteps.indexOf(finalize))
    expect(signature.if).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(signature.run).toContain('dist/win-unpacked/LeagueAkari.exe')
    expect(signature.run).toContain('Get-AuthenticodeSignature')
    expect(signature.run).toContain('SignatureStatus]::Valid')
    expect(signature.run).toContain('TimeStamperCertificate')
  })

  it('smokes the normalized archive and uploads checksums for publication', () => {
    const finalize = step('Normalize release asset names')
    const archiveSmoke = step('Verify normalized Windows archive by extraction')
    const attestation = step('Attest official release artifacts')
    const upload = step('Upload build artifacts')
    const windows = workflow.jobs.build.strategy.matrix.include.find(
      (entry) => entry.name === 'Windows'
    )

    expect(buildSteps.indexOf(finalize)).toBeLessThan(buildSteps.indexOf(archiveSmoke))
    expect(archiveSmoke.run).toContain('--archive dist/league-akari-win-x64.7z')
    expect(archiveSmoke.run).toContain('--require-accepted-model')
    expect(attestation.uses).toBe('actions/attest@v4')
    expect(attestation.with['subject-path']).toBe('dist/${{ matrix.release_asset_prefix }}*')
    expect(workflow.jobs.build.permissions['artifact-metadata']).toBe('write')
    expect(windows.artifact_paths).toContain('league-akari-win-x64-SHA256SUMS.txt')
    expect(upload.with.path).toBe('${{ matrix.artifact_paths }}')
  })
})

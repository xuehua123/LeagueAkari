import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LOCAL_FILE_GRANT_DEFAULT_TTL_MS = 12 * 60 * 60 * 1_000

export type LocalFileGrantPurpose =
  'live-coach-replay-video' | 'live-coach-replay-json' | 'live-coach-replay-sidecar'

export interface LocalFileGrantDescriptor {
  token: string
  displayName: string
  purpose: LocalFileGrantPurpose
  expiresAt: number
}

interface LocalFileGrantRecord extends LocalFileGrantDescriptor {
  filePath: string
  device: number
  inode: number
  size: number
  modifiedAt: number
}

export class LocalFileGrantError extends Error {
  constructor(
    public readonly code: 'invalid-token' | 'unavailable' | 'wrong-purpose',
    message: string
  ) {
    super(message)
    this.name = 'LocalFileGrantError'
  }
}

/**
 * Keeps renderer-visible local-file capabilities in memory. A grant is bound to the canonical
 * regular file selected by the user and never exposes that path in its public descriptor.
 */
export class LocalFileGrantRegistry {
  private readonly _records = new Map<string, LocalFileGrantRecord>()

  constructor(private readonly _now: () => number = Date.now) {}

  async issue(
    filePath: string,
    purpose: LocalFileGrantPurpose,
    ttlMs: number = LOCAL_FILE_GRANT_DEFAULT_TTL_MS
  ): Promise<LocalFileGrantDescriptor> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }

    let canonicalPath: string
    let stat: fs.Stats
    try {
      canonicalPath = await fs.promises.realpath(path.resolve(filePath))
      stat = await fs.promises.stat(canonicalPath)
    } catch {
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }
    if (!stat.isFile()) {
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = this._now() + ttlMs
    const displayName = path
      .basename(canonicalPath)
      .replace(/[\u0000-\u001f]/g, '_')
      .slice(0, 255)
    this._records.set(token, {
      token,
      displayName,
      purpose,
      expiresAt,
      filePath: canonicalPath,
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAt: stat.mtimeMs
    })
    return { token, displayName, purpose, expiresAt }
  }

  async resolve(
    token: string,
    allowedPurposes?: readonly LocalFileGrantPurpose[]
  ): Promise<{ descriptor: LocalFileGrantDescriptor; filePath: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new LocalFileGrantError('invalid-token', 'Local file grant is unavailable')
    }
    const record = this._records.get(token)
    if (!record || record.expiresAt <= this._now()) {
      if (record) this._records.delete(token)
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }
    if (allowedPurposes && !allowedPurposes.includes(record.purpose)) {
      throw new LocalFileGrantError('wrong-purpose', 'Local file grant is unavailable')
    }

    let stat: fs.Stats
    try {
      stat = await fs.promises.stat(record.filePath)
    } catch {
      this._records.delete(token)
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }
    if (
      !stat.isFile() ||
      stat.dev !== record.device ||
      stat.ino !== record.inode ||
      stat.size !== record.size ||
      stat.mtimeMs !== record.modifiedAt
    ) {
      this._records.delete(token)
      throw new LocalFileGrantError('unavailable', 'Local file grant is unavailable')
    }

    return {
      descriptor: {
        token: record.token,
        displayName: record.displayName,
        purpose: record.purpose,
        expiresAt: record.expiresAt
      },
      filePath: record.filePath
    }
  }

  revoke(token: string): boolean {
    return this._records.delete(token)
  }

  revokeByPurposes(purposes: readonly LocalFileGrantPurpose[]): number {
    const selected = new Set(purposes)
    let revoked = 0
    for (const [token, record] of this._records) {
      if (selected.has(record.purpose) && this._records.delete(token)) revoked++
    }
    return revoked
  }

  clear(): number {
    const count = this._records.size
    this._records.clear()
    return count
  }
}

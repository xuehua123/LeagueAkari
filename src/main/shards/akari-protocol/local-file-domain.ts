import fs from 'node:fs'
import { Readable } from 'node:stream'

import { LocalFileGrantRegistry } from './local-file-grants'

interface ByteRange {
  start: number
  end: number
}

function toWebStream(stream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(stream) as ReadableStream
}

function parseSingleByteRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || size <= 0) return null

  const [, startText, endText] = match
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

export function createLocalFileDomainHandler(grants: LocalFileGrantRegistry) {
  const mime = require('mime-types')

  return async (uri: string, req: Request) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, statusText: 'Method Not Allowed' })
      }
      const encodedToken = uri.split('?', 1)[0]
      const token = decodeURIComponent(encodedToken)
      const { filePath } = await grants.resolve(token, ['live-coach-replay-video'])
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        return unavailableResponse()
      }

      const contentType = mime.lookup(filePath) || 'application/octet-stream'
      const rangeHeader = req.headers.get('range')
      const commonHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType
      }

      if (rangeHeader) {
        const range = parseSingleByteRange(rangeHeader, stat.size)
        if (!range) {
          return new Response(null, {
            status: 416,
            statusText: 'Range Not Satisfiable',
            headers: {
              ...commonHeaders,
              'Content-Range': `bytes */${stat.size}`
            }
          })
        }
        const headers = {
          ...commonHeaders,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`
        }
        if (req.method === 'HEAD') return new Response(null, { status: 206, headers })
        return new Response(toWebStream(fs.createReadStream(filePath, range)), {
          status: 206,
          headers
        })
      }

      const headers = { ...commonHeaders, 'Content-Length': String(stat.size) }
      if (req.method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(toWebStream(fs.createReadStream(filePath)), { status: 200, headers })
    } catch {
      return unavailableResponse()
    }
  }
}

function unavailableResponse(): Response {
  return new Response('Resource unavailable', {
    status: 404,
    statusText: 'Not Found',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

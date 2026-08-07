import { deflateSync } from 'node:zlib'
import { config } from '../config.js'
import { fetchWithRetry } from './http.js'
import { logger } from './logger.js'

export async function generateImage(prompt: string): Promise<Buffer> {
  if (config.dev.enabled && !config.image.openaiKey) {
    logger.info({ prompt: prompt.slice(0, 80) }, 'DEV MODE: image generation skipped (no OPENAI_API_KEY) — returning placeholder PNG')
    return placeholderPng(1024, 1024)
  }
  return generateOpenAI(prompt)
  // Uncomment below to use other providers:
  // const provider = config.image.provider
  // switch (provider) {
  //   case 'stability':
  //     return generateStability(prompt)
  //   case 'gemini':
  //   default:
  //     return generateGemini(prompt)
  // }
}

// async function generateGemini(prompt: string): Promise<Buffer> {
//   if (!config.image.geminiKey) throw new Error('GEMINI_API_KEY not set')
//   const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent'
//   const res = await fetchWithRetry(`${url}?key=${config.image.geminiKey}`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       contents: [
//         {
//           parts: [
//             {
//               text: `Create a square 1080x1080 social media image. Do NOT put any text in the image. ${prompt}`,
//             },
//           ],
//         },
//       ],
//       generationConfig: { responseModalities: ['IMAGE'] },
//     }),
//   })
//   const data = (await res.json().catch(() => ({}))) as {
//     candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
//     error?: unknown
//   }
//   if (!res.ok) throw new Error(`Gemini image failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
//   const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data
//   if (!b64) throw new Error('Gemini returned no image data')
//   return Buffer.from(b64, 'base64')
// }

async function generateOpenAI(prompt: string): Promise<Buffer> {
  if (!config.image.openaiKey) throw new Error('OPENAI_API_KEY not set')
  const model = config.image.model
  const res = await fetchWithRetry('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.image.openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[]
    error?: unknown
  }
  if (!res.ok) throw new Error(`OpenAI image failed ${res.status}: ${JSON.stringify(data.error ?? data)}`)
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image')
  return Buffer.from(b64, 'base64')
}

// async function generateStability(prompt: string): Promise<Buffer> {
//   if (!config.image.stabilityKey) throw new Error('STABILITY_API_KEY not set')
//   const res = await fetchWithRetry('https://api.stability.ai/v2beta/stable-image/generate/core', {
//     method: 'POST',
//     headers: {
//       Authorization: `Bearer ${config.image.stabilityKey}`,
//       Accept: 'image/*',
//     },
//     body: new URLSearchParams({ prompt, aspect_ratio: '1:1' }),
//   })
//   if (!res.ok) {
//     const text = await res.text().catch(() => res.statusText)
//     throw new Error(`Stability image failed ${res.status}: ${text.slice(0, 300)}`)
//   }
//   return Buffer.from(await res.arrayBuffer())
// }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// Generates a small solid-color PNG (indigo) without any external image library.
export function placeholderPng(width = 1024, height = 1024, color: [number, number, number] = [99, 102, 241]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3
      raw[p] = color[0]
      raw[p + 1] = color[1]
      raw[p + 2] = color[2]
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

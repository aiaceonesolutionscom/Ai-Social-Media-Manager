import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { fitContain, containForInstagram, containForFacebook } from '../src/lib/platformImages.js'

function redImage(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ff0000' } }).png().toBuffer()
}

async function samplePixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const idx = (y * info.width + x) * info.channels
  return [data[idx], data[idx + 1], data[idx + 2]]
}

describe('platformImages — contain-fit (never crop)', () => {
  it('contains a wide image into a square with padding, keeping the whole image visible', async () => {
    const src = await redImage(400, 200)
    const out = await fitContain(src, { width: 1080, height: 1080 })
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1080)
    expect(meta.height).toBe(1080)

    const top = await samplePixel(out, 540, 10) // inside top padding
    const mid = await samplePixel(out, 540, 540) // inside the contained image
    expect(top[0]).toBeGreaterThan(200) // padding is light (white-ish)
    expect(mid[0]).toBeGreaterThan(200) // image content (red) is preserved, not cropped
    expect(mid[1]).toBeLessThan(100)
    expect(mid[2]).toBeLessThan(100)
  })

  it('produces Instagram 1:1 and Facebook 4:5 frames', async () => {
    const src = await redImage(300, 300)
    const ig = await containForInstagram(src)
    const fb = await containForFacebook(src)
    expect(await sharp(ig).metadata()).toMatchObject({ width: 1080, height: 1080 })
    expect(await sharp(fb).metadata()).toMatchObject({ width: 1080, height: 1350 })
  })
})

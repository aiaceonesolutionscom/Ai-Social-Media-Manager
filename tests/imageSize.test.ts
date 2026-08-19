import { describe, it, expect } from 'vitest'
import { parseImageSize, openaiSize, stabilityAspectRatio, geminiSizePrompt, DEFAULT_IMAGE_SIZE, type ImageSize } from '../src/lib/imageSize.js'

describe('parseImageSize', () => {
  it('defaults to 1:1 for empty or unknown text', () => {
    expect(parseImageSize(undefined)).toBe('1:1')
    expect(parseImageSize('')).toBe('1:1')
    expect(parseImageSize('make a post about coffee')).toBe('1:1')
  })

  it('detects square', () => {
    expect(parseImageSize('square image please')).toBe('1:1')
    expect(parseImageSize('use 1080x1080')).toBe('1:1')
  })

  it('detects portrait 4:5', () => {
    expect(parseImageSize('make it 4:5')).toBe('4:5')
    expect(parseImageSize('portrait')).toBe('4:5')
    expect(parseImageSize('1080x1350')).toBe('4:5')
  })

  it('detects landscape 16:9', () => {
    expect(parseImageSize('landscape')).toBe('16:9')
    expect(parseImageSize('wide 16:9')).toBe('16:9')
    expect(parseImageSize('1920x1080')).toBe('16:9')
  })

  it('detects story 9:16 before generic portrait keywords', () => {
    expect(parseImageSize('story')).toBe('9:16')
    expect(parseImageSize('reels')).toBe('9:16')
    expect(parseImageSize('vertical story 9:16')).toBe('9:16')
  })

  it('detects 3:4', () => {
    expect(parseImageSize('3:4 please')).toBe('3:4')
  })
})

describe('provider size mapping', () => {
  it('maps each ratio for openai', () => {
    expect(openaiSize('1:1')).toBe('1024x1024')
    expect(openaiSize('4:5')).toBe('1024x1536')
    expect(openaiSize('16:9')).toBe('1536x1024')
    expect(openaiSize('9:16')).toBe('1024x1792')
  })

  it('maps each ratio for stability', () => {
    expect(stabilityAspectRatio('1:1')).toBe('1:1')
    expect(stabilityAspectRatio('4:5')).toBe('4:5')
    expect(stabilityAspectRatio('16:9')).toBe('16:9')
    expect(stabilityAspectRatio('9:16')).toBe('9:16')
  })

  it('maps each ratio to a gemini prompt fragment', () => {
    expect(geminiSizePrompt('1:1')).toContain('1080x1080')
    expect(geminiSizePrompt('4:5')).toContain('4:5')
    expect(geminiSizePrompt('16:9')).toContain('16:9')
    expect(geminiSizePrompt('9:16')).toContain('9:16')
  })
})

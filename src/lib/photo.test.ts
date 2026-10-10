import { describe, expect, it } from 'vitest'
import { extensionForType, fitWithin } from './photo'

describe('fitWithin', () => {
  it('leaves a small image alone', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('scales a landscape photo by its width', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a portrait photo by its height', () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('never collapses a side to zero', () => {
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('extensionForType', () => {
  it('maps known image types', () => {
    expect(extensionForType('image/png')).toBe('png')
    expect(extensionForType('image/heic')).toBe('heic')
  })

  it('defaults to jpg', () => {
    expect(extensionForType('image/jpeg')).toBe('jpg')
    expect(extensionForType('')).toBe('jpg')
  })
})

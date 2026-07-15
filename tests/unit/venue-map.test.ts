import { describe, it, expect } from 'vitest'
import { lookupVenue, normalizeVenue, venueType } from '../../src/main/services/venue-map'

describe('venue-map lookupVenue', () => {
  it('matches conference acronyms', () => {
    expect(lookupVenue('CVPR')?.canonical).toBe('CVPR')
    expect(lookupVenue('CVPR')?.type).toBe('conference')
    expect(lookupVenue('ICLR')?.type).toBe('conference')
    expect(lookupVenue('NeurIPS')?.type).toBe('conference')
  })

  it('matches verbose conference proceedings names', () => {
    expect(lookupVenue('Proceedings of the AAAI Conference on Artificial Intelligence')?.canonical).toBe('AAAI')
    expect(lookupVenue('Proceedings of the AAAI Conference on Artificial Intelligence')?.type).toBe('conference')
    expect(lookupVenue('2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)')?.canonical).toBe('CVPR')
    expect(lookupVenue('Advances in Neural Information Processing Systems')?.canonical).toBe('NeurIPS')
  })

  it('matches journal names', () => {
    expect(lookupVenue('IEEE Transactions on Pattern Analysis and Machine Intelligence')?.type).toBe('journal')
    expect(lookupVenue('Pattern Recognition')?.type).toBe('journal')
    expect(lookupVenue('Knowledge-Based Systems')?.type).toBe('journal')
    expect(lookupVenue('Information Fusion')?.type).toBe('journal')
  })

  it('matches journal acronyms', () => {
    expect(lookupVenue('TPAMI')?.canonical).toBe('IEEE Transactions on Pattern Analysis and Machine Intelligence')
    expect(lookupVenue('TPAMI')?.type).toBe('journal')
    expect(lookupVenue('JMLR')?.canonical).toBe('Journal of Machine Learning Research')
  })

  it('returns null for unknown venue', () => {
    expect(lookupVenue('Some Random Workshop')).toBeNull()
    expect(lookupVenue('')).toBeNull()
  })

  it('matches LNCS book series as conference', () => {
    expect(lookupVenue('Lecture Notes in Computer Science')?.type).toBe('conference')
    expect(lookupVenue('LNCS')?.type).toBe('conference')
  })
})

describe('normalizeVenue', () => {
  it('normalizes verbose conference name to acronym', () => {
    expect(normalizeVenue('Proceedings of the AAAI Conference on Artificial Intelligence')).toBe('AAAI')
    expect(normalizeVenue('2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)')).toBe('CVPR')
  })

  it('keeps journal full names', () => {
    expect(normalizeVenue('IEEE Transactions on Pattern Analysis and Machine Intelligence')).toBe('IEEE Transactions on Pattern Analysis and Machine Intelligence')
    expect(normalizeVenue('Pattern Recognition')).toBe('Pattern Recognition')
  })

  it('returns original for unknown venue', () => {
    expect(normalizeVenue('Some Unknown Venue')).toBe('Some Unknown Venue')
  })
})

describe('venueType', () => {
  it('detects conference type from full name', () => {
    expect(venueType('Proceedings of the AAAI Conference on Artificial Intelligence')).toBe('conference')
    expect(venueType('2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)')).toBe('conference')
  })

  it('detects journal type from hints', () => {
    expect(venueType('Some Journal of Stuff')).toBe('journal')
    expect(venueType('IEEE Transactions on Unknown Things')).toBe('journal')
  })

  it('returns null for ambiguous unknown venue', () => {
    expect(venueType('Some Random Conference')).toBeNull()
  })
})
import { describe, it, expect } from 'vitest'
import { extractTitleFromText, isTemplateNoiseTitle, extractVenueFromText } from '../../src/main/services/metadata'

describe('extractTitleFromText', () => {
  it('returns the first plausible title line', () => {
    const text = 'Cross-view Transformers for real-time Map-view Semantic Segmentation\n Brady Zhou\n Abstract\n We present cross-view transformers.'
    expect(extractTitleFromText(text)).toBe('Cross-view Transformers for real-time Map-view Semantic Segmentation')
  })

  it('returns null when only noise lines are present', () => {
    expect(extractTitleFromText('Abstract\nWe present a method.')).toBe('We present a method.')
    expect(extractTitleFromText('arXiv\nAbstract\nhttp://example.com')).toBeNull()
  })

  it('skips arXiv header lines', () => {
    const text = 'arXiv:2301.12345v1 [cs.CV] 1 Jan 2023\nCross-view Transformers\nBrady Zhou\nAbstract'
    expect(extractTitleFromText(text)).toBe('Cross-view Transformers')
  })

  it('skips "Published as a conference paper" banner', () => {
    const text = 'Published as a conference paper at ICLR 2021\nLearning to Generate 3D Shapes\nAbstract\nWe present a model.'
    expect(extractTitleFromText(text)).toBe('Learning to Generate 3D Shapes')
  })

  it('skips "Formatting Instructions" template title', () => {
    const text = '2018 Formatting Instructions for Authors Using LaTeX\nImageNet Training in Minutes\nAbstract\nWe train models.'
    expect(extractTitleFromText(text)).toBe('ImageNet Training in Minutes')
  })

  it('skips journal running headers', () => {
    const text = 'Pattern Recognition 105 (2020) 107281\nContents lists available at ScienceDirect\nPattern Recognition\njournal homepage: www.elsevier.com/locate/patcog\nBinary neural networks: A survey\nHaotong Qin\nAbstract'
    expect(extractTitleFromText(text)).toBe('Binary neural networks: A survey')
  })

  it('skips email lines', () => {
    const text = 'Some Real Paper Title Here\nauthor@example.com\nAbstract'
    expect(extractTitleFromText(text)).toBe('Some Real Paper Title Here')
  })

  it('skips DOI lines', () => {
    const text = 'Some Real Paper Title Here\ndoi: 10.1234/foo.bar\nAbstract'
    expect(extractTitleFromText(text)).toBe('Some Real Paper Title Here')
  })

  it('skips URL lines', () => {
    const text = 'Some Real Paper Title Here\nhttp://example.com/paper\nAbstract'
    expect(extractTitleFromText(text)).toBe('Some Real Paper Title Here')
  })

  it('merges a multi-line title ending with a lowercase connector', () => {
    const text = 'Learning Rich Features from RGB-D Images for\nObject Detection and Segmentation\nSaurabh Gupta\nAbstract'
    expect(extractTitleFromText(text)).toBe('Learning Rich Features from RGB-D Images for Object Detection and Segmentation')
  })

  it('merges a title split after a colon', () => {
    const text = 'You Only Look Once:\nUnified, Real-Time Object Detection\nJoseph Redmon\nAbstract'
    expect(extractTitleFromText(text)).toBe('You Only Look Once: Unified, Real-Time Object Detection')
  })

  it('merges an ALL-CAPS title split across two lines', () => {
    const text = 'LEARNING TO GENERATE 3D SHAPES WITH\nGENERATIVE CELLULAR AUTOMATA\nDongsu Zhang\nABSTRACT'
    expect(extractTitleFromText(text)).toBe('LEARNING TO GENERATE 3D SHAPES WITH GENERATIVE CELLULAR AUTOMATA')
  })

  it('does not merge a title line followed by a body sentence', () => {
    const text = 'Arxiv Paper Title\nThis is a preprint available at arxiv:2301.12345'
    expect(extractTitleFromText(text)).toBe('Arxiv Paper Title')
  })

  it('does not merge when the title ends with a sentence terminator', () => {
    const text = 'A Complete Title Here.\nThis is a preprint available at arxiv:2301.12345'
    expect(extractTitleFromText(text)).toBe('A Complete Title Here.')
  })

  it('does not merge into an abstract-like body line', () => {
    const text = 'A Paper Title\nthis preprint is available at arxiv:2301.12345'
    expect(extractTitleFromText(text)).toBe('A Paper Title')
  })

  it('returns null for text with no plausible title line', () => {
    expect(extractTitleFromText('')).toBeNull()
    expect(extractTitleFromText('Abstract\nhttp://x.com\ndoi: 10.1/x')).toBeNull()
    expect(extractTitleFromText('short')).toBeNull()
  })
})

describe('isTemplateNoiseTitle', () => {
  it('flags LaTeX formatting-instructions titles', () => {
    expect(isTemplateNoiseTitle('2018 Formatting Instructions for Authors Using LaTeX')).toBe(true)
  })

  it('flags template/sample manuscript titles', () => {
    expect(isTemplateNoiseTitle('Sample Manuscript for Submission')).toBe(true)
    expect(isTemplateNoiseTitle('main.tex template')).toBe(true)
  })

  it('does not flag real paper titles', () => {
    expect(isTemplateNoiseTitle('ImageNet Training in Minutes')).toBe(false)
    expect(isTemplateNoiseTitle('Attention Is All You Need')).toBe(false)
  })
})

describe('extractVenueFromText', () => {
  it('extracts ICLR conference banner with year', () => {
    const text = 'Published as a conference paper at ICLR 2021\nLearning to Generate 3D Shapes\nAbstract'
    expect(extractVenueFromText(text)).toEqual({ venue: 'ICLR', year: '2021' })
  })

  it('extracts NeurIPS banner', () => {
    const text = 'Published as a conference paper at NeurIPS 2018\nSome Paper\nAbstract'
    expect(extractVenueFromText(text)).toEqual({ venue: 'NeurIPS', year: '2018' })
  })

  it('normalizes legacy NIPS to NeurIPS', () => {
    const text = 'Published as a conference paper at NIPS 2017\nSome Paper'
    expect(extractVenueFromText(text)).toEqual({ venue: 'NeurIPS', year: '2017' })
  })

  it('extracts CVPR banner', () => {
    const text = 'Published as a conference paper at CVPR 2019\nSome Paper'
    expect(extractVenueFromText(text)).toEqual({ venue: 'CVPR', year: '2019' })
  })

  it('returns null when no conference banner present', () => {
    expect(extractVenueFromText('Some Paper Title\nAbstract\nWe present a method.')).toBeNull()
  })

  it('only inspects the head of the text', () => {
    const text = 'Some Paper Title\nAbstract\nLots of body text here.\n'.repeat(20) + 'Published as a conference paper at ICLR 2021'
    expect(extractVenueFromText(text)).toBeNull()
  })
})
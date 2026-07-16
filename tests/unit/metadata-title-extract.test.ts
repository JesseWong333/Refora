import { describe, it, expect } from 'vitest'
import { extractTitleFromText, isTemplateNoiseTitle, extractVenueFromText, extractAbstractFromText, extractDoiFromText, deriveDoiFromArxivId } from '../../src/main/services/metadata'

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

  it('extracts IEEE Transactions venue without truncating title', () => {
    const text = 'IEEE TRANSACTIONS ON PATTERN ANALYSIS AND MACHINE INTELLIGENCE 1\nSome Paper\nAbstract'
    const result = extractVenueFromText(text)
    expect(result).not.toBeNull()
    expect(result!.venue).toBe('IEEE TRANSACTIONS ON PATTERN ANALYSIS AND MACHINE INTELLIGENCE')
  })

  it('extracts Under review banner', () => {
    const text = 'Under review as a conference paper at ICLR 2022\nSome Paper\nAbstract'
    expect(extractVenueFromText(text)).toEqual({ venue: 'ICLR', year: '2022' })
  })
})

describe('extractAbstractFromText', () => {
  it('extracts abstract after Abstract keyword', () => {
    const text = 'Paper Title\nAuthor Name\nAbstract\nWe present a novel method for image segmentation.\nThe method uses deep learning.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('We present a novel method for image segmentation')
  })

  it('extracts abstract with inline Abstract keyword', () => {
    const text = 'Paper Title\nAuthor Name\nAbstract We present a method for doing things.\nIt works well in practice.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('We present a method for doing things')
  })

  it('extracts ABSTRACT in all caps', () => {
    const text = 'Paper Title\nAuthor Name\nABSTRACT\nWe present a novel approach to solving problems.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('We present a novel approach')
  })

  it('stops at Keywords section', () => {
    const text = 'Title\nAuthor\nAbstract\nWe present a method.\nKeywords: deep learning, vision'
    const result = extractAbstractFromText(text)
    expect(result).toBe('We present a method.')
  })

  it('stops at Introduction section', () => {
    const text = 'Title\nAuthor\nAbstract\nWe present a method.\n1. Introduction\nIn this section we describe...'
    const result = extractAbstractFromText(text)
    expect(result).toBe('We present a method.')
  })

  it('extracts abstract from paper without Abstract keyword (structural)', () => {
    const text = 'Paper Title\nAuthor Name\nStanford University\nauthor@example.com\nWe present a novel method for image segmentation.\nThe method uses deep learning techniques.\nIt achieves state-of-the-art results.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('We present a novel method')
  })

  it('returns null for text with no abstract', () => {
    expect(extractAbstractFromText('short text')).toBeNull()
    expect(extractAbstractFromText('Title\nAuthor\nUniversity')).toBeNull()
  })

  it('does not false-positive on Introduction in abstract body', () => {
    const text = 'Title\nAuthor\nAbstract\nIntroduction to deep learning is important.\nWe present our method here.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('Introduction to deep learning')
  })

  it('does not false-positive on ACM in affiliations', () => {
    const text = 'Title\nAuthor\nACM, New York, NY, USA\nAbstract\nWe present a method for solving problems in computer vision.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('We present a method')
  })

  it('does not false-positive on Revised in abstract body', () => {
    const text = 'Title\nAuthor\nAbstract\nThis is a revised version of our previous work.\nWe improved the method significantly.'
    const result = extractAbstractFromText(text)
    expect(result).toContain('This is a revised version')
  })

  it('extracts Chinese abstract (摘要)', () => {
    const text = '论文标题\n作者\n摘要\n本文提出了一种新的方法用于图像分割。\n该方法使用深度学习技术。'
    const result = extractAbstractFromText(text)
    expect(result).toContain('本文提出了一种新的方法')
  })
})

describe('extractDoiFromText', () => {
  it('extracts DOI from text with doi: prefix', () => {
    expect(extractDoiFromText('Some text\ndoi: 10.1109/CVPR.2017.100\nmore text')).toBe('10.1109/CVPR.2017.100')
  })

  it('extracts DOI from https://doi.org/ URL', () => {
    expect(extractDoiFromText('See https://doi.org/10.1000/abc123 for details')).toBe('10.1000/abc123')
  })

  it('extracts DOI from https://dx.doi.org/ URL', () => {
    expect(extractDoiFromText('Link: https://dx.doi.org/10.1109/TPAMI.2020.123')).toBe('10.1109/TPAMI.2020.123')
  })

  it('strips trailing punctuation from DOI', () => {
    expect(extractDoiFromText('DOI: 10.1109/CVPR.2017.100.')).toBe('10.1109/CVPR.2017.100')
    expect(extractDoiFromText('DOI: 10.1109/CVPR.2017.100,')).toBe('10.1109/CVPR.2017.100')
  })

  it('returns null when no DOI in text', () => {
    expect(extractDoiFromText('No DOI here\nJust text')).toBeNull()
  })

  it('does not extract DOI from references section', () => {
    const text = 'Body text\nReferences\n1. Author, 10.1234/paper, 2020'
    expect(extractDoiFromText(text)).toBeNull()
  })
})

describe('deriveDoiFromArxivId', () => {
  it('derives DOI from arXiv ID', () => {
    expect(deriveDoiFromArxivId('2301.12345')).toBe('10.48550/arXiv.2301.12345')
  })

  it('strips version suffix from arXiv ID', () => {
    expect(deriveDoiFromArxivId('2301.12345v3')).toBe('10.48550/arXiv.2301.12345')
  })
})

describe('isTemplateNoiseTitle', () => {
  it('flags preliminary version titles', () => {
    expect(isTemplateNoiseTitle('PRELIMINARY VERSION DO NOT CITE')).toBe(true)
  })

  it('flags work in progress titles', () => {
    expect(isTemplateNoiseTitle('Work in Progress: Some Method')).toBe(true)
  })

  it('flags draft version titles', () => {
    expect(isTemplateNoiseTitle('Draft Version: Some Paper')).toBe(true)
  })

  it('does not flag real paper titles', () => {
    expect(isTemplateNoiseTitle('Mask R-CNN')).toBe(false)
    expect(isTemplateNoiseTitle('Attention Is All You Need')).toBe(false)
  })
})
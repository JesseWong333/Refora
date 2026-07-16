import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildLines,
  extractTitleCandidate,
  parsePdf,
  type TextItem,
  type LineInfo
} from '../../src/main/worker/pdf-worker'

function item(str: string, x: number, y: number, a = 10, b = 0): TextItem {
  return { str, transform: [a, b, 0, a, x, y], height: a }
}

function line(text: string, y: number, size: number): LineInfo {
  return { text, y, size }
}

describe('buildLines', () => {
  it('groups items into lines by y-coordinate', () => {
    const items = [
      item('Hello ', 10, 700, 14),
      item('World', 60, 700, 14),
      item('next line', 10, 680, 10)
    ]
    const lines = buildLines(items)
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('Hello World')
    expect(lines[0].y).toBe(700)
    expect(lines[0].size).toBe(14)
    expect(lines[1].text).toBe('next line')
  })
})

describe('extractTitleCandidate', () => {
  it('picks the largest-font line as the title', () => {
    const lines = [
      line('journal header stuff', 752, 7),
      line('The Real Paper Title', 619, 14)
    ]
    expect(extractTitleCandidate(lines)).toBe('The Real Paper Title')
  })

  it('merges consecutive title lines of the same large size', () => {
    const lines = [
      line('Learning Rich Features from RGB-D Images for', 571, 14),
      line('Object Detection and Segmentation', 553, 14),
      line('Saurabh Gupta', 519, 10)
    ]
    expect(extractTitleCandidate(lines)).toBe('Learning Rich Features from RGB-D Images for Object Detection and Segmentation')
  })

  it('merges a title split after a colon', () => {
    const lines = [
      line('You Only Look Once:', 703, 14),
      line('Unified, Real-Time Object Detection', 685, 14),
      line('Joseph Redmon', 655, 12)
    ]
    expect(extractTitleCandidate(lines)).toBe('You Only Look Once: Unified, Real-Time Object Detection')
  })

  it('ignores an arXiv header even if it is the largest font', () => {
    const lines = [
      line('arXiv:1407.5736v1 [cs.CV] 22 Jul 2014', 237, 20),
      line('Learning Rich Features from RGB-D Images for', 571, 14),
      line('Object Detection and Segmentation', 553, 14),
      line('Saurabh Gupta', 519, 10)
    ]
    expect(extractTitleCandidate(lines)).toBe('Learning Rich Features from RGB-D Images for Object Detection and Segmentation')
  })

  it('ignores a "Published as a conference paper" banner', () => {
    const lines = [
      line('Published as a conference paper at ICLR 2021', 757, 10),
      line('LEARNING TO GENERATE 3D SHAPES WITH', 699, 17),
      line('GENERATIVE CELLULAR AUTOMATA', 679, 17),
      line('Dongsu Zhang', 648, 10)
    ]
    expect(extractTitleCandidate(lines)).toBe('LEARNING TO GENERATE 3D SHAPES WITH GENERATIVE CELLULAR AUTOMATA')
  })

  it('skips an Elsevier journal header to reach the real title of same size', () => {
    const lines = [
      line('Knowledge-Based Systems 216 (2021) 106775', 752, 7),
      line('Contents lists available at ScienceDirect', 725, 8),
      line('Knowledge-Based Systems', 696, 14),
      line('journal homepage: www.elsevier.com/locate/knosys', 670, 8),
      line('A survey on federated learning', 619, 14),
      line('Chen Zhang', 598, 11)
    ]
    expect(extractTitleCandidate(lines)).toBe('A survey on federated learning')
  })

  it('skips "Formatting Instructions" template banner', () => {
    const lines = [
      line('2018 Formatting Instructions for Authors Using LaTeX', 700, 14),
      line('ImageNet Training in Minutes', 650, 14)
    ]
    expect(extractTitleCandidate(lines)).toBe('ImageNet Training in Minutes')
  })

  it('skips a running header above the real title', () => {
    const lines = [
      line('AYUB ET AL.: CBCL FOR RGB-D INDOOR SCENE CLASSIFICATION 1', 599, 9),
      line('Centroid Based Concept Learning for RGB-D', 561, 17),
      line('Indoor Scene Classification', 539, 17),
      line('Ali Ayub', 512, 10)
    ]
    expect(extractTitleCandidate(lines)).toBe('Centroid Based Concept Learning for RGB-D Indoor Scene Classification')
  })

  it('returns null for empty input', () => {
    expect(extractTitleCandidate([])).toBeNull()
  })

  it('returns null when all candidate lines are noise', () => {
    const lines = [
      line('Abstract', 700, 14),
      line('arXiv:1234.5678', 680, 20)
    ]
    expect(extractTitleCandidate(lines)).toBeNull()
  })

  it('returns null when the only title-sized line is too short', () => {
    const lines = [
      line('Hi', 700, 14),
      line('body text here that is long enough to be normal', 680, 10)
    ]
    expect(extractTitleCandidate(lines)).toBeNull()
  })
})

describe('parsePdf', () => {
  it('extracts text from a real PDF fixture', async () => {
    const result = await parsePdf(resolve('tests/fixtures/valid.pdf'), 1)

    expect(result.text.trim().length).toBeGreaterThan(0)
  })
})

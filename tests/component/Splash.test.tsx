import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Splash from '../../src/renderer/components/Splash'

afterEach(cleanup)

describe('Splash', () => {
  it('renders without crashing', () => {
    const { container } = render(<Splash />)
    expect(container.firstChild).not.toBeNull()
  })

  it('contains a spinner element', () => {
    const { container } = render(<Splash />)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })
})

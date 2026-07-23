import type { PaperLocator } from '../../shared/academicResearch'
import type { AcademicIdentityService } from './academicIdentityService'
import type { SemanticScholarClient } from './semanticScholarClient'

export function createAcademicGraphService(
  identityService: AcademicIdentityService,
  semanticScholarClient: SemanticScholarClient
) {
  async function getCitingPapers(
    locator: PaperLocator,
    cursor?: string,
    limit?: number,
    signal?: AbortSignal,
    filters?: { publishedAfter?: string }
  ) {
    const identity = await identityService.resolve(locator, signal)
    return semanticScholarClient.getCitingPapers(
      identityService.toSemanticScholarLocator(identity),
      cursor,
      limit,
      signal,
      filters
    )
  }

  async function getReferencedPapers(
    locator: PaperLocator,
    cursor?: string,
    limit?: number,
    signal?: AbortSignal,
    filters?: { publishedAfter?: string }
  ) {
    const identity = await identityService.resolve(locator, signal)
    return semanticScholarClient.getReferencedPapers(
      identityService.toSemanticScholarLocator(identity),
      cursor,
      limit,
      signal,
      filters
    )
  }

  async function getRecommendations(
    locator: PaperLocator,
    limit?: number,
    signal?: AbortSignal
  ) {
    const identity = await identityService.resolve(locator, signal)
    return semanticScholarClient.getRecommendations(
      identityService.toSemanticScholarLocator(identity),
      limit,
      signal
    )
  }

  return { getCitingPapers, getReferencedPapers, getRecommendations }
}

export type AcademicGraphService = ReturnType<typeof createAcademicGraphService>

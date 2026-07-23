import type { Repositories } from '../db/repositories'
import type { PaperIdentity, PaperLocator } from '../../shared/academicResearch'
import { baseArxivId, normalizeArxivId } from './arxiv'
import type { SemanticScholarClient } from './semanticScholarClient'
import { SemanticScholarError } from './semanticScholarClient'

export class AcademicIdentityError extends Error {
  constructor(
    readonly code:
      | 'document_not_found'
      | 'identity_unresolvable'
      | 'identity_conflict'
      | 'invalid_locator',
    message: string
  ) {
    super(message)
    this.name = 'AcademicIdentityError'
  }
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:\s*/i, '')
    .toLowerCase()
  return normalized || null
}

function splitAuthors(value: string | null | undefined): Array<{ name: string }> {
  return (value ?? '')
    .split(';')
    .map((author) => author.trim())
    .filter(Boolean)
    .map((name) => ({ name }))
}

export function createAcademicIdentityService(
  repos: Repositories,
  semanticScholarClient: SemanticScholarClient
) {
  async function resolve(locator: PaperLocator, signal?: AbortSignal): Promise<PaperIdentity> {
    if (locator.type !== 'document_id') {
      return semanticScholarClient.getPaper(locator, signal)
    }

    const documentId = locator.value.trim()
    const document = repos.documents.get(documentId)
    if (!document) {
      throw new AcademicIdentityError('document_not_found', 'Document was not found')
    }
    const arxivId = document.arxivId ? normalizeArxivId(document.arxivId) : null
    const doi = normalizeDoi(document.doi)
    const providerLocator: PaperLocator | null = arxivId
      ? { type: 'arxiv_id', value: arxivId }
      : doi
        ? { type: 'doi', value: doi }
        : null

    if (!providerLocator) {
      const title = document.title ?? document.fileName
      return {
        canonicalId: `document:${documentId}`,
        title,
        authors: splitAuthors(document.authors),
        year: Number.parseInt(document.year ?? '', 10) || undefined,
        abstract: document.abstract ?? undefined,
        venue: document.venue ?? undefined,
        matchStatus: 'exact',
        evidence: [{
          provider: 'local',
          identifier: documentId,
          matchedBy: 'document_id'
        }]
      }
    }

    let resolved: PaperIdentity
    try {
      resolved = await semanticScholarClient.getPaper(providerLocator, signal)
    } catch (error) {
      if (!(error instanceof SemanticScholarError) || error.code !== 'paper_not_found') throw error
      const title = document.title ?? document.fileName
      return {
        canonicalId: arxivId
          ? `arxiv:${baseArxivId(arxivId).toLowerCase()}`
          : `doi:${doi}`,
        arxivId: arxivId ?? undefined,
        doi: doi ?? undefined,
        title,
        authors: splitAuthors(document.authors),
        year: Number.parseInt(document.year ?? '', 10) || undefined,
        abstract: document.abstract ?? undefined,
        venue: document.venue ?? undefined,
        matchStatus: 'verified',
        evidence: [{
          provider: 'local',
          identifier: documentId,
          matchedBy: providerLocator.type
        }]
      }
    }

    if (
      arxivId &&
      resolved.arxivId &&
      baseArxivId(arxivId).toLowerCase() !== baseArxivId(resolved.arxivId).toLowerCase()
    ) {
      throw new AcademicIdentityError('identity_conflict', 'Resolved arXiv ID conflicts with document')
    }
    if (doi && resolved.doi && doi !== normalizeDoi(resolved.doi)) {
      throw new AcademicIdentityError('identity_conflict', 'Resolved DOI conflicts with document')
    }
    return {
      ...resolved,
      matchStatus: 'verified',
      evidence: [
        ...resolved.evidence,
        {
          provider: 'local',
          identifier: documentId,
          matchedBy: providerLocator.type
        }
      ]
    }
  }

  function toSemanticScholarLocator(identity: PaperIdentity): PaperLocator {
    if (identity.semanticScholarPaperId) {
      return { type: 's2_paper_id', value: identity.semanticScholarPaperId }
    }
    if (identity.arxivId) return { type: 'arxiv_id', value: identity.arxivId }
    if (identity.doi) return { type: 'doi', value: identity.doi }
    if (identity.semanticScholarCorpusId !== undefined) {
      return { type: 's2_corpus_id', value: String(identity.semanticScholarCorpusId) }
    }
    throw new AcademicIdentityError(
      'identity_unresolvable',
      'Paper has no Semantic Scholar-compatible identifier'
    )
  }

  function localDocumentId(identity: PaperIdentity): string | null {
    const arxivId = identity.arxivId
      ? baseArxivId(identity.arxivId).toLowerCase()
      : null
    const doi = normalizeDoi(identity.doi)
    const match = repos.documents.list({ mode: 'all' }).find((document) => {
      const documentArxiv = document.arxivId
        ? normalizeArxivId(document.arxivId)
        : null
      if (
        arxivId &&
        documentArxiv &&
        baseArxivId(documentArxiv).toLowerCase() === arxivId
      ) {
        return true
      }
      return doi !== null && normalizeDoi(document.doi) === doi
    })
    return match?.id ?? null
  }

  return { resolve, toSemanticScholarLocator, localDocumentId }
}

export type AcademicIdentityService = ReturnType<typeof createAcademicIdentityService>

import { sha256Hex } from '@/server/auth/crypto';
import type { ArchiveMetadata } from '@/types/archive';

export interface ArchiveTaxonomyTerm { id: string; kind: 'category' | 'tag'; name: string }

export async function archiveTaxonomyIds(metadata: ArchiveMetadata): Promise<ArchiveTaxonomyTerm[]> {
  const terms = [
    ...metadata.categories.map((name) => ({ kind: 'category' as const, name })),
    ...metadata.tags.map((name) => ({ kind: 'tag' as const, name }))
  ];
  return Promise.all(terms.map(async (term) => ({ ...term, id: 'tax_' + await sha256Hex(JSON.stringify([term.kind, term.name])) })));
}

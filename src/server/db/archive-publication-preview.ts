import { queryOne } from '@/server/db/client';

export interface PublicationSnapshotRow {
  snapshotJson: string;
  snapshotLength: number;
  contentLength: number;
  contentHasNull: number;
  conflictState: 'none' | 'pending';
}

// 0007 supplies the same canonical JSON for previews and transaction-time CAS.
// Never accept truncated JSON; the service rejects length > 200000 before parsing.
export function findArchivePublicationPreview(db: D1Database, archiveId: string, publicationId: string) {
  return queryOne<PublicationSnapshotRow>(db,
    'SELECT substr(v.snapshot_json, 1, 200001) AS snapshotJson, length(v.snapshot_json) AS snapshotLength, ' +
    'length(b.content) AS contentLength, instr(b.content, char(0)) AS contentHasNull, a.conflict_state AS conflictState ' +
    'FROM archive_publication_snapshots v JOIN archive_publications p ON p.id = v.publication_id ' +
    'JOIN posts b ON b.id = p.post_id JOIN archives a ON a.id = p.archive_id ' +
    'JOIN archive_sources s ON s.id = a.source_id ' +
    'WHERE p.archive_id = ? AND p.id = ? AND p.deleted_at IS NULL AND b.deleted_at IS NULL ' +
    'AND a.deleted_at IS NULL AND s.deleted_at IS NULL LIMIT 1', [archiveId, publicationId]);
}

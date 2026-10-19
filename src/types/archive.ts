/** Private API DTOs; never include database rows, storage keys or rendered HTML. */
export interface ArchiveMetadata {
  categories: string[];
  tags: string[];
}

export interface ArchiveSummary {
  id: string;
  title: string;
  snippet: string;
  sourceId: string;
  sourceName: string;
  sourceDocId: string;
  conflictState: 'none' | 'pending';
  version: number;
  updatedAt: string;
}

export interface ArchiveVersion {
  id: string;
  archiveId: string;
  sequence: number;
  parentId: string | null;
  kind: 'import' | 'edit' | 'restore' | 'resolution';
  title: string;
  content: string;
  metadata: ArchiveMetadata;
  restoredFrom: string | null;
  basedOnSource: string | null;
  createdAt: string;
  createdBy: string;
  reason: string;
}

export interface ArchiveDetail extends ArchiveSummary {
  sourceUrl: string;
  currentVersion: ArchiveVersion;
  acceptedSourceVersionId: string | null;
  latestSourceVersionId: string | null;
}

export interface ArchivePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Diff text is inert; the admin UI must escape it, including HTML-looking Markdown. */
export interface ArchiveDiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ArchiveDiff {
  archiveId: string;
  from: { id: string; sequence: number; title: string; metadata: ArchiveMetadata };
  to: { id: string; sequence: number; title: string; metadata: ArchiveMetadata };
  titleChanged: boolean;
  metadataChanged: boolean;
  lines: ArchiveDiffLine[];
  added: number;
  removed: number;
}

/** Association is permanent, including after a blog draft is soft-deleted. */
export interface ArchivePublication {
  id: string;
  archiveId: string;
  versionId: string;
  postId: string;
  postStatus: 'draft' | 'published';
  postDeleted: boolean;
  createdAt: string;
}

/** Read-only review snapshot, never a publication approval or a reusable publish token. */
export interface ArchivePublicationSnapshot {
  publicationId: string;
  archiveId: string;
  sourceVersionId: string;
  postId: string;
  postVersion: number;
  status: 'draft' | 'published';
  title: string;
  slug: string;
  summary: string;
  content: string;
  coverImage: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  wordCount: number;
  categories: Array<{ id: string; name: string; slug: string }>;
  tags: Array<{ id: string; name: string; slug: string }>;
}

export interface ArchivePublicationReference {
  kind: 'link' | 'image' | 'cover' | 'avatar' | 'html';
  value: string;
  verdict: 'blocked' | 'review';
  reason: string;
}

export interface ArchivePublicationPreview {
  snapshot: ArchivePublicationSnapshot;
  snapshotHash: string;
  policyVersion: string;
  references: ArchivePublicationReference[];
  blockers: string[];
  publishingEnabled: boolean;
  previewToken: string | null;
  expiresAt: string | null;
}

export interface ArchivePublicationConfirmation {
  confirmationId: string;
  publicationId: string;
  postId: string;
  confirmedPostVersion: number;
  confirmedAt: string;
  postStatus: 'draft' | 'published';
  postDeleted: boolean;
  replayed: boolean;
}

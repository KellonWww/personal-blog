export const POST_BATCH_LIMIT = 50;
export type PostBatchAction = 'publish' | 'draft' | 'delete' | 'categories' | 'tags';
export interface PostBatchInput {
  ids: string[];
  action: PostBatchAction;
  taxonomyIds?: string[];
}
export interface PostBatchResult { affected: number }
export interface PostArchiveResult {
  items: Array<{ postId: string; archiveId: string; action: 'created' | 'existing' }>;
}
export interface PostTaxonomy {
  categories: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
}

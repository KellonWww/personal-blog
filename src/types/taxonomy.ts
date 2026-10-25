export type TaxonomyKind = 'categories' | 'tags';
export interface TaxonomyTerm {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  parentId: string;
  postCount: number;
  version: number;
}
export interface TaxonomyInput {
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
}

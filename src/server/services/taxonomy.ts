import { findManagedTerm, findTaxonomyConflict, hasTaxonomyChildren, taxonomyArchiveSupport, taxonomyIsProtected, taxonomyMutationStatements } from '@/server/db/taxonomy';
import { TaxonomyError } from '@/server/services/taxonomy-model';
import type { TaxonomyInput, TaxonomyKind } from '@/types/taxonomy';

export async function mutateTaxonomy(db: D1Database, options: {
  kind: TaxonomyKind; id?: string; operator: string; version?: number; input?: TaxonomyInput;
}) {
  const { kind, version, input, operator } = options;
  const id = options.id ?? crypto.randomUUID();
  const archiveSupport = options.id ? await taxonomyArchiveSupport(db) : false;
  if (options.id) {
    const current = await findManagedTerm(db, kind, id);
    if (!current) throw new TaxonomyError('TAXONOMY_NOT_FOUND', '分类或标签不存在或已删除', 404);
    if (current.version !== version) throw new TaxonomyError('TAXONOMY_STALE', '分类或标签已被修改，请刷新列表后重试');
    if (archiveSupport && await taxonomyIsProtected(db, kind, id)) {
      throw new TaxonomyError('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED', '此项被已发布的档案关联稿使用，请先撤回相关稿件再修改或删除');
    }
  }
  if (input && await findTaxonomyConflict(db, kind, input, id)) {
    throw new TaxonomyError('TAXONOMY_CONFLICT', '同类型的名称或路径已存在，请换一个');
  }
  if (!input && kind === 'categories' && await hasTaxonomyChildren(db, id)) {
    throw new TaxonomyError('TAXONOMY_HAS_CHILDREN', '此分类还有子分类，请先处理子分类');
  }
  try {
    await db.batch(taxonomyMutationStatements(db, { kind, id, operator, version, input, archiveSupport }));
  } catch {
    // Driver errors may include SQL; the caller must refresh rather than expose raw failures.
    throw new TaxonomyError('TAXONOMY_RECHECK', '保存结果待核对，名称、路径或关联状态可能已变化，请刷新列表核对后重试');
  }
  return { id };
}

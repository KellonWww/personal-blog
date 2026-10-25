import { z } from 'zod';

export const MAX_FRIENDS = 100;
export const FRIENDS_ERROR = '友链最多 100 项，请填写名称（最多 100 字）、有效的 http(s) 地址（最多 500 字）和简介（最多 500 字）';

export const friendSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().max(500).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }),
  desc: z.string().trim().max(500).optional()
});
export const friendsSchema = z.array(friendSchema).max(MAX_FRIENDS);
export type FriendLink = z.infer<typeof friendSchema>;

export function parseFriends(value: string): FriendLink[] {
  try { return friendsSchema.parse(JSON.parse(value)); }
  catch { throw new Error(FRIENDS_ERROR); }
}

// Legacy settings may contain malformed entries; never render unsafe link protocols.
export function publicFriends(value: string): FriendLink[] {
  let items: unknown;
  try { items = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_FRIENDS).flatMap((item) => {
    const parsed = friendSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

import type { User } from "@supabase/supabase-js";
import type { createServiceClient } from "@/lib/supabase/service";

const ADMIN_LIST_PAGE_SIZE = 1000;

type DbError = { message: string };
type RangeResult<T> = { data: T[] | null; error: DbError | null };
type Rangeable<T> = {
  range: (from: number, to: number) => PromiseLike<RangeResult<T>>;
};

/**
 * Supabase caps unranged table selects at the project max-row setting. The
 * admin user list must include newly invited users even after the table grows
 * past that cap, so every backing table read goes through explicit ranges.
 */
export async function listAllAdminRows<T>(
  buildQuery: () => Rangeable<T>,
  pageSize: number = ADMIN_LIST_PAGE_SIZE
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`listAllAdminRows: pageSize must be a positive integer, got ${pageSize}`);
  }

  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

export async function listAllAuthUsers(service: ReturnType<typeof createServiceClient>) {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const result = await service.auth.admin.listUsers({ page, perPage: ADMIN_LIST_PAGE_SIZE });
    if (result.error) {
      throw result.error;
    }
    users.push(...result.data.users);
    if (result.data.users.length < ADMIN_LIST_PAGE_SIZE) break;
  }
  return users;
}

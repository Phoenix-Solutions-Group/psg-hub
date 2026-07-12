import type { GrantRow, ModuleRow } from "@/lib/ops/modules";

export type MatrixData = {
  modules: ModuleRow[];
  grants: GrantRow[];
};

type ModuleMatrixLoader = {
  readFromService: () => Promise<MatrixData>;
  seedWithService: () => Promise<void>;
  readFromUser: () => Promise<MatrixData>;
  seedWithUser: () => Promise<void>;
  log?: (message: string, error: unknown) => void;
};

async function ensureSeeded(
  read: () => Promise<MatrixData>,
  seed: () => Promise<void>
): Promise<MatrixData> {
  const matrix = await read();
  if (matrix.modules.length > 0) return matrix;

  await seed();
  return read();
}

export async function loadModuleMatrix({
  readFromService,
  seedWithService,
  readFromUser,
  seedWithUser,
  log = console.error,
}: ModuleMatrixLoader): Promise<MatrixData> {
  try {
    const serviceMatrix = await ensureSeeded(readFromService, seedWithService);
    if (serviceMatrix.modules.length > 0) return serviceMatrix;
  } catch (error) {
    log("[ops/admin/modules] service-role load failed; falling back to user session", error);
  }

  const userMatrix = await readFromUser();
  if (userMatrix.modules.length > 0) return userMatrix;

  try {
    return await ensureSeeded(readFromUser, seedWithUser);
  } catch (error) {
    log("[ops/admin/modules] user-session seed failed; rendering empty registry", error);
    return userMatrix;
  }
}

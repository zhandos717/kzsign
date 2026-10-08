import type { createKeystore, Storage } from "./keystore";

export async function handlePopupMessage(_msg: unknown, _deps: { keystore: ReturnType<typeof createKeystore>; storage: Storage }): Promise<unknown> {
  return { error: "UNKNOWN" };
}

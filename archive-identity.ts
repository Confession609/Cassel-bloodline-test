export function normalizeArchiveName(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function archiveIdentity(name: string, birthDate: string) {
  return `${normalizeArchiveName(name)}::${birthDate}`;
}

export function readArchiveIdentity(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const birthDate = typeof body.birthDate === "string" ? body.birthDate : "";
  if (!name || name.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new Error("档案称呼或出生日期无效。");
  }
  return { name, birthDate };
}

export async function makeArchiveKey(name: string, birthDate: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(archiveIdentity(name, birthDate))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

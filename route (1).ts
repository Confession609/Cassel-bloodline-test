import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { archiveRecords } from "../../../../db/schema";
import { makeArchiveKey, readArchiveIdentity } from "../../../../lib/archive-identity";

export async function POST(request: Request) {
  let identity: { name: string; birthDate: string };
  try {
    identity = readArchiveIdentity(await request.json());
  } catch {
    return Response.json({ error: "档案称呼或出生日期无效。" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const key = await makeArchiveKey(identity.name, identity.birthDate);
    const records = await getDb().select({ id: archiveRecords.id }).from(archiveRecords).where(eq(archiveRecords.archiveKey, key)).limit(1);
    return Response.json({ exists: records.length > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "云端档案查询失败，请重试。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

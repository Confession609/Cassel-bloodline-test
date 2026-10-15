import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { archiveRecords } from "../../../db/schema";
import { makeArchiveKey, readArchiveIdentity } from "../../../lib/archive-identity";

const COOKIE_NAME = "dragon_archive_admin";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? "";
  return header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

function base64UrlToText(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function isAdmin(request: Request) {
  const secret = env.ARCHIVE_SESSION_SECRET ?? env.ARCHIVE_ADMIN_PASSWORD;
  const token = readCookie(request, COOKIE_NAME);
  if (!secret || !token) return false;
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return false;
  try {
    const payload = base64UrlToText(payloadPart);
    const [expiresAt] = payload.split(".");
    if (!expiresAt || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
    return (await sign(payload, secret)) === signature;
  } catch {
    return false;
  }
}

function validText(value: unknown, max = 300): value is string {
  return typeof value === "string" && value.trim().length <= max;
}

function readPayload(body: Record<string, unknown>) {
  const { name, birthDate } = readArchiveIdentity(body);
  if (!["grade", "gradeLabel", "dominant", "spell", "character"].every((key) => validText(body[key], 120))) throw new Error("档案结果字段无效。");
  const numberFields = ["score", "compositeScore"];
  if (!numberFields.every((key) => typeof body[key] === "number" && Number.isFinite(body[key]))) throw new Error("档案分数字段无效。");
  const performancePercent = body.performancePercent === null ? null : typeof body.performancePercent === "number" && Number.isFinite(body.performancePercent) ? body.performancePercent : null;
  return {
    name, birthDate, location: typeof body.location === "string" ? body.location.trim().slice(0, 120) : "",
    grade: body.grade as string, gradeLabel: body.gradeLabel as string, score: Math.round(body.score as number), compositeScore: Math.round(body.compositeScore as number), performancePercent,
    dominant: body.dominant as string, spell: body.spell as string, character: body.character as string,
    hiddenTriggered: body.hiddenTriggered === true, specialName: typeof body.specialName === "string" ? body.specialName.slice(0, 120) : null, specialQuote: typeof body.specialQuote === "string" ? body.specialQuote.slice(0, 300) : null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const payload = readPayload(body);
    const archiveMode = body.archiveMode ?? "new";
    if (archiveMode !== "new" && archiveMode !== "retest") throw new Error("档案保存方式无效。");
    if (body.submissionId !== undefined && (typeof body.submissionId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.submissionId))) {
      throw new Error("档案提交编号无效。");
    }
    const db = getDb();
    const archiveKey = await makeArchiveKey(payload.name, payload.birthDate);
    const now = new Date().toISOString();
    // A stable submission ID makes retries safe if a successful response is lost.
    const id = `DRG-${(body.submissionId as string | undefined ?? crypto.randomUUID()).toUpperCase()}`;
    const insert = db.insert(archiveRecords).values({ id, archiveKey, ...payload, createdAt: now, updatedAt: now });
    if (archiveMode === "retest") {
      await insert.onConflictDoUpdate({ target: archiveRecords.archiveKey, set: { ...payload, updatedAt: now } });
    } else {
      const inserted = await insert.onConflictDoNothing({ target: archiveRecords.archiveKey }).returning({ id: archiveRecords.id });
      if (inserted.length === 0) {
        const [existing] = await db.select({ id: archiveRecords.id }).from(archiveRecords).where(eq(archiveRecords.archiveKey, archiveKey)).limit(1);
        if (!existing || existing.id !== id) {
          return Response.json({ code: "IDENTITY_CONFLICT", error: "发现相同ID和生日的档案，请先确认是否为血统重测人。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
        }
      }
    }
    return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "档案保存失败。" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) return Response.json({ error: "需要管理员权限。" }, { status: 401 });
  try {
    const records = await getDb().select().from(archiveRecords).orderBy(desc(archiveRecords.updatedAt));
    return Response.json({ records }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "档案读取失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) return Response.json({ error: "需要管理员权限。" }, { status: 401 });
  try {
    const body = await request.json() as { id?: string };
    if (!body.id || body.id.length > 80) return Response.json({ error: "档案编号无效。" }, { status: 400 });
    await getDb().delete(archiveRecords).where(eq(archiveRecords.id, body.id));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "档案删除失败。" }, { status: 500 });
  }
}

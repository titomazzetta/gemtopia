import type { NextRequest } from "next/server";
import { destroySession, verifyCsrf } from "@/lib/session";
import { forbidden, json, originAllowed } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST-only and CSRF-checked: logout is a state change like any other. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return forbidden();
  if (!(await verifyCsrf(request))) return forbidden();

  await destroySession();
  return json({ ok: true });
}

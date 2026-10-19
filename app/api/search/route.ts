import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { search } from "@/lib/search";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hits = await search(user, request.nextUrl.searchParams.get("q") ?? "");
  return NextResponse.json({ hits });
}

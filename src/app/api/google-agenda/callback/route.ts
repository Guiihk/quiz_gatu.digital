import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSignedIn } from "../../../actions";
import { connectGoogle, googleOAuthConfig } from "../../../../lib/google-calendar";

export async function GET(request: NextRequest) {
  const settings = googleOAuthConfig();
  if (!settings) return new NextResponse("Google Agenda não configurado.", { status: 503 });
  const jar = await cookies();
  const cookie = jar.get("agenda_google_oauth")?.value ?? "";
  const [state, verifier] = cookie.split(".");
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const destination = new URL("/?agenda=1&google=error", settings.origin);
  if (await isSignedIn() && state && state === returnedState && /^[\w-]{43}$/.test(verifier ?? "") && code && code.length < 4096) {
    try {
      await connectGoogle(code, verifier);
      destination.searchParams.set("google", "connected");
    } catch { /* Show a generic connection error without exposing OAuth credentials. */ }
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set("agenda_google_oauth", "", {
    path: "/api/google-agenda/callback", maxAge: 0, httpOnly: true, sameSite: "lax", secure: settings.origin.startsWith("https:"),
  });
  return response;
}

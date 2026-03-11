import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getCurrentDivision, saveDivisionTokens } from "@/lib/exact";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No authorization code" }, { status: 400 });
  }

  try {
    const tokens = await exchangeCode(code);

    // Get the current division for this user
    const division = await getCurrentDivision(tokens.access_token);

    // Save tokens for this division
    await saveDivisionTokens(
      division,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in
    );

    // Redirect to settings page with success
    return NextResponse.redirect(
      new URL(`/instellingen?connected=${division}`, request.url)
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/instellingen?error=oauth_failed", request.url)
    );
  }
}

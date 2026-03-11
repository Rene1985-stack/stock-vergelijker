import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getCurrentDivision, saveTokens } from "@/lib/exact";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Check if Exact Online returned an error
  const errorParam = request.nextUrl.searchParams.get("error");
  if (errorParam) {
    console.error("Exact Online OAuth error:", errorParam);
    return NextResponse.redirect(
      new URL(`/instellingen?error=${encodeURIComponent("Exact Online: " + errorParam)}`, request.url)
    );
  }

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/instellingen?error=no_authorization_code", request.url)
    );
  }

  try {
    const tokens = await exchangeCode(code);
    const division = await getCurrentDivision(tokens.access_token);

    // Save single token set (works for all divisions)
    await saveTokens(
      division,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in
    );

    return NextResponse.redirect(
      new URL(`/instellingen?connected=true`, request.url)
    );
  } catch (error) {
    console.error("OAuth callback error:", error instanceof Error ? error.message : error);
    const errorMsg = error instanceof Error ? encodeURIComponent(error.message) : "oauth_failed";
    return NextResponse.redirect(
      new URL(`/instellingen?error=${errorMsg}`, request.url)
    );
  }
}

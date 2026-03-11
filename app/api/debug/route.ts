import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { exactTokens } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXACT_BASE_URL = "https://start.exactonline.nl";

export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    // Step 1: Read current token from DB
    const rows = await getDb().select().from(exactTokens);
    const token = rows[0];
    if (!token) {
      return NextResponse.json({ error: "No token stored" });
    }
    steps.step1_token = {
      id: token.id,
      division: token.division,
      expiresAt: token.expiresAt?.toISOString(),
      now: new Date().toISOString(),
      isExpired: token.expiresAt ? token.expiresAt < new Date() : "unknown",
      accessTokenPrefix: token.accessToken?.substring(0, 20),
    };

    // Step 2: Try the current access token against Exact API
    const testRes = await fetch(`${EXACT_BASE_URL}/api/v1/current/Me?$select=CurrentDivision`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
    });
    steps.step2_currentTokenTest = {
      status: testRes.status,
      body: testRes.ok ? await testRes.json() : await testRes.text(),
    };

    // Step 3: If 401, try refreshing
    if (testRes.status === 401) {
      const refreshRes = await fetch(`${EXACT_BASE_URL}/api/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken || "",
          client_id: process.env.EXACT_CLIENT_ID!,
          client_secret: process.env.EXACT_CLIENT_SECRET!,
        }),
      });

      steps.step3_refreshStatus = refreshRes.status;

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        steps.step3_refreshResult = {
          hasAccessToken: !!data.access_token,
          accessTokenLen: data.access_token?.length,
          hasRefreshToken: !!data.refresh_token,
          expiresIn: data.expires_in,
        };

        // Save the new tokens
        const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);
        await getDb()
          .update(exactTokens)
          .set({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: newExpiresAt,
            updatedAt: new Date(),
          })
          .where(eq(exactTokens.id, token.id));

        steps.step3_savedNewExpiry = newExpiresAt.toISOString();

        // Step 4: Test new token
        const testRes2 = await fetch(`${EXACT_BASE_URL}/api/v1/current/Me?$select=CurrentDivision`, {
          headers: { Authorization: `Bearer ${data.access_token}`, Accept: "application/json" },
        });
        steps.step4_newTokenTest = {
          status: testRes2.status,
          body: testRes2.ok ? await testRes2.json() : await testRes2.text(),
        };
      } else {
        const errText = await refreshRes.text();
        steps.step3_refreshError = errText;
      }
    }

    return NextResponse.json(steps);
  } catch (error) {
    return NextResponse.json({
      steps,
      error: error instanceof Error ? error.message : "Unknown",
    }, { status: 500 });
  }
}

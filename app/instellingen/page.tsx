"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TokenInfo {
  division: number;
  expiresAt: string | null;
  updatedAt: string | null;
}

export default function InstellingenPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Laden...</p></div>}>
      <InstellingenPage />
    </Suspense>
  );
}

function InstellingenPage() {
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const error = searchParams.get("error");

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [picqerStatus, setPicqerStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    // Fetch Exact tokens
    fetch("/api/exact/token")
      .then((res) => res.json())
      .then((data) => {
        setTokens(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Test Picqer connection
    fetch("/api/picqer/warehouses")
      .then((res) => {
        setPicqerStatus(res.ok ? "ok" : "error");
      })
      .catch(() => setPicqerStatus("error"));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Instellingen</h1>

      {connected && (
        <div className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800">
          Exact Online divisie {connected} succesvol verbonden!
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
          Verbinding met Exact Online mislukt. Probeer het opnieuw.
        </div>
      )}

      <div className="grid gap-6">
        {/* Picqer connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Picqer
              {picqerStatus === "checking" && (
                <Badge variant="outline">Controleren...</Badge>
              )}
              {picqerStatus === "ok" && (
                <Badge className="bg-green-100 text-green-800">Verbonden</Badge>
              )}
              {picqerStatus === "error" && (
                <Badge variant="destructive">Niet verbonden</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Picqer WMS API connectie. Configureer via environment variables.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Stel <code className="bg-muted px-1 rounded">PICQER_API_KEY</code> en{" "}
              <code className="bg-muted px-1 rounded">PICQER_BASE_URL</code> in als
              environment variables in Vercel.
            </p>
          </CardContent>
        </Card>

        {/* Exact Online connection */}
        <Card>
          <CardHeader>
            <CardTitle>Exact Online</CardTitle>
            <CardDescription>
              OAuth2 connectie per administratie/divisie. Klik op verbinden om een
              nieuwe divisie te koppelen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <a href="/api/exact/auth">
                <Button>Verbind met Exact Online</Button>
              </a>

              {loading ? (
                <p className="text-muted-foreground text-sm">Laden...</p>
              ) : tokens.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Verbonden divisies:</p>
                  {tokens.map((t) => (
                    <div
                      key={t.division}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <span className="font-mono font-medium">
                          Divisie {t.division}
                        </span>
                        {t.updatedAt && (
                          <span className="text-sm text-muted-foreground ml-2">
                            Laatst vernieuwd:{" "}
                            {new Date(t.updatedAt).toLocaleString("nl-NL")}
                          </span>
                        )}
                      </div>
                      <Badge className="bg-green-100 text-green-800">Actief</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nog geen divisies verbonden. Klik hierboven om te verbinden.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

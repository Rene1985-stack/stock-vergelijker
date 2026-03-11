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

interface TokenStatus {
  connected: boolean;
  division: number | null;
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

  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [picqerStatus, setPicqerStatus] = useState<"checking" | "ok" | "error">("checking");
  const [picqerError, setPicqerError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/exact/token")
      .then((res) => res.json())
      .then((data) => {
        setTokenStatus(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/picqer/warehouses")
      .then(async (res) => {
        if (res.ok) {
          setPicqerStatus("ok");
        } else {
          const data = await res.json().catch(() => ({}));
          setPicqerError(data.error || `HTTP ${res.status}`);
          setPicqerStatus("error");
        }
      })
      .catch((err) => {
        setPicqerError(err.message);
        setPicqerStatus("error");
      });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Instellingen</h1>

      {connected && (
        <div className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800">
          Exact Online succesvol verbonden!
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
          Verbinding met Exact Online mislukt: {decodeURIComponent(error)}
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
            {picqerError && (
              <p className="text-sm text-red-600 mb-2">{picqerError}</p>
            )}
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
            <CardTitle className="flex items-center gap-2">
              Exact Online
              {loading ? (
                <Badge variant="outline">Controleren...</Badge>
              ) : tokenStatus?.connected ? (
                <Badge className="bg-green-100 text-green-800">Verbonden</Badge>
              ) : (
                <Badge variant="destructive">Niet verbonden</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Eenmalige OAuth2 koppeling. Eén verbinding werkt voor alle administraties/divisies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <a href="/api/exact/auth">
                <Button>
                  {tokenStatus?.connected ? "Opnieuw verbinden" : "Verbind met Exact Online"}
                </Button>
              </a>

              {tokenStatus?.connected && tokenStatus.updatedAt && (
                <p className="text-sm text-muted-foreground">
                  Laatst verbonden: {new Date(tokenStatus.updatedAt).toLocaleString("nl-NL")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

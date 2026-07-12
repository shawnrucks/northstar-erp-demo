import { NextResponse } from "next/server";
import { northstarRepository } from "@/lib/northstar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await northstarRepository.healthCheck();
    return NextResponse.json({
      status: "ok",
      database: "connected",
      provider: result.provider,
      records: result.records,
    });
  } catch (error) {
    console.error(
      "Northstar health check failed:",
      error instanceof Error ? error.message : "Unknown database error",
    );
    return NextResponse.json(
      { status: "unhealthy", database: "unavailable" },
      { status: 503 },
    );
  }
}

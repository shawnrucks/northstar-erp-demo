import { NextResponse } from "next/server";
import { northstarRepository } from "@/lib/northstar";
import { getNorthstarDemoResetStatus } from "@/lib/northstar-demo-reset";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [result, demo] = await Promise.all([
      northstarRepository.healthCheck(),
      getNorthstarDemoResetStatus(),
    ]);
    if (
      !demo.available ||
      demo.canonicalRecordCount < 2_090 ||
      result.records < demo.canonicalRecordCount
    ) {
      throw new Error("Canonical Northstar demo data is incomplete.");
    }
    return NextResponse.json({
      status: demo.resetInProgress ? "maintenance" : "ok",
      database: "connected",
      provider: result.provider,
      records: result.records,
      canonicalRecords: demo.canonicalRecordCount,
      generation: demo.generation,
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

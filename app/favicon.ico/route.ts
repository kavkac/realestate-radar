// Redirect to SVG icon for favicon.ico
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.redirect(new URL("/icon.svg", process.env.NEXT_PUBLIC_APP_URL ?? "https://jakakavcic.com"), 301);
}

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "RealEstateRadar — Pregled nepremičnin v Sloveniji";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#2d6a4f",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "60px",
        }}
      >
        <div
          style={{
            fontSize: 72,
            marginBottom: 24,
          }}
        >
          🏠
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: "bold",
            color: "white",
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          RealEstateRadar
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#a8d3b5",
            textAlign: "center",
            maxWidth: 800,
          }}
        >
          Celovit pregled nepremičninskih podatkov za Slovenijo
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 32,
            color: "#7dbd90",
            fontSize: 20,
          }}
        >
          <span>⚡ Energetska izkaznica</span>
          <span>💰 Prodajne cene</span>
          <span>🏗️ Podatki o stavbi</span>
        </div>
      </div>
    ),
    { ...size }
  );
}

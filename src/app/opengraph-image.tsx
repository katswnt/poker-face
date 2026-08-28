import { ImageResponse } from "next/og";

export const alt = "Hold'em Trainer by Kat Swint";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "#0d1014",
        color: "#d4d4cf",
        fontFamily: "monospace",
        border: "18px solid #161a1f",
      }}
    >
      <div style={{ display: "flex", color: "#7dd3a0", fontSize: 28 }}>KAT SWINT · POKER PROJECT</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>HOLD&apos;EM TRAINER</div>
        <div style={{ display: "flex", maxWidth: 900, marginTop: 28, color: "#a8a8a0", fontSize: 34, lineHeight: 1.35 }}>
          Practice poker decisions with plain explanations and visible math.
        </div>
      </div>
      <div style={{ display: "flex", color: "#6a6a60", fontSize: 24 }}>pokerface.katswint.com</div>
    </div>,
    size,
  );
}

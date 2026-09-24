import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "HabFarms brings poultry farm records together, shown with the real HabFarms reports interface and Ghanaian farm photography.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const photo = `data:image/jpeg;base64,${(await readFile(join(process.cwd(), "public/images/marketing/social-farm.jpg"))).toString("base64")}`;
const reportPreview = `data:image/jpeg;base64,${(await readFile(join(process.cwd(), "public/images/marketing/social-report.jpg"))).toString("base64")}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: "#f8f7f2", color: "#18231d", fontFamily: "Arial, sans-serif" }}>
      <div style={{ width: 650, height: "100%", display: "flex", flexDirection: "column", padding: "58px 44px 52px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, color: "#123d2f", fontSize: 28, fontWeight: 700 }}>
          <div style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#e8f0e7", display: "flex", alignItems: "center", justifyContent: "center", color: "#b8892e", fontSize: 21, fontWeight: 700 }}>H</div>
          HabFarms
        </div>
        <div style={{ marginTop: 64, color: "#45604a", fontSize: 15, fontWeight: 700 }}>BUILT FOR POULTRY FARMERS IN GHANA</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 20, color: "#123d2f", fontSize: 54, fontWeight: 750, lineHeight: 1.08 }}>
          <span>Your poultry farm.</span>
          <span>One clear view.</span>
        </div>
        <div style={{ marginTop: 23, color: "#58645b", fontSize: 20, lineHeight: 1.5 }}>
          Bring birds, eggs, feed, sales, expenses and rearing into one farm workspace.
        </div>
        <div style={{ marginTop: "auto", color: "#45604a", fontSize: 15, fontWeight: 700 }}>Poultry farm records, brought together.</div>
      </div>
      <div style={{ width: 550, height: 630, display: "flex", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse requires inline images for its static social-card renderer. */}
        <img src={photo} alt="" style={{ display: "flex", width: 550, height: 630, objectFit: "cover" }} />
        <div style={{ position: "absolute", display: "flex", left: 24, bottom: 34, width: 450, height: 170, padding: 10, borderRadius: 18, backgroundColor: "#ffffff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse requires inline images for its static social-card renderer. */}
          <img src={reportPreview} alt="" style={{ display: "flex", width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />
        </div>
      </div>
    </div>,
    { ...size },
  );
}

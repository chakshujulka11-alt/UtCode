import { app, nativeImage } from "electron";
import fs from "node:fs";

const IN = process.env.UTCODE_LOGO_IN;
const OUT = process.env.UTCODE_LOGO_OUT;
const SIZE = Number(process.env.UTCODE_LOGO_SIZE || 256);

if (!IN || !OUT) {
  console.error("set UTCODE_LOGO_IN and UTCODE_LOGO_OUT");
  app.exit(2);
}

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  try {
    const img = nativeImage.createFromPath(IN);
    if (img.isEmpty()) throw new Error(`not a readable image: ${IN}`);
    const size = Math.min(SIZE, img.getSize().width, img.getSize().height);
    const out = img.resize({ width: size, height: size, quality: "best" });
    fs.writeFileSync(OUT, out.toPNG());
    console.log(`resized ${img.getSize().width}px -> ${size}px => ${OUT}`);
    app.exit(0);
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    app.exit(1);
  }
});

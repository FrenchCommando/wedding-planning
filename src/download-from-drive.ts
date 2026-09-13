// Downloads a Drive data file to a local JSON path. Read-only on Drive —
// the counterpart of upload-to-drive.ts, for checking live data locally.
// Usage: npx tsx src/download-from-drive.ts <drive-file-name> <local-json-path>
import "dotenv/config";
import fs from "node:fs";
import { readJsonFile } from "./drive.js";

async function main() {
  const [driveFileName, localPath] = process.argv.slice(2);
  if (!driveFileName || !localPath) {
    console.error("Usage: npx tsx src/download-from-drive.ts <drive-file-name> <local-json-path>");
    process.exit(1);
  }

  const { data } = await readJsonFile(driveFileName, null);
  if (data === null) throw new Error(`${driveFileName} did not exist in ${process.env.DRIVE_FOLDER_NAME} — an empty one was just created`);
  fs.writeFileSync(localPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Downloaded ${driveFileName} from ${process.env.DRIVE_FOLDER_NAME} -> ${localPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

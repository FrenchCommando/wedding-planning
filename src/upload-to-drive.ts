// Uploads a local JSON file to Drive under the given name, overwriting
// whatever is currently there.
// Usage: npx tsx src/upload-to-drive.ts <drive-file-name> <local-json-path>
import "dotenv/config";
import fs from "node:fs";
import { seedJsonFile } from "./drive.js";

async function main() {
  const [driveFileName, localPath] = process.argv.slice(2);
  if (!driveFileName || !localPath) {
    console.error("Usage: npx tsx src/upload-to-drive.ts <drive-file-name> <local-json-path>");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
  await seedJsonFile(driveFileName, data);
  console.log(`Uploaded ${localPath} -> ${driveFileName} in DRIVE_FOLDER_NAME.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import fs from "node:fs";
import path from "node:path";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

interface StoredToken {
  refresh_token: string;
}

function tokenPath(): string {
  return process.env.DRIVE_TOKEN_PATH ?? "./data/drive-token.json";
}

function loadStoredToken(): StoredToken | null {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveStoredToken(token: StoredToken): void {
  const p = tokenPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(token, null, 2));
}

function newOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  }
  return new google.auth.OAuth2({ clientId, clientSecret });
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  refresh_token?: string;
  access_token?: string;
  error?: string;
}

/**
 * Runs the OAuth Device Authorization Grant flow: prints a code + URL to
 * approve from a phone/laptop, then polls until Google issues tokens.
 * Only needed once — after this the refresh token on disk is reused.
 * google-auth-library's OAuth2Client has no device-flow support, so this
 * talks to Google's device endpoints directly.
 */
async function runDeviceFlow(clientId: string, clientSecret: string): Promise<StoredToken> {
  const codeRes = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES.join(" ") }),
  });
  const codes = (await codeRes.json()) as DeviceCodeResponse;
  console.log(`\nApprove Drive access:\n  ${codes.verification_url}\n  Code: ${codes.user_code}\n`);

  while (true) {
    await new Promise((r) => setTimeout(r, (codes.interval ?? 5) * 1000));
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: codes.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const token = (await tokenRes.json()) as DeviceTokenResponse;
    if (token.refresh_token) return { refresh_token: token.refresh_token };
    if (token.error === "authorization_pending" || token.error === "slow_down") continue;
    if (token.error) throw new Error(`device flow failed: ${token.error}`);
  }
}

let clientPromise: Promise<OAuth2Client> | null = null;

/** Returns an authenticated OAuth2Client, running the device flow on first use if no token is stored yet. */
export function getAuthClient(): Promise<OAuth2Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = newOAuthClient();
      let stored = loadStoredToken();
      if (!stored) {
        stored = await runDeviceFlow(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
        saveStoredToken(stored);
      }
      client.setCredentials({ refresh_token: stored.refresh_token });
      return client;
    })();
  }
  return clientPromise;
}

async function driveClient() {
  const auth = await getAuthClient();
  return google.drive({ version: "v3", auth });
}

function dataFolderName(): string {
  const name = process.env.DRIVE_FOLDER_NAME;
  if (!name) throw new Error("DRIVE_FOLDER_NAME not set");
  return name;
}

let folderIdPromise: Promise<string> | null = null;

/**
 * All data files this app creates live inside one Drive folder, found or
 * created by name on first use, so every file the app touches is visually
 * contained in one place instead of scattered across the Drive root.
 * Dev and prod point at two entirely separate folders (via DRIVE_FOLDER_NAME
 * in .env) — real, distinct folder names, not a derived prefix/suffix — so
 * they can never collide and each is independently browsable/deletable.
 */
async function dataFolderId(drive: Awaited<ReturnType<typeof driveClient>>): Promise<string> {
  if (!folderIdPromise) {
    folderIdPromise = (async () => {
      const name = dataFolderName();
      const res = await drive.files.list({
        q: `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name)",
        spaces: "drive",
      });
      const existing = res.data.files?.[0]?.id;
      if (existing) return existing;

      const created = await drive.files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
        fields: "id",
      });
      return created.data.id!;
    })();
  }
  return folderIdPromise;
}

async function findFileId(drive: Awaited<ReturnType<typeof driveClient>>, name: string): Promise<string | null> {
  const folderId = await dataFolderId(drive);
  const res = await drive.files.list({
    q: `name = '${name}' and '${folderId}' in parents and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * Reads a JSON data file by base name (e.g. "seating.json"), creating it
 * with `defaultValue` if it doesn't exist yet — per the spec, every file
 * this app touches must be created by the app itself (drive.file scope
 * ownership), never hand-uploaded.
 */
export async function readJsonFile<T>(name: string, defaultValue: T): Promise<{ data: T; revisionId: string }> {
  const drive = await driveClient();
  let fileId = await findFileId(drive, name);

  if (!fileId) {
    const folderId = await dataFolderId(drive);
    const created = await drive.files.create({
      requestBody: { name, mimeType: "application/json", parents: [folderId] },
      media: { mimeType: "application/json", body: JSON.stringify(defaultValue, null, 2) },
      fields: "id, headRevisionId",
    });
    fileId = created.data.id!;
    return { data: defaultValue, revisionId: created.data.headRevisionId ?? "" };
  }

  const meta = await drive.files.get({ fileId, fields: "headRevisionId" });
  const content = await drive.files.get({ fileId, alt: "media" }, { responseType: "json" });
  return { data: content.data as T, revisionId: meta.data.headRevisionId ?? "" };
}

/**
 * Optimistic-lock write: `expectedRevisionId` must match Drive's current
 * headRevisionId for the file or the write is refused. Caller (route
 * handler) is responsible for surfacing the conflict to the client.
 */
export async function writeJsonFile<T>(
  name: string,
  data: T,
  expectedRevisionId: string,
  opts: { keepForever?: boolean } = {}
): Promise<{ revisionId: string } | { conflict: true; currentRevisionId: string }> {
  const drive = await driveClient();
  const fileId = await findFileId(drive, name);
  if (!fileId) throw new Error(`writeJsonFile: ${name} does not exist — read it first to create it`);

  const meta = await drive.files.get({ fileId, fields: "headRevisionId" });
  const currentRevisionId = meta.data.headRevisionId ?? "";
  if (currentRevisionId !== expectedRevisionId) {
    return { conflict: true, currentRevisionId };
  }

  const updated = await drive.files.update({
    fileId,
    media: { mimeType: "application/json", body: JSON.stringify(data, null, 2) },
    fields: "headRevisionId",
    keepRevisionForever: opts.keepForever ?? false,
  });
  return { revisionId: updated.data.headRevisionId ?? "" };
}

/**
 * Unconditionally seeds/overwrites a file with the given data, always
 * writing against the file's own current revision — used by setup/seed
 * scripts where "replace whatever is there" is the intent, not an
 * editor-vs-editor conflict to guard against.
 */
export async function seedJsonFile<T>(name: string, data: T): Promise<void> {
  const { revisionId } = await readJsonFile(name, data);
  const result = await writeJsonFile(name, data, revisionId);
  if ("conflict" in result) throw new Error(`seedJsonFile: conflict writing ${name}`);
}

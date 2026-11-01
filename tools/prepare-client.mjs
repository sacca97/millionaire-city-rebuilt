import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
// Builds generated/client/Dollars.private.swf (the patched original client used by the launcher / oracle harness) from the sources
// in client-patch-sources/. Needs Java; downloads FFDec 26.0.0 into generated/tools/. Usage: node tools/prepare-client.mjs  (npm run prepare-client)
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = {
  workspaceRoot,
  sourceClientSwfPath: path.join(workspaceRoot, "assets", "dchoc1-a.akamaihd.net", "0.501", "mcity", "Datas", "Dollars.swf"),
  privateClientSwfPath: path.join(workspaceRoot, "generated", "client", "Dollars.private.swf")
};
const clientDir = path.dirname(config.privateClientSwfPath);
const clientPatchSourcesDir = path.join(config.workspaceRoot, "client-patch-sources");
const FFDEC_VERSION = "26.0.0";
const FFDEC_ARCHIVE_URL = `https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version${FFDEC_VERSION}/ffdec_${FFDEC_VERSION}.zip`;
const ffdecDir = path.join(config.workspaceRoot, "generated", "tools", `ffdec-${FFDEC_VERSION}`);
const ffdecJarPath = path.join(ffdecDir, "ffdec.jar");
const ffdecZipPath = path.join(ffdecDir, `ffdec_${FFDEC_VERSION}.zip`);
const clientPatches = [
  {
    className: "Config",
    sourcePath: path.join(clientPatchSourcesDir, "Config.as"),
    note: "Config patched to use local server-backed Facebook/fan data and allow local runtime toggles.",
    errorMessage: "Failed to patch Config in the private client SWF."
  },
  {
    className: "Dollars",
    sourcePath: path.join(clientPatchSourcesDir, "Dollars.as"),
    note: "Dollars patched to enable original debug mode, climate particles, and classic item designs from launcher FlashVars.",
    errorMessage: "Failed to patch Dollars in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.world.items.ItemDefinition",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "world", "items", "ItemDefinition.as"),
    note: "ItemDefinition patched to optionally prefer classic item art symbols before newer *_new exports.",
    errorMessage: "Failed to patch ItemDefinition in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.world.items.ItemObject",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "world", "items", "ItemObject.as"),
    note: "ItemObject patched so live building effect overlays follow the classic item art toggle.",
    errorMessage: "Failed to patch ItemObject in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.world.items.decorations.ItemDecoration",
    sourcePath: path.join(
      clientPatchSourcesDir,
      "scripts",
      "com",
      "dchoc",
      "dollars",
      "world",
      "items",
      "decorations",
      "ItemDecoration.as"
    ),
    note: "ItemDecoration patched so item skins and flags follow the classic item art toggle.",
    errorMessage: "Failed to patch ItemDecoration in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.GUI.PopupGold",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "GUI", "PopupGold.as"),
    note: "PopupGold patched to complete Add Gold purchases without enabling the Facebook Credits HUD.",
    errorMessage: "Failed to patch PopupGold in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.GUI.PopupEmail",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "GUI", "PopupEmail.as"),
    note: "PopupEmail patched to complete local VIP Club confirmation immediately after a valid email is accepted.",
    errorMessage: "Failed to patch PopupEmail in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.utils.metrics.CustomizerManager",
    sourcePath: path.join(
      clientPatchSourcesDir,
      "scripts",
      "com",
      "dchoc",
      "dollars",
      "utils",
      "metrics",
      "CustomizerManager.as"
    ),
    note: "CustomizerManager patched to treat archived cross-promotion app unlocks as completed locally.",
    errorMessage: "Failed to patch CustomizerManager in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.friends.FriendObject",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "friends", "FriendObject.as"),
    note: "FriendObject patched to reload an already-loaded NPC portrait after advisor selection changes it.",
    errorMessage: "Failed to patch FriendObject in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.friends.FriendsBarContentFriend",
    sourcePath: path.join(
      clientPatchSourcesDir,
      "scripts",
      "com",
      "dchoc",
      "dollars",
      "friends",
      "FriendsBarContentFriend.as"
    ),
    note: "FriendsBarContentFriend patched so local player name changes repaint the existing friends bar entry.",
    errorMessage: "Failed to patch FriendsBarContentFriend in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.utils.Mouse.MouseWheelEnabler",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "utils", "Mouse", "MouseWheelEnabler.as"),
    note: "MouseWheelEnabler patched to remove debug console spam and use non-passive wheel listeners.",
    errorMessage: "Failed to patch MouseWheelEnabler in the private client SWF."
  },
  {
    className: "com.dchoc.dollars.server.Server",
    sourcePath: path.join(clientPatchSourcesDir, "scripts", "com", "dchoc", "dollars", "server", "Server.as"),
    note: "Server patched to accept local launcher stat refreshes without reloading the SWF.",
    errorMessage: "Failed to patch Server in the private client SWF."
  }
];
fs.mkdirSync(clientDir, { recursive: true });
fs.copyFileSync(config.sourceClientSwfPath, config.privateClientSwfPath);
patchPrivateClientSwf();
writeClientBuildManifest();
console.log(`[mcity] Prepared private client copy at ${config.privateClientSwfPath}`);
function patchPrivateClientSwf() {
  ensureFfdecInstalled();
  for (const patch of clientPatches) {
    replaceClassInPrivateClient(patch);
  }
}
function replaceClassInPrivateClient(patch) {
  if (!fs.existsSync(patch.sourcePath)) {
    throw new Error(`Client patch source not found: ${patch.sourcePath}`);
  }
  const temporaryOutputPath = path.join(clientDir, "Dollars.private.tmp.swf");
  if (fs.existsSync(temporaryOutputPath)) {
    fs.rmSync(temporaryOutputPath, { force: true });
  }
  runProcess(
    "java",
    [
      "-jar",
      ffdecJarPath,
      "-replace",
      config.privateClientSwfPath,
      temporaryOutputPath,
      patch.className,
      patch.sourcePath
    ],
    patch.errorMessage
  );
  fs.copyFileSync(temporaryOutputPath, config.privateClientSwfPath);
  fs.rmSync(temporaryOutputPath, { force: true });
}
function writeClientBuildManifest() {
  const manifestPath = path.join(clientDir, "client-build.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        source: config.sourceClientSwfPath,
        output: config.privateClientSwfPath,
        preparedAt: (/* @__PURE__ */ new Date()).toISOString(),
        notes: [
          "Private client copy isolated from the recovered archive.",
          "Runtime compatibility provided by the local launcher and HTTPS Facebook shim.",
          ...clientPatches.map((patch) => patch.note)
        ]
      },
      null,
      2
    )
  );
}
function ensureFfdecInstalled() {
  if (fs.existsSync(ffdecJarPath)) {
    return;
  }
  fs.mkdirSync(ffdecDir, { recursive: true });
  downloadFile(FFDEC_ARCHIVE_URL, ffdecZipPath);
  extractZip(ffdecZipPath, ffdecDir);
  if (!fs.existsSync(ffdecJarPath)) {
    throw new Error(`FFDec was installed, but ${ffdecJarPath} was not found.`);
  }
}
function downloadFile(url, destinationPath) {
  console.log(`[mcity] Downloading FFDec from ${url}`);
  const temporaryPath = `${destinationPath}.tmp`;
  if (fs.existsSync(temporaryPath)) {
    fs.rmSync(temporaryPath, { force: true });
  }
  downloadFileSync(url, temporaryPath, 0);
  fs.renameSync(temporaryPath, destinationPath);
}
function downloadFileSync(url, destinationPath, redirectCount) {
  if (redirectCount > 5) {
    throw new Error("Too many redirects while downloading FFDec.");
  }
  const script = `
const fs = require("node:fs");
const https = require("node:https");
const url = ${JSON.stringify(url)};
const destinationPath = ${JSON.stringify(destinationPath)};
const redirectCount = ${redirectCount};
function download(currentUrl, redirects) {
  if (redirects > 5) {
    console.error("Too many redirects while downloading FFDec.");
    process.exit(1);
  }
  https.get(currentUrl, (response) => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume();
      download(new URL(response.headers.location, currentUrl).toString(), redirects + 1);
      return;
    }
    if (response.statusCode !== 200) {
      console.error("Unexpected HTTP status " + response.statusCode + " while downloading FFDec.");
      process.exit(1);
    }
    const file = fs.createWriteStream(destinationPath);
    response.pipe(file);
    file.on("finish", () => file.close(() => process.exit(0)));
  }).on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}
download(url, redirectCount);
`;
  runProcess(process.execPath, ["-e", script], "Failed to download FFDec.");
}
function extractZip(zipPath, destinationPath) {
  if (process.platform === "win32") {
    runProcess(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        [
          "$ErrorActionPreference='Stop'",
          "$ProgressPreference='SilentlyContinue'",
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destinationPath}' -Force`
        ].join("; ")
      ],
      "Failed to extract FFDec."
    );
    return;
  }
  runProcess("unzip", ["-q", "-o", zipPath, "-d", destinationPath], "Failed to extract FFDec.");
}
function runProcess(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    cwd: config.workspaceRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

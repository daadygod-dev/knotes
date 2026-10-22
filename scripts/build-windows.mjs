import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, ".build", "sea");
const bundlePath = join(buildDir, "server.cjs");
const configPath = join(buildDir, "sea-config.json");
const blobPath = join(buildDir, "sea-prep.blob");
const serverExecutablePath = join(root, "KNOTES-server.exe");
const launcherPath = join(root, "KNOTES.exe");
const sentinel = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const webViewVersion = "1.0.4258.31";
const webViewDirectory = join(root, ".build", "webview2");

async function setWindowsGuiSubsystem(filePath) {
  const handle = await open(filePath, "r+");
  try {
    const header = Buffer.alloc(4096);
    await handle.read(header, 0, header.length, 0);
    const peOffset = header.readUInt32LE(0x3c);
    const optionalHeader = peOffset + 24;
    const magic = header.readUInt16LE(optionalHeader);
    if (magic !== 0x10b && magic !== 0x20b) {
      throw new Error("The executable has an unexpected PE optional header.");
    }
    const subsystemOffset = optionalHeader + 68;
    const windowsGui = Buffer.alloc(2);
    windowsGui.writeUInt16LE(2);
    await handle.write(windowsGui, 0, windowsGui.length, subsystemOffset);
  } finally {
    await handle.close();
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function ensureWebViewAssets() {
  const nupkgPath = join(
    webViewDirectory,
    `microsoft.web.webview2.${webViewVersion}.nupkg`,
  );
  const packageDirectory = join(webViewDirectory, "pkg");
  const corePath = join(
    packageDirectory,
    "lib",
    "net462",
    "Microsoft.Web.WebView2.Core.dll",
  );

  await mkdir(webViewDirectory, { recursive: true });
  if (!existsSync(corePath)) {
    if (!existsSync(nupkgPath)) {
      console.log(`Downloading WebView2 SDK ${webViewVersion}...`);
      const response = await fetch(
        `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${webViewVersion}/microsoft.web.webview2.${webViewVersion}.nupkg`,
      );
      if (!response.ok) {
        throw new Error(`WebView2 SDK download failed with status ${response.status}.`);
      }
      await writeFile(nupkgPath, Buffer.from(await response.arrayBuffer()));
    }
    await mkdir(packageDirectory, { recursive: true });
    execFileSync("tar", ["-xf", nupkgPath, "-C", packageDirectory], {
      stdio: "inherit",
    });
  }

  const assets = [
    [corePath, join(root, "Microsoft.Web.WebView2.Core.dll")],
    [
      join(packageDirectory, "lib", "net462", "Microsoft.Web.WebView2.WinForms.dll"),
      join(root, "Microsoft.Web.WebView2.WinForms.dll"),
    ],
    [
      join(packageDirectory, "runtimes", "win-x64", "native", "WebView2Loader.dll"),
      join(root, "WebView2Loader.dll"),
    ],
  ];
  for (const [source, destination] of assets) {
    await copyFile(source, destination);
  }

  return {
    core: join(root, "Microsoft.Web.WebView2.Core.dll"),
    winForms: join(root, "Microsoft.Web.WebView2.WinForms.dll"),
  };
}

function findCSharpCompiler() {
  const frameworkDirectory = join(
    process.env.WINDIR || "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
  );
  const compiler = join(frameworkDirectory, "csc.exe");
  if (!existsSync(compiler)) {
    throw new Error(".NET Framework 4.x is required to build the desktop launcher.");
  }
  return { compiler, frameworkDirectory };
}

function buildDesktopLauncher(webViewAssets, appVersion) {
  const { compiler, frameworkDirectory } = findCSharpCompiler();
  const parts = appVersion.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error("package.json version must use MAJOR.MINOR.PATCH.");
  }
  const assemblyVersion = `${appVersion}.0`;
  const assemblyInfoPath = join(buildDir, "AssemblyInfo.cs");
  writeFileSync(
    assemblyInfoPath,
    [
      "using System.Reflection;",
      `[assembly: AssemblyVersion("${assemblyVersion}")]`,
      `[assembly: AssemblyFileVersion("${assemblyVersion}")]`,
      `[assembly: AssemblyInformationalVersion("${appVersion}")]`,
      '[assembly: AssemblyTitle("KNOTES")]',
      '[assembly: AssemblyProduct("KNOTES")]',
      '[assembly: AssemblyDescription("Local-first notes with an AI planner")]',
      "",
    ].join("\n"),
  );

  const references = [
    "System.dll",
    "System.Core.dll",
    "System.Drawing.dll",
    "System.Windows.Forms.dll",
    "System.Net.Http.dll",
    "System.Web.Extensions.dll",
    "System.IO.Compression.dll",
    "System.IO.Compression.FileSystem.dll",
  ].map((name) => `/r:${join(frameworkDirectory, name)}`);

  console.log("Compiling the KNOTES desktop window...");
  execFileSync(
    compiler,
    [
      "/nologo",
      "/target:winexe",
      "/platform:x64",
      "/optimize+",
      "/codepage:65001",
      `/out:${launcherPath}`,
      `/win32icon:${join(root, "public", "app-icon.ico")}`,
      `/win32manifest:${join(root, "desktop", "app.manifest")}`,
      ...references,
      `/r:${webViewAssets.core}`,
      `/r:${webViewAssets.winForms}`,
      join(root, "desktop", "Program.cs"),
      assemblyInfoPath,
    ],
    { stdio: "inherit" },
  );
}

async function buildReleaseArchive(appVersion) {
  const releaseDir = join(root, ".build", "release");
  const stagingDir = join(releaseDir, "KNOTES-win-x64");
  const archivePath = join(releaseDir, "KNOTES-win-x64.zip");
  const checksumPath = join(releaseDir, "SHA256SUMS.txt");

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const releaseFiles = [
    "KNOTES.exe",
    "KNOTES-server.exe",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll",
    "README.md",
  ];
  for (const file of releaseFiles) {
    await copyFile(join(root, file), join(stagingDir, file));
  }
  await writeFile(join(stagingDir, "VERSION"), `${appVersion}\n`);

  await rm(archivePath, { force: true });
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${stagingDir.replaceAll("'", "''")}\\*' -DestinationPath '${archivePath.replaceAll("'", "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );

  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  await writeFile(checksumPath, `${digest}  KNOTES-win-x64.zip\n`);

  console.log(`Release archive: ${archivePath}`);
  console.log(`Checksums: ${checksumPath}`);
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("The Windows executable can only be built on Windows.");
  }

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const appVersion = packageJson.version;

  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  for (const executable of [serverExecutablePath, launcherPath]) {
    try {
      await rm(executable, { force: true });
    } catch (error) {
      if (error?.code === "EBUSY" || error?.code === "EPERM") {
        throw new Error(`Close ${basename(executable)} before building.`);
      }
      throw error;
    }
  }

  console.log("Bundling server...");
  await build({
    entryPoints: [join(root, "src", "server.mjs")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
  });

  const assets = {};
  for (const file of await listFiles(join(root, "public"))) {
    const key = relative(root, file).split(sep).join("/");
    assets[key] = resolve(file);
  }

  const config = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgv: ["--no-warnings"],
    assets,
  };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  console.log(`Embedding ${Object.keys(assets).length} web assets...`);
  execFileSync(process.execPath, ["--experimental-sea-config", configPath], {
    cwd: root,
    stdio: "inherit",
  });

  console.log(`Copying Node ${process.version} runtime...`);
  await copyFile(process.execPath, serverExecutablePath);

  const blob = await readFile(blobPath);
  console.log("Injecting application into KNOTES-server.exe...");
  await inject(serverExecutablePath, "NODE_SEA_BLOB", blob, {
    sentinelFuse: sentinel,
  });

  console.log("Marking the server as a windowless Windows app...");
  await setWindowsGuiSubsystem(serverExecutablePath);

  const webViewAssets = await ensureWebViewAssets();
  buildDesktopLauncher(webViewAssets, appVersion);
  await buildReleaseArchive(appVersion);

  console.log(`Built KNOTES ${appVersion}: ${launcherPath}`);
  console.log("Keep KNOTES-server.exe, WebView2 DLLs, .env, and data next to KNOTES.exe.");
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const deployDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(deployDir, "..");

const backendDir = join(projectDir, "backend");
const frontendRoot = join(projectDir, "frontend");

const buildDir = join(deployDir, "build");
const backendOutput = join(buildDir, "backend");
const publicOutput = join(buildDir, "public_html");

function requireFile(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Hiányzó fájl: ${path}`);
  }
}

function findFrontend() {
  if (!existsSync(frontendRoot)) {
    throw new Error(`Hiányzó frontend mappa: ${frontendRoot}`);
  }

  const subdirectories = readdirSync(frontendRoot, {
    withFileTypes: true,
  })
    .filter(
      (entry) => entry.isDirectory() && entry.name !== "node_modules"
    )
    .map((entry) => join(frontendRoot, entry.name));

  const candidates = [frontendRoot, ...subdirectories].filter(
    (path) =>
      existsSync(join(path, "angular.json")) &&
      existsSync(join(path, "package.json"))
  );

  if (candidates.length !== 1) {
    throw new Error(
      "Pontosan egy Angular workspace szükséges a frontend/ " +
        "mappában vagy annak közvetlen almappájában. Találatok: " +
        (candidates.join(", ") || "nincs")
    );
  }

  return candidates[0];
}

function run(command, cwd) {
  console.log(`\n> ${command}\n  Mappa: ${cwd}`);

  execSync(command, {
    cwd,
    stdio: "inherit",
  });
}

try {
  console.log("Build előkészítése...");

  const frontendDir = findFrontend();

  requireFile(join(backendDir, "composer.json"));
  requireFile(join(backendDir, "composer.lock"));
  requireFile(join(frontendDir, "package-lock.json"));

  run("php --version", projectDir);
  run("composer --version", projectDir);

  // Csak a deploy/build generált tartalmát töröljük.
  if (existsSync(buildDir) && lstatSync(buildDir).isSymbolicLink()) {
    throw new Error("A deploy/build nem lehet szimbolikus link.");
  }

  rmSync(buildDir, {
    recursive: true,
    force: true,
  });

  mkdirSync(buildDir, {
    recursive: true,
  });

  console.log("\n1/4 Backend másolása...");

  const excluded = new Set([
    ".git",
    "node_modules",
    "vendor",
    "auth.json",
    "uploads",
  ]);

  cpSync(backendDir, backendOutput, {
    recursive: true,
    filter: (source) => {
      const parts = relative(backendDir, source).split(sep);

      return (
        !lstatSync(source).isSymbolicLink() &&
        !parts.some(
          (part) => excluded.has(part) || part.startsWith(".env")
        )
      );
    },
  });

  console.log("\n2/4 Backend függőségek telepítése a másolatba...");

  run(
    "composer install --no-dev --prefer-dist " +
      "--optimize-autoloader --no-interaction",
    backendOutput
  );

  console.log("\n3/4 Angular függőségek és production build...");

  run("npm ci", frontendDir);

  run(
    "npm run build -- public --configuration production " +
      "--output-path=dist/deploy-public --output-mode=static --base-href=/",
    frontendDir
  );

  run(
    "npm run build -- admin --configuration production " +
      "--output-path=dist/deploy-admin --base-href=/admin/",
    frontendDir
  );

  console.log("\n4/4 Frontend fájlok és API belépőpont előkészítése...");

  const adminOutput = join(publicOutput, "admin");

  for (const app of [
    { folder: "deploy-public", target: publicOutput },
    { folder: "deploy-admin", target: adminOutput },
  ]) {
    const output = join(frontendDir, "dist", app.folder);

    const browser = existsSync(join(output, "browser"))
      ? join(output, "browser")
      : output;

    requireFile(join(browser, "index.html"));
    cpSync(browser, app.target, { recursive: true });
  }

  // A szerveren a backend/ és a public_html/ testvérmappák.
  const apiOutput = join(publicOutput, "api");

  requireFile(join(backendOutput, "public", "index.php"));
  requireFile(join(backendOutput, "vendor", "autoload.php"));
  mkdirSync(apiOutput, { recursive: true });

  writeFileSync(
    join(apiOutput, "index.php"),
    `<?php
declare(strict_types=1);

require dirname(__DIR__, 2) . '/backend/public/index.php';
`
  );

  writeFileSync(
    join(apiOutput, ".htaccess"),
    [
      "RewriteEngine On",
      "RewriteBase /api/",
      "RewriteCond %{REQUEST_FILENAME} !-f",
      "RewriteCond %{REQUEST_FILENAME} !-d",
      "RewriteRule ^ index.php [QSA,L]",
      "",
    ].join("\n")
  );

  run("php -l public_html/api/index.php", buildDir);

  writeFileSync(
    join(buildDir, "build-complete.json"),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        backend: "backend",
        frontend: "public_html",
        admin: "public_html/admin",
        api: "public_html/api",
      },
      null,
      2
    ) + "\n"
  );

  console.log(
    `\nBuild kész.\nBackend: ${backendOutput}` +
      `\nPublic: ${publicOutput}\nAdmin: ${adminOutput}` +
      `\nAPI: ${apiOutput}`
  );
} catch (error) {
  console.error(`\nBUILD HIBA: ${error.message}`);
  process.exitCode = 1;
}
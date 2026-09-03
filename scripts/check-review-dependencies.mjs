import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lockfilePath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(__dirname, "../package-lock.json");
const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));

const advisories = [
  {
    packageName: "hono",
    vulnerableRange: "<4.12.34",
    advisory: "GHSA-26pp-8wgv-hjvm / GHSA-r5rp-j6wh-rvv4 / GHSA-xf4j-xp2r-rqqx / GHSA-wmmm-f939-6g9c / GHSA-458j-xx4x-4375 / GHSA-xpcf-pg52-r92g / GHSA-qp7p-654g-cw7p / GHSA-hm8q-7f3q-5f36 / GHSA-p77w-8qqv-26rm / GHSA-9vqf-7f2p-gf9v / GHSA-69xw-7hcm-h432 / GHSA-xrhx-7g5j-rcj5 / GHSA-3hrh-pfw6-9m5x / GHSA-f577-qrjj-4474 / GHSA-2gcr-mfcq-wcc3 / GHSA-wwfh-h76j-fc44 / GHSA-j6c9-x7qj-28xf / GHSA-88fw-hqm2-52qc / GHSA-rv63-4mwf-qqc2 / GHSA-wgpf-jwqj-8h8p / GHSA-8j4g-w8fx-2239",
    isVulnerable: (version) => lessThan(version, "4.12.34"),
  },
  {
    packageName: "@hono/node-server",
    vulnerableRange: "<2.0.5",
    advisory: "GHSA-92pp-h63x-v22m / GHSA-frvp-7c67-39w9",
    isVulnerable: (version) => lessThan(version, "2.0.5"),
  },
  {
    packageName: "fast-uri",
    vulnerableRange: ">=3.0.0 <=3.1.5",
    advisory: "GHSA-q3j6-qgpj-74h6 / GHSA-v39h-62p7-jpjc / GHSA-7p8r-x3mc-p8w7 / GHSA-5jgf-p345-68v8 / GHSA-f65p-4m7j-42xc / GHSA-fph4-wmhf-6fwf / GHSA-jqff-g426-hqxp",
    isVulnerable: (version) => greaterThanOrEqual(version, "3.0.0") && lessThanOrEqual(version, "3.1.5"),
  },
  {
    packageName: "ip-address",
    vulnerableRange: "<=10.1.0",
    advisory: "GHSA-v2v4-37r5-5v8g",
    isVulnerable: (version) => lessThanOrEqual(version, "10.1.0"),
  },
  {
    packageName: "brace-expansion",
    vulnerableRange: "<1.1.18 || >=2.0.0 <2.1.4 || >=3.0.0 <3.0.6 || >=4.0.0 <5.0.9",
    advisory: "GHSA-jxxr-4gwj-5jf2 / GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895",
    isVulnerable: (version) => (
      lessThan(version, "1.1.18")
      || (greaterThanOrEqual(version, "2.0.0") && lessThan(version, "2.1.4"))
      || (greaterThanOrEqual(version, "3.0.0") && lessThan(version, "3.0.6"))
      || (greaterThanOrEqual(version, "4.0.0") && lessThan(version, "5.0.9"))
    ),
  },
  {
    packageName: "ws",
    vulnerableRange: ">=8.0.0 <8.20.1",
    advisory: "GHSA-58qx-3vcg-4xpx",
    isVulnerable: (version) => greaterThanOrEqual(version, "8.0.0") && lessThan(version, "8.20.1"),
  },
  {
    packageName: "@anthropic-ai/sdk",
    vulnerableRange: ">=0.79.0 <0.91.1",
    advisory: "GHSA-p7fg-763f-g4gf",
    isVulnerable: (version) => greaterThanOrEqual(version, "0.79.0") && lessThan(version, "0.91.1"),
  },
  {
    packageName: "qs",
    vulnerableRange: ">=2.2.5 <6.16.0",
    advisory: "GHSA-q8mj-m7cp-5q26 / GHSA-4mjr-xmp4-gh2g / GHSA-x5fp-wj9c-mxmx",
    isVulnerable: (version) => greaterThanOrEqual(version, "2.2.5") && lessThan(version, "6.16.0"),
  },
];

const packages = Object.entries(lockfile.packages ?? {})
  .filter(([path]) => path !== "")
  .map(([path, data]) => ({
    path,
    packageName: packageNameFromLockfilePath(path),
    version: data.version,
  }))
  .filter((entry) => typeof entry.version === "string");

const failures = [];

for (const advisory of advisories) {
  for (const entry of packages.filter((item) => item.packageName === advisory.packageName)) {
    if (advisory.isVulnerable(entry.version)) {
      failures.push({ ...entry, advisory });
    }
  }
}

if (failures.length > 0) {
  process.stderr.write("Obsidian review dependency check failed:\n");
  for (const failure of failures) {
    process.stderr.write(
      `- ${failure.packageName}@${failure.version} at ${failure.path} matches ${failure.advisory.vulnerableRange} (${failure.advisory.advisory})\n`,
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Obsidian review dependency check passed.\n");
}

function packageNameFromLockfilePath(path) {
  const nodeModulesMarker = "node_modules/";
  const markerIndex = path.lastIndexOf(nodeModulesMarker);
  const packagePath = markerIndex >= 0
    ? path.slice(markerIndex + nodeModulesMarker.length)
    : path;
  const parts = packagePath.split("/");

  if (parts[0]?.startsWith("@")) {
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0];
}

function lessThan(version, target) {
  return compareVersions(version, target) < 0;
}

function lessThanOrEqual(version, target) {
  return compareVersions(version, target) <= 0;
}

function greaterThanOrEqual(version, target) {
  return compareVersions(version, target) >= 0;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

function versionParts(version) {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

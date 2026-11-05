import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const local = existsSync(".tools")
  ? readdirSync(".tools").find(
      (name) =>
        name.startsWith("wasm-bindgen-0.2.105-") && !name.endsWith(".gz"),
    )
  : undefined;
const binding =
  process.env.WASM_BINDGEN_BIN ||
  (local
    ? join(
        process.cwd(),
        ".tools",
        local,
        process.platform === "win32" ? "wasm-bindgen.exe" : "wasm-bindgen",
      )
    : "wasm-bindgen");
const version = spawnSync(binding, ["--version"], { encoding: "utf8" });
if (!version.stdout?.includes("0.2.105"))
  throw new Error(
    "Install wasm-bindgen-cli 0.2.105, or set WASM_BINDGEN_BIN. See README.md.",
  );
run("cargo", [
  "build",
  "--manifest-path",
  "crates/outlook/Cargo.toml",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "--lib",
]);
mkdirSync("src/generated/outlook", { recursive: true });
run(binding, [
  "crates/outlook/target/wasm32-unknown-unknown/release/brent_outlook.wasm",
  "--target",
  "web",
  "--out-dir",
  "src/generated/outlook",
  "--out-name",
  "outlook",
]);
console.log(
  `Wasm binary: ${statSync("src/generated/outlook/outlook_bg.wasm").size.toLocaleString()} bytes`,
);

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const distDirectory = resolve(process.env.NORTHSTAR_NEXT_DIST_DIR || ".next");
const standaloneDirectory = resolve(distDirectory, "standalone");

if (!existsSync(resolve(standaloneDirectory, "server.js"))) {
  throw new Error(`Next.js standalone output is missing from ${standaloneDirectory}.`);
}

const copyDirectory = (source, destination) => {
  if (!existsSync(source)) return;
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
};

copyDirectory(resolve("public"), resolve(standaloneDirectory, "public"));
copyDirectory(resolve(distDirectory, "static"), resolve(standaloneDirectory, ".next", "static"));

console.log("Prepared Next.js standalone output with public and static assets.");

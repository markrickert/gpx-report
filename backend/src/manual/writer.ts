import { readFile, writeFile } from "node:fs/promises";
import { backupFile } from "../backup.js";
import { manualActivityFields } from "./parser.js";

export function manualFileContent(input) {
  return JSON.stringify(manualActivityFields(input), null, 2) + "\n";
}

// Changes the given fields of a manual activity's file and keeps the rest.
export async function writeManualFields(filePath, fields) {
  const current = JSON.parse(await readFile(filePath, "utf-8"));
  const content = manualFileContent({ ...current, ...fields });
  await backupFile(filePath);
  await writeFile(filePath, content, "utf-8");
}

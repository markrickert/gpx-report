import { randomUUID } from "expo-crypto";
import { writeIntoQueue } from "./import-files";
import * as store from "./store";

export const MANUAL_EXTENSION = ".manual.json";

/**
 * Saves an activity typed in by hand. It goes into the import queue rather
 * than straight to the server, so saving works offline; `input` is the
 * server's ManualActivityInput.
 */
export function queueManualActivity(person: string, input: { title: string }) {
  const id = randomUUID();
  const localUri = writeIntoQueue(id, MANUAL_EXTENSION, JSON.stringify(input));
  store.createImport({ id, person, name: input.title, localUri }, Date.now());
}

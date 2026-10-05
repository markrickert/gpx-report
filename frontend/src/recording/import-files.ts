import { Directory, File, Paths } from "expo-file-system";

// The picker hands over a copy in the app's cache, which the OS may clear;
// the queue keeps its own copy until the upload finishes. These only ever
// touch the app's copies, never the file the user picked.
const importsDir = () => new Directory(Paths.document, "imports");

export async function copyIntoQueue(pickedUri: string, id: string, extension: string) {
  const dir = importsDir();
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${id}${extension}`);
  await new File(pickedUri).copy(dest);
  removeFile(pickedUri);
  return dest.uri;
}

/** Writes text the app made itself (a manual activity) into the queue's folder. */
export function writeIntoQueue(id: string, extension: string, text: string) {
  const dir = importsDir();
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${id}${extension}`);
  dest.write(text);
  return dest.uri;
}

export function readText(uri: string) {
  return new File(uri).text();
}

export function readBase64(uri: string) {
  return new File(uri).base64();
}

export function removeFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // Already gone (the OS can clear the cache copy); nothing to clean up.
  }
}

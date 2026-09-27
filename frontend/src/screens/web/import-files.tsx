import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation } from "@apollo/client";
import { useLocalSearchParams } from "expo-router";
import { IMPORT_ACTIVITY_FILE } from "@/graphql/queries";
import { IMPORT_EXTENSIONS, describeImportResult, skipReason } from "@/utils/import-result";

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// "Import files" button plus drag-and-drop anywhere in the window while the
// Dashboard is open. Files go to the person whose Dashboard this is (the
// [person] layout's Apollo client). No queue on the web: a failure just says so.
export function ImportFiles({ onImported }: { onImported: () => unknown }) {
  const { person } = useLocalSearchParams<{ person: string }>();
  const [importFile] = useMutation(IMPORT_ACTIVITY_FILE);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const importAll = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    const out: string[] = [];
    for (const file of files) {
      const skipped = skipReason(file.name, file.size);
      if (skipped) {
        out.push(`${file.name}: ${skipped}`);
        continue;
      }
      try {
        const { data } = await importFile({
          variables: { filename: file.name, contentBase64: await readBase64(file) },
        });
        out.push(describeImportResult(file.name, data.importActivityFile));
      } catch (e) {
        out.push(`${file.name}: failed to upload. ${(e as Error).message}`);
      }
      setLines([...out]);
    }
    setLines(out);
    setBusy(false);
    await onImported();
  };
  // The window listeners are added once; this always calls the latest importAll.
  const onDropFiles = useEffectEvent((files: File[]) => importAll(files));

  useEffect(() => {
    // dragenter/dragleave fire for every child element crossed, so count them.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this the browser opens the dropped file and leaves the app.
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void onDropFiles(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="import-files">
      <button type="button" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Importing…" : "Import files"}
      </button>
      <span className="chart-hint">or drop GPX, IGC, or SKIZ files anywhere on this page</span>
      <input
        ref={input}
        type="file"
        multiple
        accept={IMPORT_EXTENSIONS.join(",")}
        hidden
        onChange={(e) => {
          void importAll(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {lines.length > 0 && (
        <ul className="import-results">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {dragging && (
        <div className="import-drop-overlay">
          Drop GPX, IGC, or SKIZ files to import into {person}&apos;s activities
        </div>
      )}
    </div>
  );
}

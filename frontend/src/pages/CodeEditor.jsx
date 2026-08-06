export default function CodeEditor() {
  const url = import.meta.env.VITE_CODE_SERVER_URL;

  return <iframe className="code-editor-frame" src={url} title="Code Editor" />;
}

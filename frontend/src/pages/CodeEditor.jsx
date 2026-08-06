const CODE_SERVER_PORT = 8443;

export default function CodeEditor() {
  const url = `${window.location.protocol}//${window.location.hostname}:${CODE_SERVER_PORT}`;

  return <iframe className="code-editor-frame" src={url} title="Code Editor" />;
}

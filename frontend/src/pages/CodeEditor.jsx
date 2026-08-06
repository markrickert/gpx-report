const CODE_SERVER_PORT = 8443;

export default function CodeEditor() {
  // code-server has no TLS of its own (see docs/SETUP.md §7) — always http,
  // regardless of whether the frontend itself was loaded over https via Caddy.
  const url = `http://${window.location.hostname}:${CODE_SERVER_PORT}`;

  return <iframe className="code-editor-frame" src={url} title="Code Editor" />;
}

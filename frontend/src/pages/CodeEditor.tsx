import { useEffect, useState } from "react";
import { useMutation, gql } from "@apollo/client";
import { useTheme } from "../theme";

const SET_CODE_SERVER_THEME = gql`
  mutation SetCodeServerTheme($theme: String!) {
    setCodeServerTheme(theme: $theme)
  }
`;

export default function CodeEditor() {
  const url = import.meta.env.VITE_CODE_SERVER_URL;
  const { theme } = useTheme();
  const [setCodeServerTheme] = useMutation(SET_CODE_SERVER_THEME);
  const [reloadKey, setReloadKey] = useState(0);
  const [ready, setReady] = useState(false);

  // code-server's theme is a server-side settings.json value, not a URL
  // param, so it has to be written before the iframe loads and the iframe
  // reloaded after, for the change to actually show up.
  useEffect(() => {
    setCodeServerTheme({ variables: { theme } })
      .catch(() => {})
      .finally(() => {
        setReady(true);
        setReloadKey((k) => k + 1);
      });
  }, [theme, setCodeServerTheme]);

  if (!ready) return null;
  return <iframe key={reloadKey} className="code-editor-frame" src={url} title="Code Editor" />;
}

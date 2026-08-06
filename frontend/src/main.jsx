import React from "react";
import ReactDOM from "react-dom/client";
import { ApolloProvider } from "@apollo/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { apolloClient } from "./apolloClient.js";
import { UnitsProvider } from "./units.jsx";
import { ThemeProvider } from "./theme.jsx";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApolloProvider client={apolloClient}>
      <ThemeProvider>
        <UnitsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </UnitsProvider>
      </ThemeProvider>
    </ApolloProvider>
  </React.StrictMode>
);

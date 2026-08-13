import React from "react";
import ReactDOM from "react-dom/client";
import { ApolloProvider } from "@apollo/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { apolloClient } from "./apolloClient";
import { UnitsProvider } from "./units";
import { ThemeProvider } from "./theme";
import { NotificationsProvider } from "./notifications";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApolloProvider client={apolloClient}>
      <ThemeProvider>
        <UnitsProvider>
          <NotificationsProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </NotificationsProvider>
        </UnitsProvider>
      </ThemeProvider>
    </ApolloProvider>
  </React.StrictMode>,
);

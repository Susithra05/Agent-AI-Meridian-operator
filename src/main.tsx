import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "@/components/desk/desk";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Desk />
  </StrictMode>,
);

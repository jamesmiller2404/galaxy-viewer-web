import React, { useEffect, useState } from "react";
import GalaxyApp from "./GalaxyApp";
import Home from "./Home";
import JupiterLab from "./JupiterLab";

const nebulaThemeVars: Record<string, string> = {
  "--bg": "#0a0f1b",
  "--panel": "#111827",
  "--panel-border": "#1f2937",
  "--accent": "#ff8c5a",
  "--accent-2": "#5eead4",
  "--sky": "#38bdf8",
  "--text": "#e5e7eb",
  "--muted": "#9ca3af",
  "--input": "#212f55ff",
  "--input-border": "#000000ff",
  "--glow": "rgba(255, 140, 90, 0.24)"
};

type AppView = "home" | "galaxy" | "jupiter";

export default function App() {
  const [view, setView] = useState<AppView>("home");

  useEffect(() => {
    if (typeof document === "undefined") return;
    Object.entries(nebulaThemeVars).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, []);

  if (view === "galaxy") {
    return <GalaxyApp onExit={() => setView("home")} />;
  }

  if (view === "jupiter") {
    return <JupiterLab onExit={() => setView("home")} />;
  }

  return (
    <Home
      onLaunchGalaxy={() => setView("galaxy")}
      onLaunchJupiter={() => setView("jupiter")}
    />
  );
}

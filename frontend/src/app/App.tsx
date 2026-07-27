import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Masthead } from "../components/layout/Masthead";
import { BacktestControls } from "../features/backtest/BacktestControls";
import { BacktestResults } from "../features/backtest/BacktestResults";
import { getStrategies } from "../api/endpoints";
import { useUiStore } from "../state/uiStore";

export function App() {
  const strategiesQuery = useQuery({
    queryKey: ["strategies"],
    queryFn: getStrategies,
  });
  const theme = useUiStore((s) => s.theme);

  // Reflect the theme onto the document root so CSS variables switch.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <Masthead backendOk={strategiesQuery.isSuccess} backendError={strategiesQuery.isError} />
      <BacktestControls strategies={strategiesQuery.data ?? []} />
      <main className="results">
        <BacktestResults />
      </main>
    </div>
  );
}

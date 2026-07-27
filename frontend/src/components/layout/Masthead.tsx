import { useUiStore } from "../../state/uiStore";

interface Props {
  backendOk: boolean;
  backendError: boolean;
}

export function Masthead({ backendOk, backendError }: Props) {
  const dotClass = backendError ? "dot err" : backendOk ? "dot ok" : "dot";
  const label = backendError ? "backend offline" : backendOk ? "backend online" : "connecting…";
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  return (
    <header className="mast">
      <div className="brand">
        BACK<b>TEST</b>
      </div>
      <div className="tag">strategy&nbsp;backtest&nbsp;terminal</div>
      <div className="status">
        <span>
          <span className={dotClass} /> {label}
        </span>
        <span>{new Date().toISOString().slice(0, 10)}</span>
        <button
          type="button"
          className="themebtn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? "☾ DARK" : "☀ LIGHT"}
        </button>
      </div>
    </header>
  );
}

import { Link } from "react-router-dom";

interface Props {
  num: string | number;
  label: string;
  sub?: string;
  tone?: "alert" | "wait";
  to?: string;
}

export function Figure({ num, label, sub, tone, to }: Props) {
  const inner = (
    <>
      <span className="num">{num}</span>
      <span className="lbl">{label}</span>
      {sub && <span className="sub">{sub}</span>}
    </>
  );
  const cls = `fig${tone ? ` ${tone}` : ""}`;
  return to ? (
    <Link className={cls} to={to}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Figures({ children, four }: { children: React.ReactNode; four?: boolean }) {
  return <div className={`figures${four ? " four" : ""}`}>{children}</div>;
}

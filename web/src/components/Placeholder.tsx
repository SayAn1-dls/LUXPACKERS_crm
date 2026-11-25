import { useTitle } from "../lib/useTitle";

/** Stand-in for pages that later tasks build. */
export function Placeholder({ title, eyebrow, note }: { title: string; eyebrow?: string; note?: string }) {
  useTitle(title);
  return (
    <>
      <div className="page-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          <p>{note ?? "This page is being built and will be ready soon."}</p>
        </div>
      </div>
    </>
  );
}

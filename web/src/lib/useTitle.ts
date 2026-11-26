import { useEffect } from "react";

export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Luxpackers`;
  }, [title]);
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export const longDate = () =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

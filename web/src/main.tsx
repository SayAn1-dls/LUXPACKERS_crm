import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "Jost, sans-serif", color: "#11181C", background: "#F6F5F1", minHeight: "100vh", padding: "48px" }}>
      <h1 style={{ fontFamily: "'Cormorant Garamond', serif", color: "#7A2333", fontWeight: 600 }}>Luxpackers CRM</h1>
      <p>The new CRM is being built. Nothing to see here yet.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

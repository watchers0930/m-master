export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
      }}
    >
      <div style={{ maxWidth: 760 }}>
        <p
          style={{
            margin: 0,
            color: "#0071e3",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          m-master
        </p>
        <h1
          style={{
            margin: "16px 0 12px",
            fontSize: 48,
            lineHeight: 1.08,
            letterSpacing: "-0.04em",
          }}
        >
          Context-aware marketing platform
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 18,
            lineHeight: 1.6,
            color: "rgba(29,29,31,0.72)",
          }}
        >
          Working folder and domain analysis, source-content generation, multi-channel
          transformation, and AI-powered marketing image workflows.
        </p>
      </div>
    </main>
  );
}

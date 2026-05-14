import { AppHeader } from "@/features/site/app-header";

export default function HomePage() {
  return (
    <div className="app-shell">
      <AppHeader active="home" title="BMI C&S 마케팅" />
      <main
        style={{
          minHeight: "calc(100vh - 56px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f5f7fb",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: "420px",
            padding: "40px 32px",
            borderRadius: "20px",
            background: "#ffffff",
            border: "1px solid #dbe4f0",
            boxShadow: "0 18px 48px rgba(24, 35, 58, 0.08)",
          }}
        >
          <h1
            style={{
              margin: "0 0 24px",
              fontSize: "32px",
              lineHeight: 1.2,
              color: "#18233a",
            }}
          >
            BMI C&amp;S 마케팅
          </h1>

          <form style={{ display: "grid", gap: "14px" }}>
            <label style={{ display: "grid", gap: "6px", color: "#4c5a72", fontWeight: 600 }}>
              이메일
              <input
                type="text"
                name="email"
                defaultValue="marketing@master"
                style={{
                  height: "48px",
                  padding: "0 14px",
                  borderRadius: "12px",
                  border: "1px solid #cfd8e6",
                  background: "#ffffff",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "6px", color: "#4c5a72", fontWeight: 600 }}>
              비밀번호
              <input
                type="password"
                name="password"
                defaultValue="1111"
                style={{
                  height: "48px",
                  padding: "0 14px",
                  borderRadius: "12px",
                  border: "1px solid #cfd8e6",
                  background: "#ffffff",
                }}
              />
            </label>

            <button
              type="submit"
              style={{
                height: "50px",
                marginTop: "8px",
                border: "0",
                borderRadius: "12px",
                background: "#18233a",
                color: "#ffffff",
                fontWeight: 700,
              }}
            >
              로그인
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

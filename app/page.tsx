"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ADMIN_EMAIL = "marketing@master";
const ADMIN_PASSWORD = "1111";

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState(ADMIN_PASSWORD);
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (email.trim() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    setError("");
    router.push("/studio");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
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

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          <label style={{ display: "grid", gap: "6px", color: "#4c5a72", fontWeight: 600 }}>
            이메일
            <input
              type="text"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{
                height: "48px",
                padding: "0 14px",
                borderRadius: "12px",
                border: "1px solid #cfd8e6",
                background: "#ffffff",
              }}
            />
          </label>

          {error ? (
            <p style={{ margin: 0, color: "#dc2626", fontSize: "13px", fontWeight: 600 }}>
              {error}
            </p>
          ) : null}

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
  );
}

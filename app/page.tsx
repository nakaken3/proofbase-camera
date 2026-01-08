"use client";

import { useState, useEffect } from "react";
import { Camera, CameraResultType } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import { suiAnchor } from "../src/lib/sui";

// --- 型定義 ---
interface ScanHistory {
  id: string;
  title: string;
  photoTimestamp: string;
  anchorTimestamp: string;
  hash: string;
  txHash: string;
  imageUrl: string;
  location?: { lat: number; lng: number };
}

// --- スタイル設定 ---
const titleStyle = {
  textAlign: "center" as const,
  margin: "0 0 15px 0",
  fontSize: "20px",
  fontWeight: "900",
  color: "#312E81",
};
const cardStyle = {
  backgroundColor: "rgba(255, 255, 255, 0.75)",
  backdropFilter: "blur(12px)",
  borderRadius: "24px",
  padding: "16px",
  border: "1px solid rgba(255, 255, 255, 0.5)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.05)",
};
const btnStyle = (bg: string, color: string) => ({
  width: "100%",
  padding: "14px",
  background: bg,
  color: color,
  borderRadius: "14px",
  fontSize: "15px",
  fontWeight: "900" as const,
  border: "none",
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  cursor: "pointer",
});
const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid rgba(0,0,0,0.1)",
  fontSize: "14px",
  outline: "none",
  backgroundColor: "rgba(255,255,255,0.9)",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState("home");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [photoTime, setPhotoTime] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // 初期読み込み（安全策を強化）
  useEffect(() => {
    try {
      const saved = localStorage.getItem("proofbase_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
      }
    } catch (e) {
      console.error("Load Error", e);
      setHistory([]);
    }
  }, []);

  const saveHistory = (newHistory: ScanHistory[]) => {
    setHistory(newHistory);
    localStorage.setItem("proofbase_history", JSON.stringify(newHistory));
  };

  const takePhoto = async () => {
    try {
      setLoading(true);
      try {
        const pos = await Geolocation.getCurrentPosition({ timeout: 3000 });
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e) {
        setCoords(null);
      }

      const image = await Camera.getPhoto({
        quality: 90,
        resultType: CameraResultType.Base64,
      });

      if (image?.base64String) {
        setImageUrl(`data:image/${image.format};base64,${image.base64String}`);
        setPhotoTime(new Date().toLocaleString());
        const msgUint8 = new TextEncoder().encode(image.base64String);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        setHash(
          Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        );
        setTitle("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const recordToSui = async () => {
    if (!hash || !imageUrl || !photoTime) return;

    if (
      history.some((item) => item && item.title === (title || "無題の証拠"))
    ) {
      alert("⚠️ 同じタイトルの証拠が既に存在します。");
      return;
    }

    if (history.some((item) => item && item.hash === hash)) {
      alert("⚠️ この画像は既に刻印済みです。別の写真を選び直してください。");
      setHash(null);
      setImageUrl(null);
      takePhoto();
      return;
    }

    try {
      setLoading(true);
      const result = await suiAnchor.anchorSha256(hash);
      const newEntry: ScanHistory = {
        id: Date.now().toString(),
        title: title || "無題の証拠",
        photoTimestamp: photoTime,
        anchorTimestamp: new Date().toLocaleString(),
        hash,
        txHash: result.txHash,
        imageUrl,
        location: coords || undefined,
      };
      saveHistory([newEntry, ...history]);
      setHash(null);
      setImageUrl(null);
      setCoords(null);
      setTitle("");
      alert("✅ Suiに記録しました！");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = (id: string) => {
    if (confirm("この履歴をアプリ内から削除しますか？")) {
      const updated = history.filter((item) => item && item.id !== id);
      saveHistory(updated);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        color: "#111827",
        paddingBottom: "80px",
      }}
    >
      {/* 背景画像 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: 'url("background.png")',
          backgroundSize: "cover",
          zIndex: -1,
        }}
      />

      <div style={{ padding: "15px 15px" }}>
        {/* --- HOME タブ --- */}
        {activeTab === "home" && (
          <section>
            <h1 style={titleStyle}>ProofBase Camera</h1>
            <div style={cardStyle}>
              {!hash ? (
                <button
                  onClick={takePhoto}
                  disabled={loading}
                  style={btnStyle("#6366F1", "#FFF")}
                >
                  {loading ? "準備中..." : "📸 撮影を開始する"}
                </button>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", gap: "12px" }}>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        style={{
                          width: "80px",
                          height: "80px",
                          borderRadius: "12px",
                          objectFit: "cover",
                          border: "2px solid white",
                        }}
                      />
                    )}
                    <div
                      style={{ flex: 1, fontSize: "11px", color: "#4B5563" }}
                    >
                      <div
                        style={{
                          fontWeight: "900",
                          color: "#312E81",
                          marginBottom: "5px",
                        }}
                      >
                        証拠のプレビュー
                      </div>
                      <div>📅 {photoTime}</div>
                      <div>
                        📍{" "}
                        {coords
                          ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
                          : "GPSなし"}
                      </div>
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder="タイトルを入力..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={inputStyle}
                  />
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => setHash(null)}
                      style={{ ...btnStyle("#F3F4F6", "#4B5563"), flex: 1 }}
                    >
                      戻る
                    </button>
                    <button
                      onClick={recordToSui}
                      disabled={loading}
                      style={{
                        ...btnStyle(
                          "linear-gradient(135deg, #7C3AED 0%, #6366F1 100%)",
                          "#FFF"
                        ),
                        flex: 2,
                      }}
                    >
                      {loading ? "刻印中..." : "⚡ Suiに記録"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {history.length > 0 && history[0] && !hash && (
              <div style={{ marginTop: "20px" }}>
                <h2
                  style={{
                    fontSize: "14px",
                    fontWeight: "800",
                    marginBottom: "8px",
                    color: "#312E81",
                  }}
                >
                  最新の記録
                </h2>
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    backdropFilter: "blur(10px)",
                    borderRadius: "16px",
                    padding: "10px",
                    display: "flex",
                    gap: "10px",
                    border: "1px solid rgba(255, 255, 255, 0.4)",
                  }}
                >
                  <img
                    src={history[0].imageUrl}
                    style={{
                      width: "45px",
                      height: "45px",
                      objectFit: "cover",
                      borderRadius: "8px",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: "900",
                        color: "#1F2937",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {history[0].title}
                    </div>
                    <div style={{ color: "#6B7280", fontSize: "10px" }}>
                      {history[0].photoTimestamp}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- HISTORY タブ --- */}
        {activeTab === "history" && (
          <section>
            <h1 style={titleStyle}>履歴検索</h1>
            <input
              type="text"
              placeholder="タイトルで検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...inputStyle, marginBottom: "15px" }}
            />
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {history && history.length > 0 ? (
                history
                  .filter(
                    (item) =>
                      item &&
                      item.title &&
                      item.title
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{
                        backgroundColor: "rgba(255, 255, 255, 0.7)",
                        backdropFilter: "blur(10px)",
                        borderRadius: "16px",
                        padding: "10px",
                        display: "flex",
                        gap: "10px",
                        border: "1px solid rgba(255, 255, 255, 0.4)",
                      }}
                    >
                      <img
                        src={item.imageUrl}
                        style={{
                          width: "50px",
                          height: "50px",
                          objectFit: "cover",
                          borderRadius: "8px",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0, fontSize: "11px" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: "900",
                              color: "#1F2937",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.title}
                          </div>
                          <button
                            onClick={() => deleteItem(item.id)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                        <div style={{ color: "#6B7280", fontSize: "10px" }}>
                          {item.photoTimestamp}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "12px",
                            marginTop: "5px",
                          }}
                        >
                          <a
                            href={`https://suiscan.xyz/mainnet/tx/${item.txHash}`}
                            target="_blank"
                            style={{
                              color: "#4F46E5",
                              fontWeight: "700",
                              textDecoration: "none",
                            }}
                          >
                            SuiScan ↗
                          </a>
                          {item.location && (
                            <a
                              href={`https://www.google.com/maps?q=${item.location.lat},${item.location.lng}`}
                              target="_blank"
                              style={{
                                color: "#10B981",
                                fontWeight: "700",
                                textDecoration: "none",
                              }}
                            >
                              📍Map
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
              ) : (
                <p
                  style={{
                    textAlign: "center",
                    fontSize: "12px",
                    opacity: 0.6,
                    marginTop: "20px",
                  }}
                >
                  記録がありません
                </p>
              )}
            </div>
          </section>
        )}

        {/* --- OTHER タブ --- */}
        {(activeTab === "verify" || activeTab === "cert") && (
          <section style={{ textAlign: "center", paddingTop: "50px" }}>
            <div style={{ fontSize: "40px", marginBottom: "10px" }}>
              {activeTab === "verify" ? "🔍" : "✉️"}
            </div>
            <h1 style={titleStyle}>
              {activeTab === "verify" ? "証拠照合" : "証明書発行"}
            </h1>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>
              この機能は現在準備中です
            </p>
          </section>
        )}
      </div>

      {/* --- タブメニュー（固定） --- */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "70px",
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(15px)",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          borderTop: "1px solid #E5E7EB",
          zIndex: 100,
        }}
      >
        {[
          { id: "home", label: "撮影", icon: "📸" },
          { id: "history", label: "履歴", icon: "📜" },
          { id: "verify", label: "照合", icon: "🔍" },
          { id: "cert", label: "証明", icon: "✉️" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              background: "none",
              border: "none",
              width: "25%",
              color: activeTab === tab.id ? "#6366F1" : "#9CA3AF",
            }}
          >
            <span style={{ fontSize: "22px" }}>{tab.icon}</span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: activeTab === tab.id ? "900" : "500",
              }}
            >
              {tab.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

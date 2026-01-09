"use client";

import { useState, useEffect } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import { Share } from "@capacitor/share";
import { suiAnchor } from "../src/lib/sui";
import { Filesystem, Directory } from "@capacitor/filesystem";

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
  // ✅追加：アプリ領域に固定保存したファイルURI（照合で使う）
  masterUri: string;
}

// --- 共通スタイル ---
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
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(false);

  // 撮影用ステート
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [photoTime, setPhotoTime] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [title, setTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // 照合・証明書用ステート
  const [verifyResult, setVerifyResult] = useState<ScanHistory | null>(null);
  const [verifyError, setVerifyError] = useState(false);
  const [selectedCert, setSelectedCert] = useState<ScanHistory | null>(null);

  // 既存のステートの下に追加
  const [remainingCredits, setRemainingCredits] = useState<number>(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false); // メニュー開閉用

  // 拡張機能の成功パターンを100%踏襲した共通エンジン
  const generateImageId = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const rawHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `0x${rawHash.toLowerCase()}`; // 強制的に小文字+0x
  };

  const generatePixelHash = async (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        // サイズを固定して正規化（OSによるリサイズの差異を消す）
        canvas.width = 1000;
        canvas.height = 1000;
        ctx.drawImage(img, 0, 0, 1000, 1000);

        // 純粋な画素データ（RGBA）のみを取得
        const imageData = ctx.getImageData(0, 0, 1000, 1000).data;
        const hashBuffer = await crypto.subtle.digest("SHA-256", imageData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        resolve(hashHex.toLowerCase());
      };
      img.src = dataUrl;
    });
  };

  // useEffect の中で保存された回数を読み込む
  useEffect(() => {
    const savedCredits = localStorage.getItem("proofbase_credits");
    if (savedCredits) {
      setRemainingCredits(parseInt(savedCredits));
    } else {
      // 初回インストール特典として例えば3回分付与
      setRemainingCredits(3);
      localStorage.setItem("proofbase_credits", "3");
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("proofbase_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch (e) {
      console.error("Load Error", e);
    }
  }, []);

  const saveHistory = (newHistory: ScanHistory[]) => {
    setHistory(newHistory);
    localStorage.setItem("proofbase_history", JSON.stringify(newHistory));
  };

  // ===== 共通ヘルパー（この3関数の上に置いてください） =====
  const base64ToBytes = (base64: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
    const stable = new Uint8Array(bytes); // 強制コピー（最強に安定）
    const hashBuffer = await crypto.subtle.digest("SHA-256", stable);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();
  };

  // ※ ScanHistory に masterUri を足すのが推奨です（既存データも壊さない）
  // interface ScanHistory {
  //   id: string;
  //   title: string;
  //   photoTimestamp: string;
  //   anchorTimestamp: string;
  //   hash: string;
  //   txHash: string;
  //   imageUrl: string;
  //   location?: { lat: number; lng: number };
  //   masterUri?: string; // ★追加（アプリ領域の正本）
  // }

  // --- 撮影・選択処理（キャンセル対応・位置情報・物理コピー） ---
  const takePhoto = async () => {
    try {
      setLoading(true);

      const image = await Camera.getPhoto({
        quality: 100,
        resultType: CameraResultType.Uri,
        // ✅ 方針：撮影はアルバムに残さない（正本はアプリ領域）
        //    ただし、アルバムから選択して刻印する導線は CameraSource.Prompt で維持される
        saveToGallery: false,
        source: CameraSource.Prompt,
      });

      if (!image || !image.path) return;

      const imgSource = (image as any).source;
      const exifData = (image as any).exif;

      // coords は state の反映が遅れるので、alert 用にローカルも持つ
      let nextCoords: { lat: number; lng: number } | null = null;
      setCoords(null);

      // 位置情報
      if (imgSource === "Camera") {
        try {
          const pos = await Geolocation.getCurrentPosition({
            timeout: 5000,
            enableHighAccuracy: true,
          });
          nextCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(nextCoords);
        } catch {
          nextCoords = null;
          setCoords(null);
        }
      } else if (imgSource === "Photos") {
        // アルバムの場合：ExifのGPSがあれば採用、なければ null
        if (exifData?.GPSLatitude && exifData?.GPSLongitude) {
          nextCoords = {
            lat: exifData.GPSLatitude,
            lng: exifData.GPSLongitude,
          };
          setCoords(nextCoords);
        } else {
          nextCoords = null;
          setCoords(null);
        }
      }

      // 撮影直後はOS処理が残ることがあるので少し待つ
      await new Promise((r) => setTimeout(r, 800));

      // ✅ 物理固定マスター作成（read → write）
      const masterName = `proof_${Date.now()}.jpg`;

      // image.path から base64 を読む（content:// でも読める端末が多い）
      const src = await Filesystem.readFile({ path: image.path });
      const base64 = typeof src.data === "string" ? src.data : "";

      if (!base64) {
        alert("⚠️ 画像データの読み込みに失敗しました。");
        return;
      }

      // Data領域に “同じbytes” を保存（正本）
      await Filesystem.writeFile({
        path: masterName,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      });

      // Data領域のURIを取得しておく（後で readFile しやすい）
      const uriRes = await Filesystem.getUri({
        directory: Directory.Data,
        path: masterName,
      });

      // 日時（Exif必須ガード）
      let capturedTime = exifData?.DateTimeOriginal || exifData?.DateTime;
      if (imgSource === "Photos" && !capturedTime) {
        alert("⚠️ アルバムから選択する場合、撮影日時（Exif）が必須です。");
        return;
      }
      if (!capturedTime) capturedTime = new Date().toLocaleString();

      // ステート更新
      setImageUrl(image.webPath ?? null); // 表示用（プレビュー）
      setHash(uriRes.uri); // ✅ 固定マスターのURI（正本）
      setPhotoTime(capturedTime);

      alert(
        `【取得完了】\n位置情報: ${
          nextCoords ? "取得済み" : "なし(location-none)"
        }`
      );
    } catch (e: any) {
      console.log("User cancelled or error:", e?.message);
    } finally {
      setLoading(false);
    }
  };

  // --- 刻印処理（省略・機能落ちなし全文） ---
  const recordToSui = async () => {
    // 【機能維持】基本バリデーション
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      alert("⚠️ タイトルを入力してください。証拠の管理に必要です。");
      return;
    }
    if (!imageUrl || !hash || !photoTime) {
      alert("⚠️ 撮影データが不完全です。もう一度撮影してください。");
      return;
    }

    const rawSaved = localStorage.getItem("proofbase_history");
    const currentHistory: ScanHistory[] = rawSaved ? JSON.parse(rawSaved) : [];

    // 【機能維持】タイトル重複チェック
    if (currentHistory.some((item) => item && item.title === trimmedTitle)) {
      alert("⚠️ 同じタイトルの証拠が既に存在します。");
      return;
    }

    try {
      setLoading(true);

      // ✅ 【原本(アプリ領域 master)から指紋生成】
      const readFile = await Filesystem.readFile({ path: hash });
      const base64 = typeof readFile.data === "string" ? readFile.data : "";

      if (!base64) {
        alert("⚠️ 正本(master)の読み込みに失敗しました。");
        return;
      }

      const bytes = base64ToBytes(base64);
      const currentId = await sha256Hex(bytes);

      console.log("[RECORD] masterPath(hash)=", hash);
      console.log("[RECORD] readFile length(base64)=", base64.length);
      console.log("[RECORD] bytes length=", bytes.length);
      console.log("[RECORD] currentId=", currentId);

      // 【機能維持】画像重複チェック
      if (
        currentHistory.some(
          (item) => item && item.id?.toLowerCase() === currentId
        )
      ) {
        alert("⚠️ この画像は既に刻印済みです。");
        setHash(null);
        setImageUrl(null);
        setLoading(false);
        return;
      }

      // 【機能維持】チケットチェック
      if (remainingCredits <= 0) {
        alert("🎟️ チケット不足です。設定メニューから追加してください。");
        setIsMenuOpen(true);
        setLoading(false);
        return;
      }

      // 黄金レシピ（位置情報がない場合は location-none）
      const locStr = coords
        ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`
        : "location-none";

      const combined = currentId + "|" + photoTime + "|" + locStr;
      const combinedBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(combined)
      );

      const finalSuiHash =
        "0x" +
        Array.from(new Uint8Array(combinedBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toLowerCase();

      // Sui刻印
      if (!suiAnchor) throw new Error("Sui接続エラー");
      const result = await suiAnchor.anchorSha256(finalSuiHash);

      // 履歴保存（全情報を保持）
      const newEntry: ScanHistory = {
        id: currentId,
        title: trimmedTitle,
        photoTimestamp: photoTime,
        anchorTimestamp: new Date().toLocaleString(),
        hash: finalSuiHash,
        txHash: result.txHash,
        imageUrl: imageUrl,
        location: coords || undefined,
        // ✅ 照合の主役：アプリ領域の正本URI
        masterUri: hash,
      };

      const updatedHistory = [newEntry, ...currentHistory];
      setHistory(updatedHistory);
      localStorage.setItem("proofbase_history", JSON.stringify(updatedHistory));

      // クリーンアップ
      setRemainingCredits((prev) => prev - 1);
      setHash(null);
      setImageUrl(null);
      setTitle("");
      alert("✅ 刻印が完了しました！");
    } catch (e: any) {
      alert("🚫 実行エラー: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- 照合処理（アプリ内優先 + アルバムは注意喚起）---
  const handleVerify = async () => {
    setVerifyResult(null);
    setVerifyError(false);

    try {
      setLoading(true);

      const rawSaved = localStorage.getItem("proofbase_history");
      const latestHistory: ScanHistory[] = rawSaved ? JSON.parse(rawSaved) : [];

      if (!latestHistory || latestHistory.length === 0) {
        alert("⚠️ アプリ内に刻印履歴がありません。");
        setVerifyError(true);
        return;
      }

      // ✅ 方針：基本は「アプリ内(master)の写真のみ」を選んで照合する
      // オプションでアルバム照合も残す（ただし一致しない可能性を全面に警告）
      const useAlbum = window.confirm(
        [
          "照合方法を選んでください。",
          "",
          "OK：アルバムから選んで照合（⚠️最適化等で一致しない可能性あり）",
          "キャンセル：アプリ内に保存された写真（正本）から照合（推奨・確実）",
        ].join("\n")
      );

      // ========= A) 推奨：アプリ内（masterUri）から照合 =========
      if (!useAlbum) {
        // masterUri が入っている履歴だけ対象（古い履歴でも動作は落とさない）
        const candidates = latestHistory
          .map((h, idx) => ({ h, idx }))
          .filter(
            ({ h }) =>
              typeof (h as any).masterUri === "string" && !!(h as any).masterUri
          );

        if (candidates.length === 0) {
          alert(
            [
              "⚠️ この端末の履歴には masterUri が保存されていないため、",
              "「アプリ内の正本からの照合（推奨）」ができません。",
              "",
              "対処：新しい版（masterUri保存あり）で刻印した履歴から照合してください。",
            ].join("\n")
          );
          setVerifyError(true);
          return;
        }

        // 簡易UI：promptで選択（追加UIなしで機能落ちさせない）
        const listText = candidates
          .slice(0, 30) // 長すぎると辛いので上限（機能は落ちない）
          .map(({ h, idx }, i) => `${i + 1}. ${h.title} / ${h.photoTimestamp}`)
          .join("\n");

        const pick = window.prompt(
          [
            "アプリ内の刻印履歴から照合対象を選んでください（番号入力）",
            "",
            listText,
            "",
            "例：1",
          ].join("\n")
        );

        if (!pick) return;

        const n = Number(pick);
        if (
          !Number.isFinite(n) ||
          n < 1 ||
          n > Math.min(candidates.length, 30)
        ) {
          alert("⚠️ 番号が不正です。");
          setVerifyError(true);
          return;
        }

        const chosen = candidates[n - 1].h;
        const masterUri = (chosen as any).masterUri as string;

        // 正本(masterUri)を読んでSHA
        const readFile = await Filesystem.readFile({ path: masterUri });
        const base64 = typeof readFile.data === "string" ? readFile.data : "";

        if (!base64) {
          alert("⚠️ 正本(master)の読み込みに失敗しました。");
          setVerifyError(true);
          return;
        }

        const bytes = base64ToBytes(base64);
        const currentImgId = await sha256Hex(bytes);

        console.log("[VERIFY:APP] masterUri=", masterUri);
        console.log("[VERIFY:APP] readFile length(base64)=", base64.length);
        console.log("[VERIFY:APP] bytes length=", bytes.length);
        console.log("[VERIFY:APP] currentImgId=", currentImgId);
        console.log("[VERIFY:APP] stored id=", chosen.id);

        // 念のため：履歴内のidと一致しているか（設計的には一致するはず）
        if (currentImgId !== chosen.id?.toLowerCase()) {
          alert(
            [
              "⚠️ 正本のSHAと履歴のSHAが一致しません。",
              "（履歴が古い/移行前/ファイルが消えた可能性）",
            ].join("\n")
          );
          setVerifyError(true);
          return;
        }

        // 黄金レシピ再現
        const locStr = chosen.location
          ? `${chosen.location.lat.toFixed(5)},${chosen.location.lng.toFixed(
              5
            )}`
          : "location-none";

        const combined =
          currentImgId + "|" + chosen.photoTimestamp + "|" + locStr;
        const combinedBuffer = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(combined)
        );

        const verifyFinalHash =
          "0x" +
          Array.from(new Uint8Array(combinedBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .toLowerCase();

        if (verifyFinalHash === chosen.hash.toLowerCase()) {
          setVerifyResult(chosen);
          alert(`✅ 証拠が確認されました！\nタイトル: ${chosen.title}`);
        } else {
          alert(
            "⚠️ 画像は一致しましたが、メタデータ（時刻・位置）が異なります。"
          );
          setVerifyError(true);
        }

        return;
      }

      // ========= B) オプション：アルバムから照合（不一致の可能性を警告） =========
      alert(
        [
          "⚠️ アルバム照合モード",
          "アルバム側の最適化・バックアップ・形式変換により",
          "“同じ見た目でもbytesが変わり” SHA が一致しないことがあります。",
          "",
          "可能な限り確実な照合は「アプリ内（正本）照合」を使ってください。",
        ].join("\n")
      );

      const image = await Camera.getPhoto({
        quality: 100,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
      });

      console.log("[VERIFY:ALBUM] image.path=", image?.path);
      console.log("[VERIFY:ALBUM] image.webPath=", image?.webPath);

      if (!image || !image.path) return;

      // アルバム画像を read → Dataに固定化 → その固定化bytesでSHA
      const verifyMasterName = `verify_${Date.now()}.jpg`;

      const src = await Filesystem.readFile({ path: image.path });
      const base64 = typeof src.data === "string" ? src.data : "";

      if (!base64) {
        alert("⚠️ 画像データの読み込みに失敗しました。");
        setVerifyError(true);
        return;
      }

      await Filesystem.writeFile({
        path: verifyMasterName,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      });

      const uriRes = await Filesystem.getUri({
        directory: Directory.Data,
        path: verifyMasterName,
      });

      const readFile = await Filesystem.readFile({ path: uriRes.uri });
      const base64Master =
        typeof readFile.data === "string" ? readFile.data : "";

      if (!base64Master) {
        alert("⚠️ 照合用masterの読み込みに失敗しました。");
        setVerifyError(true);
        return;
      }

      const bytes = base64ToBytes(base64Master);
      const currentImgId = await sha256Hex(bytes);

      console.log(
        "[VERIFY:ALBUM] readFile length(base64)=",
        base64Master.length
      );
      console.log("[VERIFY:ALBUM] bytes length=", bytes.length);
      console.log("[VERIFY:ALBUM] currentImgId=", currentImgId);

      const match = latestHistory.find(
        (item) => item && item.id?.toLowerCase() === currentImgId
      );

      if (!match) {
        alert(
          "❌ 登録されていません。\n（アルバム原本基準のSHAが一致しません：これは仕様上起こり得ます）"
        );
        setVerifyError(true);
        return;
      }

      const locStr = match.location
        ? `${match.location.lat.toFixed(5)},${match.location.lng.toFixed(5)}`
        : "location-none";

      const combined = currentImgId + "|" + match.photoTimestamp + "|" + locStr;

      const combinedBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(combined)
      );

      const verifyFinalHash =
        "0x" +
        Array.from(new Uint8Array(combinedBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .toLowerCase();

      if (verifyFinalHash === match.hash.toLowerCase()) {
        setVerifyResult(match);
        alert(`✅ 証拠が確認されました！\nタイトル: ${match.title}`);
      } else {
        alert(
          "⚠️ 画像は一致しましたが、メタデータ（時刻・位置）が異なります。"
        );
        setVerifyError(true);
      }
    } catch (e: any) {
      console.log("Verify cancelled:", e?.message);
    } finally {
      setLoading(false);
    }
  };

  const shareCertificate = async (item: ScanHistory) => {
    try {
      const text = `【ProofBase 証拠証明書】\nタイトル: ${item.title}\n日時: ${item.photoTimestamp}\nSuiScan: https://suiscan.xyz/mainnet/tx/${item.txHash}`;
      await Share.share({
        title: "証拠証明書",
        text: text,
        url: item.imageUrl,
        dialogTitle: "証明書を共有",
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteItem = (id: string) => {
    if (confirm("この履歴をアプリ内から削除しますか？")) {
      saveHistory(history.filter((item) => item && item.id !== id));
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
        {/* --- ヘッダー部分 --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <div style={{ width: "40px" }}></div> {/* 中央寄せのためのダミー */}
          <h1 style={{ ...titleStyle, margin: 0 }}>ProofBase Camera</h1>
          <button
            onClick={() => setIsMenuOpen(true)}
            style={{
              background: "none",
              border: "none",
              fontSize: "24px",
              cursor: "pointer",
            }}
          >
            ⚙️
          </button>
        </div>

        {/* --- HOME タブ --- */}
        {activeTab === "home" && (
          <section>
            {/* ステータスバー（残り回数） */}
            {!hash && (
              <div
                style={{
                  backgroundColor: "rgba(49, 46, 129, 0.9)",
                  borderRadius: "14px",
                  padding: "10px 15px",
                  marginBottom: "15px",
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#FFF",
                  fontSize: "13px",
                }}
              >
                <span>🎟️ 残り刻印可能回数</span>
                <span style={{ fontWeight: "900" }}>{remainingCredits} 回</span>
              </div>
            )}

            {/* メインカードエリア */}
            <div style={{ ...cardStyle, marginBottom: "20px" }}>
              {!hash ? (
                /* 1. 撮影前のボタン表示 */
                <button
                  onClick={takePhoto}
                  disabled={loading}
                  style={btnStyle("#6366F1", "#FFF")}
                >
                  {loading ? "準備中..." : "📸 撮影・選択を開始"}
                </button>
              ) : (
                /* 2. 撮影後のプレビュー表示（ここが真っ白になっていた箇所） */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      height: "180px",
                      borderRadius: "12px",
                      overflow: "hidden",
                    }}
                  >
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                        alt="Preview"
                      />
                    )}
                  </div>

                  <div
                    style={{
                      padding: "10px",
                      backgroundColor: "rgba(99, 102, 241, 0.05)",
                      borderRadius: "10px",
                      fontSize: "11px",
                      color: "#4B5563",
                    }}
                  >
                    <div>🕒 撮影日時: {photoTime}</div>
                    <div>
                      📍 位置情報:{" "}
                      {coords
                        ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
                        : "位置情報不明"}
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="証拠のタイトルを入力..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={inputStyle}
                  />

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => {
                        setHash(null);
                        setImageUrl(null);
                      }}
                      style={{ ...btnStyle("#F3F4F6", "#4B5563"), flex: 1 }}
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={recordToSui}
                      disabled={loading || remainingCredits <= 0}
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

            {/* ガイド（撮影前のみ表示） */}
            {!hash && (
              <div
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  backdropFilter: "blur(8px)",
                  borderRadius: "20px",
                  padding: "20px",
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: "#374151",
                  border: "1px solid rgba(255, 255, 255, 0.4)",
                }}
              >
                <div
                  style={{
                    fontWeight: "900",
                    marginBottom: "8px",
                    color: "#312E81",
                    fontSize: "15px",
                  }}
                >
                  🛡️ Web3証拠保存ガイド
                </div>
                <p style={{ margin: "0 0 8px 0" }}>
                  このアプリは、写真に「撮影日時」と「位置情報」を一体化してSuiブロックチェーンに刻印します。
                </p>
                <ul style={{ paddingLeft: "18px", margin: "0" }}>
                  <li>
                    <strong>信頼性:</strong> 刻印後のデータは改ざんできません。
                  </li>
                  <li>
                    <strong>アルバム:</strong>{" "}
                    撮影日時情報(Exif)がある写真のみ受理されます。
                  </li>
                  <li>
                    <strong>検証:</strong>{" "}
                    「照合」タブから本物かどうかを判定できます。
                  </li>
                </ul>
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
                        <button
                          onClick={() => setSelectedCert(item)}
                          style={{
                            color: "#6366F1",
                            border: "none",
                            background: "none",
                            padding: 0,
                            fontSize: "11px",
                            fontWeight: "bold",
                            marginTop: "5px",
                          }}
                        >
                          📜 証明書を表示 ↗
                        </button>
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

        {/* --- VERIFY タブ --- */}
        {activeTab === "verify" && (
          <section>
            <h1 style={titleStyle}>証拠照合</h1>
            <div style={cardStyle}>
              <button
                onClick={handleVerify}
                disabled={loading}
                style={btnStyle("#10B981", "#FFF")}
              >
                🔍 画像を選択して鑑定
              </button>
              {verifyResult && (
                <div style={{ marginTop: "15px", textAlign: "center" }}>
                  <div
                    style={{
                      color: "#065F46",
                      fontWeight: "900",
                      marginBottom: "10px",
                    }}
                  >
                    ✅ 本物と認定されました
                  </div>
                  <button
                    onClick={() => setSelectedCert(verifyResult)}
                    style={btnStyle("#6366F1", "#FFF")}
                  >
                    📜 証明書を表示
                  </button>
                </div>
              )}
              {verifyError && (
                <div
                  style={{
                    marginTop: "15px",
                    color: "#991B1B",
                    textAlign: "center",
                  }}
                >
                  ❌ 記録が見つかりません
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* --- 証明書モーダル (全画面) --- */}
      {selectedCert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "15px",
            backdropFilter: "blur(5px)",
          }}
        >
          <div
            style={{
              backgroundColor: "#FFF",
              width: "100%",
              maxWidth: "380px",
              borderRadius: "28px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setSelectedCert(null)}
              style={{
                position: "absolute",
                top: "15px",
                right: "15px",
                background: "#F3F4F6",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                fontWeight: "bold",
              }}
            >
              ✕
            </button>
            <div style={{ padding: "25px 20px", textAlign: "center" }}>
              <div
                style={{
                  color: "#312E81",
                  fontSize: "20px",
                  fontWeight: "900",
                  marginBottom: "5px",
                }}
              >
                証拠証明書
              </div>
              <div
                style={{
                  fontSize: "10px",
                  color: "#6B7280",
                  marginBottom: "15px",
                }}
              >
                ProofBase Web3 Evidence Protocol
              </div>

              <div
                style={{
                  width: "100%",
                  height: "180px",
                  backgroundColor: "#F9FAFB",
                  borderRadius: "16px",
                  marginBottom: "15px",
                  overflow: "hidden",
                  border: "1px solid #E5E7EB",
                }}
              >
                <img
                  src={selectedCert.imageUrl}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>

              <div
                style={{
                  textAlign: "left",
                  fontSize: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  borderTop: "2px solid #F3F4F6",
                  paddingTop: "15px",
                }}
              >
                <div>
                  <strong>タイトル:</strong> {selectedCert.title}
                </div>
                <div>
                  <strong>撮影日時:</strong> {selectedCert.photoTimestamp}
                </div>

                {/* 位置情報の表示切り替え */}
                <div>
                  <strong>位置情報:</strong>{" "}
                  {selectedCert.location ? (
                    <span style={{ color: "#10B981", fontWeight: "bold" }}>
                      {selectedCert.location.lat.toFixed(5)},{" "}
                      {selectedCert.location.lng.toFixed(5)}
                      <a
                        href={`https://www.google.com/maps?q=${selectedCert.location.lat},${selectedCert.location.lng}`}
                        target="_blank"
                        style={{
                          marginLeft: "8px",
                          color: "#6366F1",
                          textDecoration: "underline",
                        }}
                      >
                        Map ↗
                      </a>
                    </span>
                  ) : (
                    <span style={{ color: "#9CA3AF" }}>位置情報不明</span>
                  )}
                </div>

                <div
                  style={{
                    wordBreak: "break-all",
                    fontSize: "9px",
                    opacity: 0.7,
                    backgroundColor: "#F9FAFB",
                    padding: "5px",
                    borderRadius: "5px",
                  }}
                >
                  <strong>ハッシュ:</strong> {selectedCert.hash}
                </div>
              </div>

              {/* ボタンエリアの修正: box-sizingとwidthの調整 */}
              <div
                style={{
                  marginTop: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <a
                  href={`https://suiscan.xyz/mainnet/tx/${selectedCert.txHash}`}
                  target="_blank"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px",
                    background: "#FFF",
                    color: "#312E81",
                    borderRadius: "12px",
                    fontSize: "14px",
                    fontWeight: "900",
                    border: "2px solid #312E81",
                    textDecoration: "none",
                    boxSizing: "border-box",
                    width: "100%",
                  }}
                >
                  🌐 SuiScanで確認
                </a>
                <button
                  onClick={() => shareCertificate(selectedCert)}
                  style={{
                    ...btnStyle("#7C3AED", "#FFF"),
                    boxSizing: "border-box",
                    width: "100%",
                  }}
                >
                  ✉️ 証明書を共有
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- タブバー --- */}
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
              width: "33%",
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
      {/* --- 設定・メニュー画面 (サイドメニュー) --- */}
      {isMenuOpen && (
        <div
          onClick={() => setIsMenuOpen(false)} // 背景タップで閉じる
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            zIndex: 2000,
            display: "flex",
            justifyContent: "flex-end",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()} // メニュー内タップでは閉じない
            style={{
              width: "80%",
              height: "100%",
              backgroundColor: "#FFF",
              padding: "30px 20px",
              boxShadow: "-10px 0 30px rgba(0,0,0,0.2)",
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              onClick={() => setIsMenuOpen(false)}
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                border: "none",
                background: "#F3F4F6",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                fontWeight: "bold",
              }}
            >
              ✕
            </button>

            <h2
              style={{
                color: "#312E81",
                fontSize: "20px",
                fontWeight: "900",
                marginTop: "20px",
                marginBottom: "30px",
                borderBottom: "2px solid #F3F4F6",
                paddingBottom: "10px",
              }}
            >
              設定・情報
            </h2>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "25px",
                flex: 1,
              }}
            >
              {/* ステータス */}
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    marginBottom: "5px",
                  }}
                >
                  現在のアカウント
                </div>
                <div
                  style={{
                    backgroundColor: "#F9FAFB",
                    padding: "15px",
                    borderRadius: "14px",
                    border: "1px solid #E5E7EB",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#4B5563" }}>
                    🎟️ 残り刻印可能回数
                  </div>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "900",
                      color: "#312E81",
                    }}
                  >
                    {remainingCredits}{" "}
                    <span style={{ fontSize: "12px" }}>回</span>
                  </div>
                </div>
              </div>

              {/* 購入セクション */}
              <div>
                <button
                  onClick={() => {
                    localStorage.clear();
                    alert(
                      "履歴をリセットしました。アプリを再起動してください。"
                    );
                    window.location.reload();
                  }}
                  style={btnStyle("#EF4444", "#FFF")}
                >
                  ⚠️ 全データをリセットする
                </button>

                <div
                  style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    marginBottom: "10px",
                  }}
                >
                  チケットを追加 (Preview)
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {/* メニュー内の購入ボタン部分を一時的に書き換え */}
                  <button
                    onClick={() => {
                      const nextCredits = remainingCredits + 10;
                      setRemainingCredits(nextCredits);
                      localStorage.setItem(
                        "proofbase_credits",
                        nextCredits.toString()
                      );
                      alert("テスト用：10回分追加しました");
                    }}
                    style={btnStyle("#10B981", "#FFF")}
                  >
                    🎫 10回分を追加（テスト用）
                  </button>
                  <button style={btnStyle("#10B981", "#FFF")}>
                    🎫 10回分を購入 (¥100)
                  </button>
                  <button style={btnStyle("#7C3AED", "#FFF")}>
                    💎 100回分を購入 (¥1000)
                  </button>
                </div>
              </div>

              {/* 規約・ポリシー */}
              <div
                style={{
                  borderTop: "1px solid #EEE",
                  paddingTop: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "15px",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    color: "#4B5563",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  📄 利用規約 <span>›</span>
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    color: "#4B5563",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  🔒 プライバシーポリシー <span>›</span>
                </div>
              </div>
            </div>

            {/* バージョン情報 */}
            <div
              style={{
                fontSize: "11px",
                color: "#9CA3AF",
                textAlign: "center",
                paddingTop: "20px",
              }}
            >
              ProofBase Camera v1.0.0
            </div>
          </div>
        </div>
      )}
      {/* ↑↑↑ ここまで挿入 ↑↑↑ */}
    </div>
  );
}

import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

// 環境変数の読み込み
/*
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet") as
  | "mainnet"
  | "testnet"
  | "devnet"
  | "localnet";

const SUI_PRIV = process.env.SUI_PRIVATE_KEY!;
const PKG = process.env.NEXT_PUBLIC_SUI_PACKAGE_ID!;
const MOD = process.env.NEXT_PUBLIC_SUI_MODULE_NAME!;
const FUN = process.env.NEXT_PUBLIC_SUI_FUNCTION_NAME!;
*/
const NETWORK = "mainnet"; // または "testnet"
const RPC = getFullnodeUrl(NETWORK);

const SUI_PRIV =
  "suiprivkey1qq4j0rg4hkmntgzgezh2pgv8j9fqw7z39ap04mj634gzw6v2cpvykzm2pmn"; // あなたの秘密鍵を直接貼る
const PKG =
  "0x91d88ce05a5a98a81fb1bb4390cb0edea3d3fc18210691da78545a7bb1a38086";
const MOD = "proofbase";
const FUN = "record";

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export class SuiAnchorService {
  private client: SuiClient;
  private keypair: Ed25519Keypair | null = null; // 初期値はnullに

  constructor() {
    this.client = new SuiClient({ url: RPC });

    // 秘密鍵がある場合のみキーペアを作成（エラーで落とさない）
    if (SUI_PRIV) {
      try {
        const { secretKey } = decodeSuiPrivateKey(SUI_PRIV);
        this.keypair = Ed25519Keypair.fromSecretKey(secretKey);
      } catch (e) {
        console.error("Invalid Private Key", e);
      }
    }
  }

  async anchorSha256(sha256Hex: string) {
    if (!this.keypair) {
      throw new Error("秘密鍵が設定されていないため、刻印できません。");
    }

    const tx = new Transaction();
    tx.moveCall({
      target: `${PKG}::${MOD}::${FUN}`,
      arguments: [tx.pure.vector("u8", Array.from(hexToBytes(sha256Hex)))],
    });

    const res = await this.client.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: tx,
    });

    return { txHash: res.digest };
  }
}

export const suiAnchor = new SuiAnchorService();

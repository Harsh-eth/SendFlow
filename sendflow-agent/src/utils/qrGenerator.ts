import QRCode from "qrcode";

export async function generateWalletQR(address: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(address, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}

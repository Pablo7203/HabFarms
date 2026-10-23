import { z } from "zod";

export const receiptSourceSchema = z.enum(["feed_purchase", "raw_material_purchase", "expense"]);
const receiptExtensions: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
};

export async function validateReceiptUpload(sourceType: unknown, sourceId: unknown, file: unknown) {
  const source = receiptSourceSchema.safeParse(sourceType);
  if (!source.success || !z.uuid().safeParse(sourceId).success) {
    return { ok: false as const, message: "Choose a valid purchase or expense record." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false as const, message: "Choose an image receipt first." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false as const, message: "Receipt images must be 10 MB or smaller." };
  }
  const extensions = receiptExtensions[file.type];
  const lowerName = file.name.toLowerCase();
  if (!extensions?.some((extension) => lowerName.endsWith(extension))) {
    return { ok: false as const, message: "Use a JPEG, PNG, GIF, or WebP receipt image with a matching file extension." };
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const validSignature = file.type === "image/jpeg" ? startsWith([0xff, 0xd8, 0xff])
    : file.type === "image/png" ? startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : file.type === "image/gif" ? startsWith([0x47, 0x49, 0x46, 0x38]) && [0x37, 0x39].includes(bytes[4]) && bytes[5] === 0x61
    : startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!validSignature) {
    return { ok: false as const, message: "This file does not appear to be a valid receipt image." };
  }
  return { ok: true as const, sourceType: source.data, sourceId: sourceId as string, file };
}

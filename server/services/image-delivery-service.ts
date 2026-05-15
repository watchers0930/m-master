import { getImageAssetById } from "../repositories/project-repository";

function decodeSvgDataUrl(dataUrl: string) {
  const matched = dataUrl.match(/^data:image\/svg\+xml;charset=utf-8,(.+)$/);

  if (!matched) {
    return null;
  }

  return {
    contentType: "image/svg+xml; charset=utf-8",
    buffer: Buffer.from(decodeURIComponent(matched[1]), "utf8"),
  };
}

function decodeBase64DataUrl(dataUrl: string) {
  const matched = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!matched) {
    return null;
  }

  return {
    contentType: matched[1],
    buffer: Buffer.from(matched[2], "base64"),
  };
}

async function fetchRemoteImage(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`원격 이미지를 불러오지 못했습니다: ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type") || "application/octet-stream",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

export async function resolveImageAssetPayload(imageAssetId: string) {
  const imageAsset = await getImageAssetById(imageAssetId);

  if (!imageAsset) {
    return null;
  }

  const source = imageAsset.composedPath || imageAsset.originalPath;

  if (!source) {
    return null;
  }

  if (source.startsWith("data:image/svg+xml")) {
    const decoded = decodeSvgDataUrl(source);
    if (!decoded) {
      return null;
    }

    return decoded;
  }

  if (source.startsWith("data:")) {
    const decoded = decodeBase64DataUrl(source);
    if (!decoded) {
      return null;
    }

    return decoded;
  }

  if (/^https?:\/\//i.test(source)) {
    return fetchRemoteImage(source);
  }

  return null;
}

export function buildPublicImageAssetUrl(imageAssetId: string) {
  const explicitBaseUrl = process.env.PUBLIC_APP_URL?.trim();
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  const baseUrl = explicitBaseUrl || (vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "")}` : "https://m-master.vercel.app");

  return `${baseUrl.replace(/\/+$/, "")}/api/image-assets/${imageAssetId}`;
}

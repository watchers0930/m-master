type DownloadableImage = {
  filename: string;
  url: string;
};

function dataUrlToBytes(dataUrl: string) {
  const matched = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matched) {
    throw new Error("지원하지 않는 data URL 형식입니다.");
  }

  const mimeType = matched[1];
  const base64 = matched[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    mimeType,
    bytes,
  };
}

async function urlToBytes(url: string) {
  if (url.startsWith("data:")) {
    return dataUrlToBytes(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`이미지를 내려받지 못했습니다: ${response.status}`);
  }

  return {
    mimeType: response.headers.get("content-type") || "application/octet-stream",
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

function writeTarString(view: Uint8Array, offset: number, value: string, maxLength: number) {
  const encoded = new TextEncoder().encode(value.slice(0, maxLength));
  view.set(encoded.slice(0, maxLength), offset);
}

function writeTarOctal(view: Uint8Array, offset: number, length: number, value: number) {
  const octal = value.toString(8).padStart(length - 1, "0");
  writeTarString(view, offset, `${octal}\0`, length);
}

function createTarHeader(filename: string, size: number) {
  const header = new Uint8Array(512);
  writeTarString(header, 0, filename, 100);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  for (let index = 148; index < 156; index += 1) {
    header[index] = 32;
  }
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, "ustar", 6);
  writeTarString(header, 263, "00", 2);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarOctal(header, 148, 8, checksum);
  return header;
}

function padTarBlock(size: number) {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

export async function downloadImagesTar(params: {
  archiveName: string;
  images: DownloadableImage[];
}) {
  const normalizedImages = params.images.filter((image) => image.url);
  if (normalizedImages.length === 0) {
    throw new Error("다운로드할 이미지가 없습니다.");
  }

  const files = await Promise.all(
    normalizedImages.map(async (image) => {
      const source = await urlToBytes(image.url);
      return {
        filename: image.filename,
        bytes: source.bytes,
      };
    }),
  );

  const totalSize =
    files.reduce((sum, file) => sum + 512 + file.bytes.length + padTarBlock(file.bytes.length), 0) + 1024;
  const archive = new Uint8Array(totalSize);
  let offset = 0;

  files.forEach((file) => {
    const header = createTarHeader(file.filename, file.bytes.length);
    archive.set(header, offset);
    offset += 512;
    archive.set(file.bytes, offset);
    offset += file.bytes.length + padTarBlock(file.bytes.length);
  });

  const blob = new Blob([archive], { type: "application/x-tar" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.archiveName.endsWith(".tar") ? params.archiveName : `${params.archiveName}.tar`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

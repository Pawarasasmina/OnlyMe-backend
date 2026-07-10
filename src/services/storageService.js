export async function storeFile(file) {
  return {
    id: file?.filename ?? "placeholder-file",
    url: file?.path ?? "",
  };
}

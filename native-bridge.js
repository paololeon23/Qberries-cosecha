/**
 * Puente nativo Capacitor (Android APK). En Netlify/navegador no hace nada.
 * Requiere capacitor.js (solo en APK).
 */
(function () {
  "use strict";

  const XLSX_MIME =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function plugin(name) {
    return window.Capacitor?.Plugins?.[name] || null;
  }

  function isNative() {
    return window.Capacitor?.isNativePlatform?.() === true;
  }

  function isShareCancelled(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return (
      err?.name === "AbortError" ||
      msg.includes("cancel") ||
      msg.includes("abort") ||
      msg.includes("closed") ||
      msg.includes("dismiss")
    );
  }

  function safeShareName(name) {
    return (
      String(name || "cosecha.xlsx")
        .replace(/[^\w.\- ]+/g, "_")
        .replace(/\s+/g, " ")
        .trim() || "cosecha.xlsx"
    );
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(reader.error || new Error("read-failed"));
      reader.readAsDataURL(blob);
    });
  }

  async function writeShareFile(file) {
    const Filesystem = plugin("Filesystem");
    if (!Filesystem) throw new Error("filesystem-unavailable");
    const blob =
      file instanceof Blob ? file : new Blob([file], { type: XLSX_MIME });
    const fileName = safeShareName(file?.name || "cosecha.xlsx");
    const base64 = await blobToBase64(blob);
    const path = `share/${Date.now()}_${fileName.replace(/\s+/g, "_")}`;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: "CACHE",
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({
      path,
      directory: "CACHE",
    });
    return uri;
  }

  async function shareExcelFile(file, meta) {
    if (!isNative()) return { ok: false, reason: "not-native" };
    const Share = plugin("Share");
    if (!Share) return { ok: false, reason: "share-unavailable" };
    const uri = await writeShareFile(file);
    await Share.share({
      title: meta?.title || "Excel de cosecha",
      text: meta?.text || "Registro de cosecha",
      files: [uri],
      dialogTitle: "Compartir Excel",
    });
    return { ok: true };
  }

  async function shareExcelFiles(files, meta) {
    if (!isNative()) return { ok: false, reason: "not-native" };
    if (!files?.length) return { ok: false, reason: "no-files" };
    if (files.length === 1) return shareExcelFile(files[0], meta);
    const Share = plugin("Share");
    if (!Share) return { ok: false, reason: "share-unavailable" };
    const uris = [];
    for (const file of files) {
      uris.push(await writeShareFile(file));
    }
    await Share.share({
      title: meta?.title || "Excel de cosecha",
      text: meta?.text || "Registro de cosecha",
      files: uris,
      dialogTitle: "Compartir Excel",
    });
    return { ok: true };
  }

  async function requestCamera() {
    if (!isNative()) return true;
    const Permissions = plugin("QBPermissions");
    if (!Permissions?.requestCamera) return true;
    try {
      await Permissions.requestCamera();
      return true;
    } catch {
      return false;
    }
  }

  window.QBNative = {
    isNative,
    isShareCancelled,
    requestCamera,
    shareExcelFile,
    shareExcelFiles,
  };
})();

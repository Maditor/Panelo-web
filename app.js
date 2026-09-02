let dataFolder = null;
let books = [];

let currentBook = null;
let currentChapterIndex = 0;

// Reading mode: "scroll" (webtoon, cuộn dọc) hoặc "page" (lật trang từng ảnh)
let readingMode = localStorage.getItem("vt-reading-mode") || "scroll";

let currentPageIndex = 0;
let currentChapterImages = [];   // danh sách handle ảnh (chưa tải bytes) của chapter đang mở
let currentChapterImageURLs = []; // object URL của từng ảnh, điền dần khi tải xong (có thể còn null)
let currentChapterImageDriveIds = []; // driveId tương ứng (nếu có) — dùng để tự chuyển link dự phòng khi lỗi
let chapterLoadToken = 0;         // chống việc load cũ ghi đè lên chapter/trang mới hơn
let pendingHandle = null;

const supportsFSAccess = typeof window.showDirectoryPicker === "function";

/* Nhận diện điện thoại/tablet thật (khác với cửa sổ desktop bị thu hẹp) —
   dựa vào userAgent HOẶC (màn hình cảm ứng thô + màn hình hẹp) cùng lúc,
   để không nhầm desktop Brave (đã có luồng dự phòng riêng) với mobile thật */
/* =====================================================
   CHẾ ĐỘ HIỂN THỊ: Tự động / Mobile / Desktop

   Trước đây chỉ tự nhận diện theo thiết bị (không chỉnh được).
   Giờ có 3 lựa chọn: Tự động (theo bề rộng màn hình thật),
   hoặc ép cứng Mobile/Desktop — để vị trí các nút luôn chính
   xác, chủ động, không phụ thuộc hoàn toàn vào việc tự co giãn.
===================================================== */

let viewModePreference = localStorage.getItem("vt-view-mode") || "auto"; // "auto" | "mobile" | "desktop"

const mobileWidthQuery = window.matchMedia("(max-width: 700px)");

function getEffectiveViewMode() {
    if (viewModePreference === "mobile") return "mobile";
    if (viewModePreference === "desktop") return "desktop";
    return mobileWidthQuery.matches ? "mobile" : "desktop";
}

/* Trên mobile, tạo/mở thư mục local không được hỗ trợ tốt (cả File System
   Access API lẫn cách dự phòng đều chập chờn/không có trên di động) —
   nên đẩy Google Drive lên làm lựa chọn chính, ẩn bớt lối local đi.
   Áp dụng cho cả CSS layout (class "view-mobile") lẫn phần nội dung này. */
function applyViewMode() {

    const mode = getEffectiveViewMode();

    document.documentElement.classList.toggle("view-mobile", mode === "mobile");

    document.getElementById("heroInitBtn")?.classList.toggle("hidden", mode === "mobile");
    document.getElementById("heroDriveBtn")?.classList.toggle("hidden", mode !== "mobile");
    document.getElementById("openFolderBtn")?.classList.toggle("hidden", mode === "mobile");

    const desc = document.getElementById("heroDescription");
    if (desc) {
        desc.textContent = mode === "mobile"
            ? "Trên điện thoại, cách đọc mượt nhất là kết nối thư viện qua Google Drive."
            : "Đọc truyện trực tiếp từ máy tính, không cần upload, không cần server.";
    }

    if (dataFolder) {
        document.getElementById("mobileGuideBanner")?.classList.add("hidden");
    } else {
        document.getElementById("mobileGuideBanner")?.classList.toggle("hidden", mode !== "mobile");
    }

    updateViewModeLabel();
}

function cycleViewMode() {

    const order = ["auto", "mobile", "desktop"];
    const nextIndex = (order.indexOf(viewModePreference) + 1) % order.length;
    viewModePreference = order[nextIndex];

    try {
        localStorage.setItem("vt-view-mode", viewModePreference);
    } catch (error) {
        console.warn("Không thể lưu chế độ hiển thị:", error);
    }

    applyViewMode();
}

function updateViewModeLabel() {

    const btn = document.getElementById("viewModeBtn");
    if (!btn) return;

    const modeText = { auto: "Tự động", mobile: "Mobile", desktop: "Desktop" }[viewModePreference];
    btn.title = `Chế độ hiển thị: ${modeText} — bấm để đổi`;
    btn.classList.toggle("is-forced", viewModePreference !== "auto");
}

// Chỉ tự đổi theo bề rộng màn hình khi đang ở chế độ "Tự động"
mobileWidthQuery.addEventListener("change", () => {
    if (viewModePreference === "auto") applyViewMode();
});

let readOnlyMode = false;
let activeSource = null; // "local" | "fallback" | "drive" — dùng để quyết định hiện nút làm mới riêng từng bộ


/* =====================================================
   GIAO DIỆN — màu chủ đạo + ảnh nền tuỳ chỉnh

   Màu lưu ở localStorage (nhẹ, chỉ là chuỗi hex).
   Ảnh nền lưu ở IndexedDB (dùng lại store "handles" sẵn có,
   vì có thể là ảnh khá nặng, localStorage không phù hợp).
===================================================== */

const THEME_PRESETS = [
    { name: "Tím (mặc định)", accent: "#8b5cf6", accent2: "#a78bfa" },
    { name: "Xanh dương", accent: "#3b82f6", accent2: "#93c5fd" },
    { name: "Hồng", accent: "#ec4899", accent2: "#f9a8d4" },
    { name: "Xanh lá", accent: "#22c55e", accent2: "#86efac" },
    { name: "Cam", accent: "#f97316", accent2: "#fdba74" },
    { name: "Đỏ", accent: "#ef4444", accent2: "#fca5a5" },
    { name: "Ngọc", accent: "#14b8a6", accent2: "#5eead4" },
    { name: "Xám", accent: "#64748b", accent2: "#94a3b8" }
];

const DEFAULT_ACCENT = THEME_PRESETS[0].accent;
const DEFAULT_ACCENT2 = THEME_PRESETS[0].accent2;

let currentAccent = localStorage.getItem("vt-theme-accent") || DEFAULT_ACCENT;
let currentAccent2 = localStorage.getItem("vt-theme-accent2") || DEFAULT_ACCENT2;

function applyTheme(accent, accent2) {

    currentAccent = accent;
    currentAccent2 = accent2;

    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent2", accent2);

    try {
        localStorage.setItem("vt-theme-accent", accent);
        localStorage.setItem("vt-theme-accent2", accent2);
    } catch (error) {
        console.warn("Không thể lưu màu giao diện:", error);
    }
}

/* Tính màu nhạt hơn (accent2) từ 1 màu tuỳ ý, bằng cách pha thêm trắng */
function lightenColor(hex, percent) {

    const num = parseInt(hex.replace("#", ""), 16);

    let r = (num >> 16) + Math.round((255 - (num >> 16)) * percent);
    let g = ((num >> 8) & 0x00ff) + Math.round((255 - ((num >> 8) & 0x00ff)) * percent);
    let b = (num & 0x0000ff) + Math.round((255 - (num & 0x0000ff)) * percent);

    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));

    return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function renderThemeSwatches() {

    const container = document.getElementById("themeSwatches");
    if (!container) return;

    container.innerHTML = THEME_PRESETS.map(preset => `
        <button
            class="theme-swatch${preset.accent.toLowerCase() === currentAccent.toLowerCase() ? " active" : ""}"
            style="background:${preset.accent}"
            title="${preset.name}"
            onclick="handlePresetThemeClick('${preset.accent}', '${preset.accent2}')"
        ></button>
    `).join("");
}

function handlePresetThemeClick(accent, accent2) {
    applyTheme(accent, accent2);
    renderThemeSwatches();
    document.getElementById("customColorInput").value = accent;
}

function handleCustomColorChange(hex) {
    applyTheme(hex, lightenColor(hex, 0.35));
    renderThemeSwatches();
}


/* =====================================================
   ẢNH NỀN TUỲ CHỈNH
===================================================== */

let currentBgImageUrl = null;

function applyBackgroundImageFromBlob(blob) {

    if (currentBgImageUrl) URL.revokeObjectURL(currentBgImageUrl);

    currentBgImageUrl = URL.createObjectURL(blob);

    document.documentElement.style.setProperty("--bg-image", `url(${currentBgImageUrl})`);
    document.body.classList.add("has-bg-image");
}

async function loadBackgroundImage() {
    try {
        const blob = await idbGet("bg-image-blob");
        if (blob) applyBackgroundImageFromBlob(blob);
    } catch (error) {
        console.warn("Không thể tải ảnh nền đã lưu:", error);
    }
}

async function handleBgImageSelect(event) {

    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
        alert("Ảnh khá nặng (trên 15MB), bạn nên chọn ảnh nhẹ hơn để app chạy mượt hơn.");
    }

    await idbSet("bg-image-blob", file);
    applyBackgroundImageFromBlob(file);
    updateBgImagePreview(file);
}

async function removeBackgroundImageClick() {

    await idbDelete("bg-image-blob");

    if (currentBgImageUrl) {
        URL.revokeObjectURL(currentBgImageUrl);
        currentBgImageUrl = null;
    }

    document.documentElement.style.removeProperty("--bg-image");
    document.body.classList.remove("has-bg-image");

    document.getElementById("bgImagePreviewWrap").classList.add("hidden");
}

function updateBgImagePreview(blob) {

    const wrap = document.getElementById("bgImagePreviewWrap");
    const img = document.getElementById("bgImagePreview");

    if (!wrap || !img) return;

    img.src = URL.createObjectURL(blob);
    wrap.classList.remove("hidden");
}

let bgOverlayOpacity = parseFloat(localStorage.getItem("vt-bg-overlay-opacity")) || 0.75;

function applyBgOverlayOpacity(value) {
    bgOverlayOpacity = value;
    document.documentElement.style.setProperty("--bg-overlay-opacity", value);
}

function handleBgOpacityInput(value) {
    applyBgOverlayOpacity(value);
    try {
        localStorage.setItem("vt-bg-overlay-opacity", value);
    } catch (error) {
        console.warn("Không thể lưu độ tối lớp phủ:", error);
    }
}


/* =====================================================
   MODAL GIAO DIỆN
===================================================== */

async function openAppearanceModal() {

    renderThemeSwatches();
    document.getElementById("customColorInput").value = currentAccent;
    document.getElementById("bgOpacityInput").value = bgOverlayOpacity;

    try {
        const blob = await idbGet("bg-image-blob");
        if (blob) updateBgImagePreview(blob);
        else document.getElementById("bgImagePreviewWrap").classList.add("hidden");
    } catch {
        document.getElementById("bgImagePreviewWrap").classList.add("hidden");
    }

    document.getElementById("appearanceModal").classList.remove("hidden");
}

function closeAppearanceModal() {
    document.getElementById("appearanceModal").classList.add("hidden");
}

async function resetAppearance() {

    applyTheme(DEFAULT_ACCENT, DEFAULT_ACCENT2);
    renderThemeSwatches();
    document.getElementById("customColorInput").value = DEFAULT_ACCENT;

    applyBgOverlayOpacity(0.75);
    document.getElementById("bgOpacityInput").value = 0.75;
    try {
        localStorage.setItem("vt-bg-overlay-opacity", 0.75);
    } catch {}

    await removeBackgroundImageClick();
}


/* =====================================================
   BACKUP TOÀN DIỆN — gộp mọi cấu hình + tiến độ đọc +
   ảnh nền vào 1 file .json duy nhất để lưu/chuyển máy.

   KHÔNG bao gồm: ảnh truyện thật (vẫn ở máy/Drive của
   người dùng), và quyền truy cập thư mục local (trình
   duyệt không cho phép lưu/khôi phục qua file được, phải
   chọn lại thư mục sau khi nhập).
===================================================== */

const BACKUP_SETTING_KEYS = [
    "vt-drive-config",
    "vt-metadata-sheet-id",
    "vt-metadata-sheet-tab",
    "vt-folder-structure",
    "vt-reading-mode",
    "vt-pages-per-view",
    "vt-reading-direction",
    "vt-reader-zoom",
    "vt-sort-order",
    "vt-favorites",
    "vt-theme-accent",
    "vt-theme-accent2",
    "vt-bg-overlay-opacity"
];

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function base64ToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
}

async function buildBackupData() {

    const backup = {
        app: "Panelo",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: {},
        progress: {},
        readChapters: {}
    };

    BACKUP_SETTING_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) backup.settings[key] = value;
    });

    for (let i = 0; i < localStorage.length; i++) {

        const key = localStorage.key(i);

        if (key.startsWith("vt-progress:")) {
            backup.progress[key] = localStorage.getItem(key);
        } else if (key.startsWith("vt-read:")) {
            backup.readChapters[key] = localStorage.getItem(key);
        }
    }

    try {
        const bgBlob = await idbGet("bg-image-blob");
        if (bgBlob) {
            backup.backgroundImage = await blobToBase64(bgBlob);
        }
    } catch (error) {
        console.warn("Không đọc được ảnh nền để đưa vào backup:", error);
    }

    return backup;
}

async function handleExportBackupClick() {

    try {

        const backup = await buildBackupData();
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toISOString().slice(0, 10);

        const a = document.createElement("a");
        a.href = url;
        a.download = `panelo-backup-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

    } catch (error) {
        console.error(error);
        alert("Không xuất được file backup:\n\n" + error.message);
    }
}

async function handleImportBackupSelect(event) {

    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {

        const text = await file.text();
        const backup = JSON.parse(text);

        if (!backup || typeof backup !== "object" || !backup.settings) {
            throw new Error("File này không đúng định dạng backup của Panelo.");
        }

        const confirmed = confirm(
            "Nhập backup sẽ GHI ĐÈ cấu hình, giao diện, yêu thích, tiến độ đọc và " +
            "ảnh nền hiện tại trên trình duyệt này.\n\nBạn có chắc muốn tiếp tục?"
        );
        if (!confirmed) return;

        Object.entries(backup.settings || {}).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

        Object.entries(backup.progress || {}).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

        Object.entries(backup.readChapters || {}).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

        if (backup.backgroundImage) {
            const blob = await base64ToBlob(backup.backgroundImage);
            await idbSet("bg-image-blob", blob);
        }

        alert("Đã nhập backup thành công! App sẽ tải lại để áp dụng.");
        location.reload();

    } catch (error) {
        console.error(error);
        alert("Không nhập được file backup:\n\n" + error.message);
    }
}

function openBackupModal() {
    document.getElementById("backupModal").classList.remove("hidden");
}

function closeBackupModal() {
    document.getElementById("backupModal").classList.add("hidden");
}


/* =====================================================
   CẤU TRÚC THƯ MỤC

   3 tên thư mục con có thể tuỳ chỉnh, mặc định đúng như
   cấu trúc gốc "Project / About / Chapter". Để trống ô nào
   nghĩa là cấp đó không tồn tại — dùng luôn thư mục cha cho
   phần đó (ví dụ để trống "About" = ảnh bìa nằm ngay trong
   thư mục truyện, cùng cấp với thư mục chapter).
   Tên FILE ảnh bìa (thumbnail.jpg/.png/...) không đổi,
   chỉ đổi được thư mục chứa nó thôi.
===================================================== */

function defaultFolderStructureConfig() {
    return {
        projectFolderName: "Project",
        aboutFolderName: "About",
        chapterFolderName: "Chapter"
    };
}

function loadFolderStructureConfig() {
    try {
        const raw = localStorage.getItem("vt-folder-structure");
        if (raw) {
            const saved = JSON.parse(raw);
            return {
                ...defaultFolderStructureConfig(),
                projectFolderName: saved.projectFolderName ?? defaultFolderStructureConfig().projectFolderName,
                aboutFolderName: saved.aboutFolderName ?? defaultFolderStructureConfig().aboutFolderName,
                chapterFolderName: saved.chapterFolderName ?? defaultFolderStructureConfig().chapterFolderName
            };
        }
    } catch (error) {
        console.warn("Không đọc được cấu hình cấu trúc thư mục:", error);
    }
    return defaultFolderStructureConfig();
}

let folderStructureConfig = loadFolderStructureConfig();

function saveFolderStructureConfig(config) {
    folderStructureConfig = config;
    try {
        localStorage.setItem("vt-folder-structure", JSON.stringify(config));
    } catch (error) {
        console.warn("Không thể lưu cấu hình cấu trúc thư mục:", error);
    }
}

function openStructureModal() {

    document.getElementById("projectFolderNameInput").value = folderStructureConfig.projectFolderName;
    document.getElementById("aboutFolderNameInput").value = folderStructureConfig.aboutFolderName;
    document.getElementById("chapterFolderNameInput").value = folderStructureConfig.chapterFolderName;

    document.getElementById("structureModal").classList.remove("hidden");
}

function closeStructureModal() {
    document.getElementById("structureModal").classList.add("hidden");
}

function resetStructureFields() {
    const defaults = defaultFolderStructureConfig();
    document.getElementById("projectFolderNameInput").value = defaults.projectFolderName;
    document.getElementById("aboutFolderNameInput").value = defaults.aboutFolderName;
    document.getElementById("chapterFolderNameInput").value = defaults.chapterFolderName;
}

async function handleSaveStructureClick() {

    const config = {
        projectFolderName: document.getElementById("projectFolderNameInput").value.trim(),
        aboutFolderName: document.getElementById("aboutFolderNameInput").value.trim(),
        chapterFolderName: document.getElementById("chapterFolderNameInput").value.trim()
    };

    saveFolderStructureConfig(config);
    closeStructureModal();

    if (dataFolder) {
        await scanProjects();
    }
}


/* =====================================================
   ICON HELPER (dùng sprite SVG khai báo trong index.html)
===================================================== */

function icon(name, cls = "") {
    return `<svg class="icon ${cls}"><use href="#icon-${name}"></use></svg>`;
}

/* Đi qua nhiều cấp thư mục liên tiếp, tên các cấp cách nhau bằng "/"
   (ví dụ "Extra/Type" = folder/Extra/Type) — dùng cho cấu hình
   thư mục About/Chapter khi có thêm cấp thư mục trung gian */
async function resolveNestedFolder(startFolder, path) {

    let current = startFolder;

    const segments = path.split("/").map(s => s.trim()).filter(Boolean);

    for (const segment of segments) {
        current = await current.getDirectoryHandle(segment);
    }

    return current;
}

/* Lấy URL để hiển thị 1 ảnh: link trực tiếp cho Google Drive (tránh CORS),
   object URL (blob) cho file đọc từ máy — dùng chung cho mọi nguồn */
async function resolveImageUrl(fileHandle) {

    if (typeof fileHandle.getDisplayUrl === "function") {
        return { url: await fileHandle.getDisplayUrl(), driveId: fileHandle.driveId || null };
    }

    const file = await fileHandle.getFile();
    return { url: URL.createObjectURL(file), driveId: null };
}


/* =====================================================
   CÂY THƯ MỤC ẢO — DỰ PHÒNG CHO TRÌNH DUYỆT KHÔNG HỖ TRỢ
   File System Access API (Brave, Firefox, Safari...)

   Mô phỏng lại đúng "giao diện" của FileSystemDirectoryHandle
   (kind, entries(), getDirectoryHandle(), getFileHandle())
   dựa trên danh sách file từ <input webkitdirectory>,
   để phần còn lại của app không cần biết sự khác biệt này.
   Chỉ đọc được, không tạo/ghi được.
===================================================== */

function buildVirtualTree(fileList) {

    const root = { kind: "directory", name: "", children: new Map() };

    for (const file of fileList) {

        const parts = file.webkitRelativePath.split("/");

        let node = root;

        for (let i = 0; i < parts.length - 1; i++) {

            const part = parts[i];

            if (!node.children.has(part)) {
                node.children.set(part, { kind: "directory", name: part, children: new Map() });
            }

            node = node.children.get(part);
        }

        const filename = parts[parts.length - 1];
        node.children.set(filename, { kind: "file", name: filename, file });
    }

    const topLevel = [...root.children.values()];

    if (topLevel.length !== 1) {
        throw new Error("Không đọc được thư mục đã chọn.");
    }

    return wrapVirtualNode(topLevel[0]);
}

function findVirtualChild(node, name) {

    if (node.children.has(name)) return node.children.get(name);

    const lower = name.toLowerCase();

    for (const [key, child] of node.children) {
        if (key.toLowerCase() === lower) return child;
    }

    return null;
}

function wrapVirtualNode(node) {

    return {

        kind: "directory",
        name: node.name,

        async *entries() {
            for (const [name, child] of node.children) {
                yield [name, child.kind === "directory" ? wrapVirtualNode(child) : wrapVirtualFile(child)];
            }
        },

        async getDirectoryHandle(name, options = {}) {

            let child = findVirtualChild(node, name);

            if (!child && options.create) {
                child = { kind: "directory", name, children: new Map() };
                node.children.set(name, child);
            }

            if (!child || child.kind !== "directory") {
                const error = new Error(`Không tìm thấy thư mục ${name}`);
                error.name = "NotFoundError";
                throw error;
            }

            return wrapVirtualNode(child);
        },

        async getFileHandle(name) {

            const child = findVirtualChild(node, name);

            if (!child || child.kind !== "file") {
                const error = new Error(`Không tìm thấy file ${name}`);
                error.name = "NotFoundError";
                throw error;
            }

            return wrapVirtualFile(child);
        }
    };
}

function wrapVirtualFile(node) {
    return {
        kind: "file",
        name: node.name,
        async getFile() {
            return node.file;
        }
    };
}


/* =====================================================
   INDEXEDDB — LƯU THƯ MỤC ĐÃ CHỌN + CACHE GOOGLE DRIVE
===================================================== */

const IDB_NAME = "visiontoon-db";
const IDB_VERSION = 2;
const IDB_STORES = ["handles", "drive-lists", "drive-blobs"];

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;
            IDB_STORES.forEach(store => {
                if (!db.objectStoreNames.contains(store)) {
                    db.createObjectStore(store);
                }
            });
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, value, store = "handles") {
    try {
        const db = await idbOpen();

        await new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

    } catch (error) {
        console.warn("Không thể lưu cache:", error);
    }
}

async function idbGet(key, store = "handles") {
    try {
        const db = await idbOpen();

        return await new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readonly");
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });

    } catch (error) {
        console.warn("Không thể đọc cache:", error);
        return null;
    }
}

async function idbClearStore(store) {
    try {
        const db = await idbOpen();

        await new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

    } catch (error) {
        console.warn("Không thể xoá cache:", error);
    }
}

async function idbDelete(key, store = "handles") {
    try {
        const db = await idbOpen();

        await new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).delete(key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

    } catch (error) {
        console.warn("Không thể xoá cache:", error);
    }
}


/* =====================================================
   KHÔI PHỤC THƯ VIỆN LÚC MỞ APP
===================================================== */

async function tryRestoreLibrary() {

    const handle = await idbGet("dataFolder");

    if (!handle) return;

    try {

        const permission = await handle.queryPermission({ mode: "readwrite" });

        if (permission === "granted") {
            dataFolder = handle;
            activeSource = "local";
            await scanProjects();
            return;
        }

    } catch (error) {
        console.warn("Handle đã lưu không còn hợp lệ:", error);
        return;
    }

    // Cần cử chỉ click của bạn mới xin lại quyền được (giới hạn của trình duyệt)
    pendingHandle = handle;
    document.getElementById("reconnectBanner").classList.remove("hidden");
}

async function reconnectLibrary() {

    if (!pendingHandle) return;

    try {

        const permission = await pendingHandle.requestPermission({ mode: "readwrite" });

        if (permission === "granted") {
            dataFolder = pendingHandle;
            activeSource = "local";
            document.getElementById("reconnectBanner").classList.add("hidden");
            await scanProjects();
        } else {
            alert("Bạn chưa cấp quyền truy cập thư mục.");
        }

    } catch (error) {
        console.error(error);
    }
}

function dismissReconnectBanner() {
    document.getElementById("reconnectBanner").classList.add("hidden");
    pendingHandle = null;
}


/* =====================================================
   FIRST RUN
===================================================== */

async function initializeLibrary() {

    if (!supportsFSAccess) {
        alert(
            "Trình duyệt này (Brave, Firefox hoặc Safari) không cho phép trang web tạo thư mục mới.\n\n" +
            "Cách xử lý:\n" +
            "• Dùng Chrome, Edge hoặc Opera để khởi tạo thư viện lần đầu.\n" +
            "• Hoặc tự tạo cấu trúc thư mục DATA/Project/... theo hướng dẫn " +
            "\"Cách hoạt động\" ở trang chủ, rồi bấm nút mở thư mục ở góc trên " +
            "để xem (chế độ chỉ đọc)."
        );
        return;
    }

    try {

        // Bạn chọn thư mục chứa index.html
        const rootFolder = await window.showDirectoryPicker({ mode: "readwrite" });

        // Tạo DATA
        const dataHandle = await rootFolder.getDirectoryHandle("DATA", { create: true });

        // Tạo Project
        const projectHandle = await dataHandle.getDirectoryHandle("Project", { create: true });

        // Tạo truyện mẫu
        const sampleBook = await projectHandle.getDirectoryHandle("Sample Webtoon", { create: true });

        // About
        const aboutHandle = await sampleBook.getDirectoryHandle("About", { create: true });

        // Chapter
        const chapterHandle = await sampleBook.getDirectoryHandle("Chapter", { create: true });

        // Chapter 001
        const chapter001 = await chapterHandle.getDirectoryHandle("Chapter 001", { create: true });


        /* =============================================
           TẠO INFO.JSON
        ============================================= */

        const info = {
            title: "Sample Webtoon",
            alternativeTitle: "",
            author: "Unknown",
            artist: "",
            status: "Đang cập nhật",
            genres: ["Action", "Fantasy"],
            description:
                "Đây là truyện mẫu được tạo tự động. " +
                "Bạn có thể sửa file info.json để nhập thông tin truyện."
        };

        const infoFile = await aboutHandle.getFileHandle("info.json", { create: true });
        const infoWritable = await infoFile.createWritable();
        await infoWritable.write(JSON.stringify(info, null, 4));
        await infoWritable.close();


        /* =============================================
           TẠO README CHO THUMBNAIL
        ============================================= */

        const thumbnailReadme = await aboutHandle.getFileHandle("PUT-THUMBNAIL-HERE.txt", { create: true });
        const thumbnailWritable = await thumbnailReadme.createWritable();
        await thumbnailWritable.write(
            "Đặt ảnh thumbnail của truyện vào thư mục About.\n\n" +
            "Đổi tên thành:\n" +
            "thumbnail.jpg\n\n" +
            "Có thể sử dụng JPG, PNG hoặc WebP."
        );
        await thumbnailWritable.close();


        /* =============================================
           TẠO FILE HƯỚNG DẪN CHAPTER
        ============================================= */

        const chapterReadme = await chapter001.getFileHandle("PUT-CHAPTER-IMAGES-HERE.txt", { create: true });
        const chapterWritable = await chapterReadme.createWritable();
        await chapterWritable.write(
            "Đặt ảnh chapter vào thư mục này.\n\n" +
            "Ví dụ:\n" +
            "001.jpg\n" +
            "002.jpg\n" +
            "003.jpg\n\n" +
            "Hỗ trợ JPG, JPEG, PNG, WebP, GIF và AVIF."
        );
        await chapterWritable.close();


        /* =============================================
           GÁN DATA FOLDER + LƯU LẠI
        ============================================= */

        dataFolder = dataHandle;
        await idbSet("dataFolder", dataFolder);
        document.getElementById("reconnectBanner").classList.add("hidden");

        alert(
            "🎉 Đã khởi tạo thư viện!\n\n" +
            "DATA/Project/Sample Webtoon đã được tạo.\n\n" +
            "Bạn chỉ cần thay ảnh mẫu và chỉnh info.json."
        );

        await scanProjects();

    } catch (error) {

        console.error(error);

        if (error.name !== "AbortError") {
            alert("Không thể khởi tạo thư viện:\n\n" + error.message);
        }
    }
}


/* =====================================================
   CHỌN DATA ĐÃ CÓ
===================================================== */

async function openDataFolder() {

    if (!supportsFSAccess) {
        document.getElementById("folderPickerFallback").click();
        return;
    }

    try {

        const selectedFolder = await window.showDirectoryPicker({ mode: "readwrite" });

        /*
         * Nếu chọn trực tiếp DATA (hoặc thư mục tên gì cũng được): dùng luôn.
         * Nếu chọn thư mục chứa 1 thư mục con tên "DATA": tự tìm bên trong.
         */

        try {
            dataFolder = await selectedFolder.getDirectoryHandle("DATA");
        } catch {
            dataFolder = selectedFolder;
        }

        readOnlyMode = false;
        activeSource = "local";
        document.getElementById("reconnectBanner").classList.add("hidden");

        await scanProjects();

    } catch (error) {

        if (error.name !== "AbortError") {
            console.error(error);
        }
    }
}


/* =====================================================
   FALLBACK CHỌN THƯ MỤC (Brave / Firefox / Safari)
   Chỉ đọc — dùng <input webkitdirectory>
===================================================== */

async function handleFallbackFolderSelect(event) {

    const fileList = Array.from(event.target.files || []);

    if (!fileList.length) {
        event.target.value = "";
        return;
    }

    try {

        const selectedFolder = buildVirtualTree(fileList);

        try {
            dataFolder = await selectedFolder.getDirectoryHandle("DATA");
        } catch {
            dataFolder = selectedFolder;
        }

        readOnlyMode = true;
        activeSource = "fallback";

        document.getElementById("reconnectBanner").classList.add("hidden");

        await scanProjects();

    } catch (error) {
        console.error(error);
        alert("Không đọc được thư mục đã chọn:\n\n" + error.message);
    } finally {
        event.target.value = "";
    }
}


/* =====================================================
   LÀM MỚI THƯ VIỆN (xoá cache, quét lại)
===================================================== */

async function refreshLibrary() {

    if (!dataFolder) return;

    if (activeSource === "fallback") {

        // Brave/Firefox không cho app tự đọc lại đĩa — thư mục đang có chỉ là
        // 1 "ảnh chụp" tĩnh lúc chọn. Cách duy nhất để lấy nội dung mới nhất
        // là chọn lại đúng thư mục đó, nên "làm mới" ở đây = mở lại hộp thoại chọn.
        alert(
            "Trình duyệt này không cho phép app tự đọc lại thư mục.\n\n" +
            "Hãy chọn lại đúng thư mục đó ở hộp thoại sắp mở ra, để lấy đúng " +
            "nội dung mới nhất (chapter/ảnh vừa thêm sẽ được cập nhật)."
        );
        document.getElementById("folderPickerFallback").click();
        return;
    }

    const btn = document.querySelector(".refresh-btn");
    btn?.classList.add("spinning");

    driveListCache.clear();
    await idbClearStore("drive-lists");
    metadataSheetCache = null;

    await scanProjects();

    btn?.classList.remove("spinning");
}


/* =====================================================
   LÀM MỚI 1 BỘ TRUYỆN (chỉ Google Drive)

   Xoá cache danh sách của: chính thư mục bộ truyện,
   About, Chapter — và cache nội dung info.json/thumbnail,
   rồi đọc lại đúng bộ đó. Không đụng tới các bộ khác,
   nên nhanh hơn nhiều so với làm mới cả thư viện.
===================================================== */

async function invalidateDriveListCache(folderId) {
    driveListCache.delete(folderId);
    await idbDelete(`list:${folderId}`, "drive-lists");
}

async function forceRefreshDriveBook(bookFolderId) {

    await invalidateDriveListCache(bookFolderId);

    const children = await driveListChildren(bookFolderId); // gọi mạng vì cache vừa xoá

    for (const child of children) {

        const isFolder = child.mimeType === "application/vnd.google-apps.folder";
        const lower = child.name.toLowerCase();

        if (isFolder && (lower === "about" || lower === "chapter")) {

            await invalidateDriveListCache(child.id);

            if (lower === "about") {

                const aboutChildren = await driveListChildren(child.id); // tải tươi vì vừa xoá cache

                await Promise.all(
                    aboutChildren.map(f => idbDelete(`blob:${f.id}`, "drive-blobs"))
                );
            }
        }
    }
}

async function refreshSingleBook(index, event) {

    if (event) event.stopPropagation();

    const bookEntry = books[index];
    if (!bookEntry) return;

    document
        .querySelectorAll(`.book-refresh-btn[data-book-index="${index}"]`)
        .forEach(btn => btn.classList.add("spinning"));

    try {

        if (bookEntry.folder?.id) {
            await forceRefreshDriveBook(bookEntry.folder.id);
        }

        metadataSheetCache = null; // đảm bảo lấy dữ liệu Sheet mới nhất luôn

        const fresh = await readBook(bookEntry.name, bookEntry.folder);

        if (fresh) {
            if (bookEntry.thumbnail) URL.revokeObjectURL(bookEntry.thumbnail);
            Object.assign(books[index], fresh, { loading: false });
        }

    } catch (error) {
        console.warn(`Không làm mới được truyện "${bookEntry.name}":`, error);
    }

    renderBooks(getFilteredBooks());
    renderFilterPanel();
}


/* =====================================================
   SCAN PROJECTS
===================================================== */

/* =====================================================
   CACHE DANH SÁCH ĐÃ QUÉT (bộ truyện + tên chapter)

   Khác với cache API thấp (driveListChildren) — cache này
   lưu đúng kết quả đã DỰNG XONG để hiện lên giao diện ngay
   lập tức khi mở lại app, thay vì phải quét lại từ đầu rồi
   mới thấy gì đó. Sau khi quét thật xong, cache sẽ được ghi
   đè lại bằng dữ liệu mới nhất.
===================================================== */

function bookListCacheKey() {

    if (activeSource === "drive" && driveConfig?.folderId) {
        return `book-list-cache:drive:${driveConfig.folderId}`;
    }

    if (dataFolder?.name) {
        return `book-list-cache:${activeSource || "local"}:${dataFolder.name}`;
    }

    return null;
}

async function saveBookListCache() {

    const key = bookListCacheKey();
    if (!key) return;

    const snapshot = books
        .filter(b => !b.loading)
        .map(b => ({
            name: b.name,
            title: b.title,
            alternativeTitle: b.alternativeTitle,
            author: b.author,
            artist: b.artist,
            status: b.status,
            genres: b.genres,
            description: b.description,
            thumbnailDriveId: b.thumbnailDriveId || null,
            chapterNames: (b.chapters || []).map(c => c.name)
        }));

    try {
        await idbSet(key, snapshot, "handles");
    } catch (error) {
        console.warn("Không lưu được cache danh sách đã quét:", error);
    }
}

async function loadBookListCache(key) {
    try {
        return await idbGet(key, "handles");
    } catch {
        return null;
    }
}

/* Hiện ngay danh sách đã quét lần trước (nếu có) trong lúc chờ kết nối lại —
   dùng cho luồng tự kết nối Drive lúc mở app, để không phải nhìn màn hình
   trống/loading trong lúc quét lại từ đầu */
async function renderCachedBookList(sourceType, sourceId) {

    const key = sourceType === "drive"
        ? `book-list-cache:drive:${sourceId}`
        : `book-list-cache:${sourceType}:${sourceId}`;

    const cached = await loadBookListCache(key);
    if (!cached || !cached.length) return false;

    books = cached.map(b => ({
        ...b,
        thumbnail: b.thumbnailDriveId ? buildDriveImageUrl(b.thumbnailDriveId) : null,
        chapters: (b.chapterNames || []).map(name => ({ name, folder: null, images: null })),
        loading: false,
        stale: true // đánh dấu là dữ liệu cũ, chưa chắc còn đúng 100%
    }));

    renderFilterPanel();
    renderBooks(getFilteredBooks());

    return true;
}


async function scanProjects() {

    const hadCachedList = books.some(b => b.stale);

    if (!hadCachedList) {
        document.getElementById("bookGrid").innerHTML =
            `<div class="loading-state">${icon("loader", "icon-lg icon-spin")}<br>Đang quét thư viện...</div>`;
    }

    revokeBookThumbnails();

    const previousBooks = books;
    books = [];

    let projectFolder;

    const projectName = folderStructureConfig.projectFolderName.trim();

    if (!projectName) {

        // Để trống = các bộ truyện nằm ngay trong thư mục gốc, không qua thư mục con nào
        projectFolder = dataFolder;

    } else {

        try {

            projectFolder = await dataFolder.getDirectoryHandle(projectName);

        } catch {

            /* Nếu chưa có thì tự tạo (chỉ áp dụng khi có quyền ghi) */

            try {
                projectFolder = await dataFolder.getDirectoryHandle(projectName, { create: true });
            } catch {
                alert(`Không tìm thấy thư mục "${projectName}" bên trong.`);
                selectedTags.clear();
                updateFilterBadge();
                renderFilterPanel();
                renderBooks(books);
                return;
            }
        }
    }

    const bookEntries = [];

    for await (const [name, handle] of projectFolder.entries()) {
        if (handle.kind === "directory") bookEntries.push([name, handle]);
    }

    selectedTags.clear();
    updateFilterBadge();

    // Hiện khung sách ngay theo đúng thứ tự thư mục — dùng lại dữ liệu cũ
    // (kể cả từ cache lẫn từ lượt quét trước đó trong phiên này) cho những
    // bộ đã biết, chỉ bộ nào thật sự mới mới hiện khung "Đang tải..."
    books = bookEntries.map(([name]) => {

        const known = previousBooks.find(b => b.name === name && !b.loading);

        if (known) {
            return { ...known, loading: false, stale: false };
        }

        return {
            name,
            title: name,
            author: "",
            genres: [],
            description: "",
            thumbnail: null,
            chapters: [],
            loading: true
        };
    });

    renderBooks(getFilteredBooks());

    // Tải song song, điền dữ liệu vào đúng vị trí ngay khi xong — không chờ hết cả thư viện
    await Promise.all(
        bookEntries.map(async ([name, handle], index) => {

            try {

                const book = await readBook(name, handle);

                if (book) {
                    Object.assign(books[index], book, { loading: false });
                } else {
                    books[index].loading = false;
                }

            } catch (error) {
                console.warn(`Lỗi khi đọc truyện "${name}":`, error);
                books[index].loading = false;
            }

            renderBooks(getFilteredBooks());
            renderFilterPanel();
        })
    );

    renderFilterPanel();

    saveBookListCache();
}


/* =====================================================
   READ BOOK
===================================================== */

async function readBook(name, folder) {

    const aboutPath = folderStructureConfig.aboutFolderName.trim();
    const chapterPath = folderStructureConfig.chapterFolderName.trim();

    /* ẢNH BÌA + INFO.JSON — lấy từ thư mục About (nếu có cấu hình tên,
       hỗ trợ nhiều cấp cách nhau bằng "/"), hoặc ngay trong thư mục
       truyện nếu để trống tên thư mục About */

    let aboutFolder = folder;

    if (aboutPath) {
        try {
            aboutFolder = await resolveNestedFolder(folder, aboutPath);
        } catch {
            aboutFolder = null; // không có thư mục About — bỏ qua info.json + ảnh bìa
            console.log(`${name}: không có "${aboutPath}"`);
        }
    }

    /* CHAPTER — lấy từ thư mục Chapter (nếu có cấu hình tên, hỗ trợ
       nhiều cấp cách nhau bằng "/"), hoặc ngay trong thư mục truyện
       nếu để trống tên thư mục Chapter. Nếu sai đường dẫn, KHÔNG ẩn
       cả bộ truyện nữa — vẫn hiện ra (kèm thumbnail/info nếu có),
       chỉ là chưa có chapter nào, để dễ dò khi đang chỉnh cấu hình. */

    let chapterFolder = folder;
    let chapterFolderFound = true;

    if (chapterPath) {
        try {
            chapterFolder = await resolveNestedFolder(folder, chapterPath);
        } catch {
            console.warn(`${name}: không có "${chapterPath}"`);
            chapterFolderFound = false;
        }
    }

    let info = {
        title: name,
        alternativeTitle: "",
        author: "",
        artist: "",
        status: "",
        genres: [],
        description: ""
    };

    /* =============================================
       METADATA TỪ GOOGLE SHEET (nếu có cấu hình) —
       áp dụng trước, info.json bên dưới sẽ đè lên sau cùng
    ============================================= */

    if (metadataSheetId) {

        try {
            const sheet = await loadMetadataSheet();
            const record = sheet?.get(name.toLowerCase());
            if (record) info = applySheetRecordToInfo(info, record);
        } catch (error) {
            console.warn(`${name}: lỗi khi đọc Google Sheet metadata:`, error);
        }
    }

    /* =============================================
       INFO.JSON
    ============================================= */

    if (aboutFolder) {

        try {

            const infoHandle = await aboutFolder.getFileHandle("info.json");
            const file = await infoHandle.getFile();

            info = { ...info, ...JSON.parse(await file.text()) };

        } catch {
            console.log(`${name}: không có info.json`);
        }
    }

    /* =============================================
       THUMBNAIL — tên file giữ nguyên như mặc định,
       chỉ đổi được thư mục chứa nó (aboutFolder ở trên)
    ============================================= */

    let thumbnail = null;
    let thumbnailDriveId = null;

    if (aboutFolder) {

        const thumbnailNames = [
            "thumbnail.jpg",
            "thumbnail.jpeg",
            "thumbnail.png",
            "thumbnail.webp"
        ];

        for (const filename of thumbnailNames) {

            try {

                const handle = await aboutFolder.getFileHandle(filename);

                const result = await resolveImageUrl(handle);
                thumbnail = result.url;
                thumbnailDriveId = result.driveId;
                break;

            } catch (error) {
                if (error?.name !== "NotFoundError") {
                    console.warn(`"${name}": lỗi khi tải thử "${filename}":`, error);
                }
                // thử file tiếp theo
            }
        }

        /* Không khớp tên nào — thử tìm bất kỳ ảnh nào trong thư mục About
           (ưu tiên tên có chữ "thumbnail"/"cover", không thì lấy ảnh đầu tiên) */

        if (!thumbnail) {

            try {

                const candidates = [];

                for await (const [fileName, fileHandle] of aboutFolder.entries()) {
                    if (fileHandle.kind === "file" && /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(fileName)) {
                        candidates.push({ name: fileName, handle: fileHandle });
                    }
                }

                if (candidates.length) {

                    candidates.sort((a, b) => {
                        const score = n => /thumbnail|cover|poster/i.test(n) ? 0 : 1;
                        return score(a.name) - score(b.name) || a.name.localeCompare(b.name);
                    });

                    const result = await resolveImageUrl(candidates[0].handle);
                    thumbnail = result.url;
                    thumbnailDriveId = result.driveId;

                } else {
                    console.warn(`"${name}": không tìm thấy ảnh nào để làm thumbnail.`);
                }

            } catch (error) {
                console.warn(`"${name}": lỗi khi tìm thumbnail dự phòng:`, error);
            }
        }
    }

    /* =============================================
       CHAPTERS (chỉ lấy tên — CHƯA đếm ảnh bên trong,
       để tránh phải mở từng chapter lúc quét thư viện.
       Tên thư mục không cần đúng khuôn mẫu nào cả,
       chỉ cần sắp xếp theo thứ tự tự nhiên.)
    ============================================= */

    const chapters = [];

    if (chapterFolderFound) {

        for await (const [entryName, handle] of chapterFolder.entries()) {

            if (handle.kind !== "directory") continue;

            chapters.push({ name: entryName, folder: handle, images: null });
        }

        chapters.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );
    }

    return { name, ...info, thumbnail, thumbnailDriveId, chapters, folder };
}


/* =====================================================
   TẢI ẢNH CỦA 1 CHAPTER (lazy — chỉ gọi khi thật sự cần,
   kết quả được cache lại vào chapter.images)
===================================================== */

async function ensureChapterImages(chapter) {

    if (chapter.images) return chapter.images;

    if (!chapter.folder) {
        throw new Error(
            "Dữ liệu đang được tải lại, đợi vài giây rồi thử lại giúp mình nhé."
        );
    }

    const images = [];

    for await (const [fileName, imageHandle] of chapter.folder.entries()) {

        if (
            imageHandle.kind === "file" &&
            /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(fileName)
        ) {
            images.push({ name: fileName, handle: imageHandle });
        }
    }

    images.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    chapter.images = images;
    return images;
}


/* =====================================================
   RENDER BOOKS
===================================================== */

function renderBooks(list) {

    const grid = document.getElementById("bookGrid");

    grid.innerHTML = "";

    document.getElementById("libraryCount").textContent =
        `${list.length} bộ truyện` + (readOnlyMode ? " • chế độ chỉ đọc" : "");

    if (!list.length) {

        grid.innerHTML = `
            <div style="grid-column:1/-1;padding:80px 20px;text-align:center;color:#777;">
                ${icon("book-open", "icon-xl")}
                <br><br>
                Chưa có truyện trong DATA/Project
            </div>
        `;

        return;
    }

    list.forEach(book => {

        const card = document.createElement("div");
        card.className = "book-card" + (book.loading ? " book-card-loading" : "");
        card.onclick = () => showBook(book);

        const progress = loadProgress(book);
        const globalIndex = books.indexOf(book);

        const refreshBtn =
            activeSource === "drive" && !book.loading
            ? `<button
                    class="book-refresh-btn"
                    data-book-index="${globalIndex}"
                    title="Làm mới bộ truyện này"
                    onclick="refreshSingleBook(${globalIndex}, event)"
                >
                    <svg class="icon icon-sm"><use href="#icon-refresh"></use></svg>
                </button>`
            : "";

        const favoriteBtn = !book.loading
            ? `<button
                    class="favorite-btn${isFavorite(book) ? " is-favorite" : ""}"
                    data-book="${escapeHTML(book.name)}"
                    title="${isFavorite(book) ? "Bỏ yêu thích" : "Đánh dấu yêu thích"}"
                    onclick="toggleFavorite(this, event)"
                >
                    <svg class="icon icon-sm"><use href="${isFavorite(book) ? "#icon-star-filled" : "#icon-star"}"></use></svg>
                </button>`
            : "";

        card.innerHTML = `
            <div class="book-cover-wrap">
                ${
                    book.thumbnail
                    ? `<img class="book-cover" src="${book.thumbnail}" ${book.thumbnailDriveId ? `data-drive-id="${book.thumbnailDriveId}" onerror="handleDriveImgError(this)"` : ""}>`
                    : `<div class="book-cover" style="display:flex;align-items:center;justify-content:center;">${icon("book", "icon-lg")}</div>`
                }
                ${favoriteBtn}
                ${refreshBtn}
            </div>

            <div class="book-title">${escapeHTML(book.title || book.name)}</div>

            <div class="book-meta">
                ${book.loading ? "Đang tải..." : `${book.chapters.length} chapter${progress ? " • đang đọc dở" : ""}`}
            </div>
        `;

        grid.appendChild(card);
    });
}


/* =====================================================
   SEARCH & FILTER THEO TAG
===================================================== */

let selectedTags = new Set();

function collectAllTags() {

    const tagSet = new Set();

    books.forEach(book => {
        (book.genres || []).forEach(g => {
            if (g && g.trim()) tagSet.add(g.trim());
        });
    });

    return [...tagSet].sort((a, b) => a.localeCompare(b, "vi"));
}

function renderFilterPanel() {

    const list = document.getElementById("filterTagList");
    const tags = collectAllTags();

    if (!tags.length) {
        list.innerHTML = `<p class="filter-empty">Chưa có tag nào.</p>`;
        return;
    }

    list.innerHTML = tags.map(tag => `
        <label class="filter-tag-item">
            <input
                type="checkbox"
                value="${escapeHTML(tag)}"
                ${selectedTags.has(tag) ? "checked" : ""}
                onchange="onTagToggle('${escapeHTML(tag)}', this.checked)"
            >
            <span>${escapeHTML(tag)}</span>
        </label>
    `).join("");
}

function onTagToggle(tag, checked) {

    if (checked) {
        selectedTags.add(tag);
    } else {
        selectedTags.delete(tag);
    }

    updateFilterBadge();
    applyFilters();
}

function clearFilters() {

    selectedTags.clear();

    renderFilterPanel();
    updateFilterBadge();
    applyFilters();
}

function updateFilterBadge() {

    const badge = document.getElementById("filterBadge");

    if (selectedTags.size > 0) {
        badge.textContent = selectedTags.size;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

function toggleFilterPanel(event) {

    if (event) event.stopPropagation();

    const panel = document.getElementById("filterPanel");
    panel.classList.toggle("hidden");
}

function toggleSortPanel(event) {

    if (event) event.stopPropagation();

    const panel = document.getElementById("sortPanel");
    panel.classList.toggle("hidden");
}

function toggleHeaderMorePanel(event) {

    if (event) event.stopPropagation();

    const panel = document.getElementById("headerMorePanel");
    panel.classList.toggle("hidden");
}

function closeHeaderMorePanel() {
    document.getElementById("headerMorePanel").classList.add("hidden");
}

document.addEventListener("click", (event) => {

    ["filterPanel", "sortPanel", "headerMorePanel"].forEach(panelId => {

        const panel = document.getElementById(panelId);
        if (!panel || panel.classList.contains("hidden")) return;

        const wrap = panel.closest(".filter-wrap");
        if (wrap && !wrap.contains(event.target)) {
            panel.classList.add("hidden");
        }
    });
});

/* =====================================================
   YÊU THÍCH — ghim lên đầu thư viện, không phụ thuộc
   kiểu sắp xếp đang chọn (áp dụng sau cùng, luôn ưu tiên)
===================================================== */

function loadFavorites() {
    try {
        const raw = localStorage.getItem("vt-favorites");
        return new Set(raw ? JSON.parse(raw) : []);
    } catch {
        return new Set();
    }
}

let favoriteBooks = loadFavorites();

function saveFavorites() {
    try {
        localStorage.setItem("vt-favorites", JSON.stringify([...favoriteBooks]));
    } catch (error) {
        console.warn("Không thể lưu danh sách yêu thích:", error);
    }
}

function isFavorite(book) {
    return favoriteBooks.has(book.name);
}

function toggleFavorite(btn, event) {

    if (event) event.stopPropagation();

    const bookName = btn.dataset.book;
    const nowFavorite = !favoriteBooks.has(bookName);

    if (nowFavorite) favoriteBooks.add(bookName);
    else favoriteBooks.delete(bookName);

    saveFavorites();

    // Cập nhật icon tại chỗ cho mọi nút yêu thích của đúng bộ này (grid + trang chi tiết)
    document.querySelectorAll(`.favorite-btn[data-book="${cssEscape(bookName)}"]`).forEach(el => {
        const use = el.querySelector("use");
        if (use) use.setAttribute("href", nowFavorite ? "#icon-star-filled" : "#icon-star");
        el.title = nowFavorite ? "Bỏ yêu thích" : "Đánh dấu yêu thích";
        el.classList.toggle("is-favorite", nowFavorite);
    });

    // Yêu thích ảnh hưởng thứ tự hiện trong lưới, nên render lại lưới trang chủ
    renderBooks(getFilteredBooks());
}

function cssEscape(value) {
    return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}


/* =====================================================
   SẮP XẾP THƯ VIỆN
===================================================== */

let sortOrder = localStorage.getItem("vt-sort-order") || "default";


/* =====================================================
   ĐÃ ĐỌC / CHƯA ĐỌC TỪNG CHAPTER — lưu riêng theo từng bộ,
   hoàn toàn độc lập với yêu thích/sắp xếp/tiến độ đọc dở
===================================================== */

function loadReadChapters(bookName) {
    try {
        const raw = localStorage.getItem(`vt-read:${bookName}`);
        return new Set(raw ? JSON.parse(raw) : []);
    } catch {
        return new Set();
    }
}

function saveReadChapters(bookName, set) {
    try {
        localStorage.setItem(`vt-read:${bookName}`, JSON.stringify([...set]));
    } catch (error) {
        console.warn("Không thể lưu trạng thái đã đọc:", error);
    }
}

function isChapterRead(bookName, chapterName) {
    return loadReadChapters(bookName).has(chapterName);
}

function markChapterRead(bookName, chapterName) {
    const set = loadReadChapters(bookName);
    if (set.has(chapterName)) return;
    set.add(chapterName);
    saveReadChapters(bookName, set);
}

/* Bấm trực tiếp vào ô tick trong danh sách chapter — không mở chapter,
   chỉ đổi trạng thái đã đọc/chưa đọc và cập nhật đúng dòng đó tại chỗ */
function toggleChapterRead(btn, event) {

    if (event) event.stopPropagation();

    const bookName = btn.dataset.book;
    const chapterName = btn.dataset.chapter;

    const set = loadReadChapters(bookName);
    const nowRead = !set.has(chapterName);

    if (nowRead) set.add(chapterName);
    else set.delete(chapterName);

    saveReadChapters(bookName, set);

    const item = btn.closest(".chapter-item");
    if (item) item.classList.toggle("chapter-read", nowRead);

    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", nowRead ? "#icon-check-circle" : "#icon-circle");

    btn.title = nowRead ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc";

    updateReadCountLabel(bookName);
}

/* Cập nhật dòng "x/y đã đọc" phía trên danh sách chapter, không cần render lại cả trang */
function updateReadCountLabel(bookName) {

    const label = document.getElementById("readCountLabel");
    if (!label || !currentBook || currentBook.name !== bookName) return;

    const readSet = loadReadChapters(bookName);
    const total = currentBook.chapters.length;
    const readCount = currentBook.chapters.filter(c => readSet.has(c.name)).length;

    label.textContent = total ? `${readCount}/${total} đã đọc` : "";
}

function handleSortChange(value) {
    sortOrder = value;
    try {
        localStorage.setItem("vt-sort-order", sortOrder);
    } catch (error) {
        console.warn("Không thể lưu kiểu sắp xếp:", error);
    }
    renderBooks(getFilteredBooks());
}

function sortBooksList(list) {

    const sorted = [...list];

    // Bước 1: sắp theo tiêu chí đang chọn
    switch (sortOrder) {

        case "name":
            sorted.sort((a, b) =>
                (a.title || a.name).localeCompare(b.title || b.name, "vi")
            );
            break;

        case "recent": {
            sorted.sort((a, b) => {
                const timeA = loadProgress(a)?.timestamp || 0;
                const timeB = loadProgress(b)?.timestamp || 0;
                return timeB - timeA;
            });
            break;
        }

        case "chapters":
            sorted.sort((a, b) => (b.chapters?.length || 0) - (a.chapters?.length || 0));
            break;

        default:
            // giữ nguyên thứ tự thư mục — không sắp gì thêm
            break;
    }

    // Bước 2: ghim yêu thích lên đầu — sort của JS ổn định (stable) nên
    // thứ tự vừa sắp ở bước 1 vẫn được giữ nguyên bên trong mỗi nhóm
    sorted.sort((a, b) => (isFavorite(b) ? 1 : 0) - (isFavorite(a) ? 1 : 0));

    return sorted;
}

function getFilteredBooks() {

    const keyword = document.getElementById("searchInput").value.toLowerCase();

    const filtered = books.filter(book => {

        const haystack = `${book.title || book.name} ${book.author || ""}`.toLowerCase();
        const matchesKeyword = haystack.includes(keyword);

        const matchesTags =
            selectedTags.size === 0 ||
            (book.genres || []).some(g => selectedTags.has(g));

        return matchesKeyword && matchesTags;
    });

    return sortBooksList(filtered);
}

function applyFilters() {
    renderBooks(getFilteredBooks());
}


/* =====================================================
   SHOW BOOK
===================================================== */

async function showBook(book, fromHistory = false) {

    currentBook = book;

    document.getElementById("homePage").classList.remove("active");
    document.getElementById("readerPage").classList.remove("active");
    document.getElementById("detailPage").classList.add("active");

    if (!fromHistory) pushHistoryState({ view: "detail", bookName: book.name });

    const detail = document.getElementById("bookDetail");

    const genres = (book.genres || [])
        .map(g => `<span class="tag">${escapeHTML(g)}</span>`)
        .join("");

    const progress = loadProgress(book);
    const hasValidProgress = progress && book.chapters[progress.chapterIndex];

    let actionButtons = `<p style="color:#777">Chưa có chapter.</p>`;

    if (book.chapters.length) {

        if (hasValidProgress) {

            const chapterName = book.chapters[progress.chapterIndex].name;

            actionButtons = `
                <button class="primary-btn" onclick="openChapter(${progress.chapterIndex}, { startPage: ${progress.pageIndex || 0} })">
                    ${icon("play")} Đọc tiếp: ${escapeHTML(chapterName)}
                </button>
                <button class="secondary-btn" onclick="openChapter(0)">
                    Đọc lại từ đầu
                </button>
            `;

        } else {

            actionButtons = `
                <button class="primary-btn" onclick="openChapter(0)">
                    ${icon("play")} Đọc chapter đầu tiên
                </button>
            `;
        }
    }

    detail.innerHTML = `
        <div class="detail-header">
            ${
                book.thumbnail
                ? `<img class="detail-cover" src="${book.thumbnail}" ${book.thumbnailDriveId ? `data-drive-id="${book.thumbnailDriveId}" onerror="handleDriveImgError(this)"` : ""}>`
                : `<div class="detail-cover" style="display:flex;align-items:center;justify-content:center;">${icon("book", "icon-xl")}</div>`
            }

            <div class="detail-info">
                <div class="detail-title-row">
                    <h1>${escapeHTML(book.title || book.name)}</h1>
                    <button
                        class="favorite-btn detail-favorite-btn${isFavorite(book) ? " is-favorite" : ""}"
                        data-book="${escapeHTML(book.name)}"
                        title="${isFavorite(book) ? "Bỏ yêu thích" : "Đánh dấu yêu thích"}"
                        onclick="toggleFavorite(this, event)"
                    >
                        <svg class="icon"><use href="${isFavorite(book) ? "#icon-star-filled" : "#icon-star"}"></use></svg>
                    </button>
                </div>

                ${book.alternativeTitle ? `<p class="detail-alt-title">${escapeHTML(book.alternativeTitle)}</p>` : ""}

                <div class="detail-meta-row">
                    ${book.author ? `<span>${icon("pencil", "icon-sm")} ${escapeHTML(book.author)}</span>` : ""}
                    ${book.artist && book.artist !== book.author ? `<span>${icon("palette", "icon-sm")} ${escapeHTML(book.artist)}</span>` : ""}
                    ${book.status ? `<span class="status-badge">${escapeHTML(book.status)}</span>` : ""}
                </div>

                <div class="tags">${genres}</div>

                <p class="detail-description">
                    ${escapeHTML(book.description || "Chưa có mô tả.")}
                </p>

                <div class="detail-actions">
                    ${actionButtons}
                </div>
            </div>
        </div>

        <div class="chapter-section">
            <div class="chapter-section-header">
                <h2>Chapters</h2>
                <span id="readCountLabel" class="read-count-label"></span>
            </div>

            ${
                book.chapters.length
                ? book.chapters.map((chapter, index) => {

                    const read = isChapterRead(book.name, chapter.name);

                    return `
                    <div class="chapter-item${read ? " chapter-read" : ""}" onclick="openChapter(${index})">
                        <button
                            class="chapter-read-toggle"
                            data-book="${escapeHTML(book.name)}"
                            data-chapter="${escapeHTML(chapter.name)}"
                            title="${read ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}"
                            onclick="toggleChapterRead(this, event)"
                        >
                            <svg class="icon icon-sm"><use href="${read ? "#icon-check-circle" : "#icon-circle"}"></use></svg>
                        </button>
                        <span class="chapter-name">${escapeHTML(chapter.name)}</span>
                        <span class="chapter-number" data-chapter-count="${index}">
                            ${
                                hasValidProgress && index === progress.chapterIndex
                                ? "Đang đọc dở • "
                                : ""
                            }
                            ${chapter.images ? `${chapter.images.length} ảnh` : "..."} ${icon("chevron-right", "icon-sm")}
                        </span>
                    </div>
                `;
                }).join("")
                : `<p style="color:#777">Chưa có chapter.</p>`
            }
        </div>
    `;

    updateReadCountLabel(book.name);

    // Đếm số ảnh từng chapter song song, chỉ tải những chapter chưa cache
    book.chapters.forEach((chapter, index) => {

        if (chapter.images) return;

        ensureChapterImages(chapter).then(images => {

            if (currentBook !== book) return; // đã chuyển sang truyện khác thì thôi

            const countEl = detail.querySelector(`[data-chapter-count="${index}"]`);
            if (!countEl) return;

            const prefix =
                hasValidProgress && index === progress.chapterIndex
                ? "Đang đọc dở • "
                : "";

            countEl.innerHTML = `${prefix}${images.length} ảnh ${icon("chevron-right", "icon-sm")}`;

        }).catch(error => console.warn(`Không đếm được ảnh chapter "${chapter.name}":`, error));
    });
}


/* =====================================================
   OPEN CHAPTER
===================================================== */

async function openChapter(index, opts = {}) {

    const chapter = currentBook.chapters[index];

    if (!chapter) return;

    currentChapterIndex = index;
    const token = ++chapterLoadToken;

    document.getElementById("homePage").classList.remove("active");
    document.getElementById("detailPage").classList.remove("active");
    document.getElementById("readerPage").classList.add("active");

    document.getElementById("readerTitle").textContent = `${currentBook.title} • ${chapter.name}`;

    const historyState = { view: "reader", bookName: currentBook.name, chapterIndex: index };
    if (opts.historyMode === "replace") replaceHistoryState(historyState);
    else if (opts.historyMode !== "none") pushHistoryState(historyState);

    updateReadingModeButton();
    updatePagesPerViewButton();
    updateReadingDirectionButton();

    const reader = document.getElementById("readerContent");
    reader.innerHTML = `<div class="loading-state">${icon("loader", "icon-lg icon-spin")}<br>Đang mở chapter...</div>`;

    revokeChapterURLs();

    let images;

    try {
        images = await ensureChapterImages(chapter);
    } catch (error) {
        alert(error.message || "Không mở được chapter này, thử lại sau vài giây nhé.");
        closeReader();
        return;
    }

    if (token !== chapterLoadToken) return; // đã chuyển chapter khác trong lúc đợi

    currentChapterImages = images;
    currentChapterImageURLs = new Array(images.length).fill(null);
    currentChapterImageDriveIds = new Array(images.length).fill(null);

    currentPageIndex =
        opts.startPage === "last" ? images.length - 1 : (opts.startPage ?? 0);

    renderChapterContent();
    saveProgress();
    markChapterRead(currentBook.name, chapter.name);

    window.scrollTo({ top: 0, behavior: "instant" });

    if (readingMode === "scroll") {
        loadChapterImagesProgressively(token);
    } else {
        getCurrentPageViewIndices().forEach(i => loadPageImage(i, token));
    }
}

/* Tải nhiều ảnh song song (giới hạn số luồng), điền vào đúng vị trí ngay khi xong */

async function loadChapterImagesProgressively(token) {

    const CONCURRENCY = 4;
    const images = currentChapterImages;
    let cursor = 0;

    async function worker() {
        while (cursor < images.length) {

            const i = cursor++;
            const { url, driveId } = await resolveImageUrl(images[i].handle);

            if (token !== chapterLoadToken) return; // chapter đã đổi, bỏ kết quả này

            currentChapterImageURLs[i] = url;
            currentChapterImageDriveIds[i] = driveId;

            const imgEl = document.querySelector(`#readerContent img[data-index="${i}"]`);
            if (imgEl) {
                if (driveId) {
                    imgEl.dataset.driveId = driveId;
                    imgEl.onerror = () => handleDriveImgError(imgEl);
                }
                imgEl.src = url;
                imgEl.classList.remove("img-loading");
                imgEl.classList.add("loaded");
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, images.length) }, worker)
    );
}

/* Danh sách chỉ số ảnh đang hiện cùng lúc ở chế độ Lật trang
   (1, 2 hoặc 3 trang tuỳ pagesPerView), cắt bớt nếu chạm cuối chapter */
function getCurrentPageViewIndices() {

    const indices = [];

    for (let i = 0; i < pagesPerView; i++) {
        const idx = currentPageIndex + i;
        if (idx < currentChapterImages.length) indices.push(idx);
    }

    return indices;
}

const pageLoadingInFlight = new Set();

/* Tải đúng 1 ảnh của chế độ Lật trang (chỉ tải trang cần thiết + prefetch trang kế) */

async function loadPageImage(pageIndex, token) {

    if (currentChapterImageURLs[pageIndex]) return currentChapterImageURLs[pageIndex];
    if (pageLoadingInFlight.has(pageIndex)) return null; // đang có 1 lượt tải khác cho đúng trang này rồi

    pageLoadingInFlight.add(pageIndex);

    try {

        const image = currentChapterImages[pageIndex];
        if (!image) return null;

        const { url, driveId } = await resolveImageUrl(image.handle);
        if (token !== chapterLoadToken) return null;

        currentChapterImageURLs[pageIndex] = url;
        currentChapterImageDriveIds[pageIndex] = driveId;

        if (readingMode === "page" && getCurrentPageViewIndices().includes(pageIndex)) {
            renderChapterContent();
        }

        // prefetch trang kế cho mượt, không cần chờ
        const nextIndex = pageIndex + 1;
        if (nextIndex < currentChapterImages.length && !currentChapterImageURLs[nextIndex]) {
            loadPageImage(nextIndex, token);
        }

        return url;

    } finally {
        pageLoadingInFlight.delete(pageIndex);
    }
}

function revokeChapterURLs() {
    currentChapterImageURLs.forEach(url => { if (url) URL.revokeObjectURL(url); });
    currentChapterImageURLs = [];
    currentChapterImageDriveIds = [];
    currentChapterImages = [];
    pageLoadingInFlight.clear();
}

function revokeBookThumbnails() {
    books.forEach(book => {
        if (book.thumbnail) URL.revokeObjectURL(book.thumbnail);
    });
}


/* =====================================================
   RENDER CHAPTER CONTENT (theo reading mode)
===================================================== */

function renderChapterContent() {

    const reader = document.getElementById("readerContent");
    reader.classList.toggle("page-mode", readingMode === "page");
    reader.innerHTML = "";

    if (readingMode === "scroll") {

        currentChapterImages.forEach((_, i) => {

            const img = document.createElement("img");
            img.dataset.index = i;
            img.loading = "lazy";

            if (currentChapterImageURLs[i]) {
                const driveId = currentChapterImageDriveIds[i];
                if (driveId) {
                    img.dataset.driveId = driveId;
                    img.onerror = () => handleDriveImgError(img);
                }
                img.src = currentChapterImageURLs[i];
                img.classList.add("loaded");
            } else {
                img.classList.add("img-loading");
            }

            reader.appendChild(img);
        });

        const hasNext = currentChapterIndex < currentBook.chapters.length - 1;

        const banner = document.createElement("div");
        banner.className = "next-chapter-banner";
        banner.innerHTML = hasNext
            ? `<button class="primary-btn" onclick="nextChapter()">Chapter tiếp theo ${icon("chevron-right")}</button>`
            : `<p style="color:#777">${icon("check-circle", "icon-sm")} Bạn đã đọc hết chapter mới nhất</p>`;
        reader.appendChild(banner);

    } else {

        const indices = getCurrentPageViewIndices();

        const wrap = document.createElement("div");
        wrap.className = "page-mode-images" + (readingDirection === "rtl" ? " rtl" : "");

        const maxWidthPercent = 100 / Math.max(1, indices.length);

        indices.forEach(i => {

            if (!currentChapterImageURLs[i]) return; // ảnh này chưa tải xong, bỏ qua slot

            const img = document.createElement("img");
            const driveId = currentChapterImageDriveIds[i];

            if (driveId) {
                img.dataset.driveId = driveId;
                img.onerror = () => handleDriveImgError(img);
            }

            img.src = currentChapterImageURLs[i];
            img.style.maxWidth = `calc(${maxWidthPercent}% * var(--reader-zoom))`;
            wrap.appendChild(img);
        });

        if (wrap.children.length === 0) {
            wrap.innerHTML = `<div class="loading-state">${icon("loader", "icon-lg icon-spin")}<br>Đang tải ảnh...</div>`;
        }

        // đảm bảo mọi trang trong cụm đang xem đều đã/đang được tải
        indices.forEach(i => {
            if (!currentChapterImageURLs[i]) loadPageImage(i, chapterLoadToken);
        });

        reader.appendChild(wrap);

        const nav = document.createElement("div");
        nav.className = "page-nav";

        const rangeLabel = indices.length > 1
            ? `${indices[0] + 1}-${indices[indices.length - 1] + 1}`
            : `${currentPageIndex + 1}`;

        nav.innerHTML = `
            <button onclick="prevPage()">${icon("chevron-left", "icon-sm")} Trước</button>
            <span class="page-jump-trigger" onclick="openPageJumpInput(this)" title="Bấm để nhảy tới trang">
                <span class="page-jump-label">${rangeLabel}</span> / ${currentChapterImages.length}
            </span>
            <button onclick="nextPage()">Sau ${icon("chevron-right", "icon-sm")}</button>
        `;
        reader.appendChild(nav);
    }

    updateProgressBar();
}


/* =====================================================
   ĐIỀU HƯỚNG TRANG (chế độ Lật trang)
===================================================== */

/* Bấm vào số trang để gõ tay nhảy thẳng tới trang bất kỳ,
   thay vì chỉ bấm Trước/Sau từng bước một */

function openPageJumpInput(trigger) {

    if (trigger.querySelector("input")) return; // đã đang mở sẵn rồi

    const total = currentChapterImages.length;
    const label = trigger.querySelector(".page-jump-label");
    if (!label) return;

    const input = document.createElement("input");
    input.type = "number";
    input.min = 1;
    input.max = total;
    input.value = currentPageIndex + 1;
    input.className = "page-jump-input";

    label.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {

        if (committed) return;
        committed = true;

        const value = parseInt(input.value, 10);

        if (value >= 1 && value <= total) {
            jumpToPage(value - 1);
        } else {
            renderChapterContent(); // số không hợp lệ — huỷ, vẽ lại như cũ
        }
    };

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        } else if (event.key === "Escape") {
            committed = true;
            renderChapterContent();
        }
    });

    input.addEventListener("blur", commit);
    input.addEventListener("click", (event) => event.stopPropagation());
}

function jumpToPage(targetIndex) {

    // Căn về đầu cụm chứa trang này, để hiện đúng theo số trang/lần đang chọn
    currentPageIndex = Math.floor(targetIndex / pagesPerView) * pagesPerView;

    renderChapterContent();
    getCurrentPageViewIndices().forEach(i => loadPageImage(i, chapterLoadToken));
    saveProgress();
}

function nextPage() {

    const nextIndex = currentPageIndex + pagesPerView;

    if (nextIndex < currentChapterImages.length) {
        currentPageIndex = nextIndex;
        renderChapterContent();
        saveProgress();
    } else {
        nextChapter();
    }
}

function prevPage() {

    if (currentPageIndex > 0) {
        currentPageIndex = Math.max(0, currentPageIndex - pagesPerView);
        renderChapterContent();
        saveProgress();
    } else {
        previousChapter({ toLastPage: true });
    }
}


/* =====================================================
   NEXT / PREVIOUS CHAPTER
===================================================== */

function nextChapter() {

    if (currentChapterIndex < currentBook.chapters.length - 1) {
        openChapter(currentChapterIndex + 1, { historyMode: "replace" });
    }
}

function previousChapter(opts = {}) {

    if (currentChapterIndex > 0) {
        openChapter(currentChapterIndex - 1, {
            ...(opts.toLastPage ? { startPage: "last" } : {}),
            historyMode: "replace"
        });
    }
}


/* =====================================================
   CHẾ ĐỘ ĐỌC: CUỘN DỌC / LẬT TRANG
===================================================== */

function toggleReadingMode() {

    readingMode = readingMode === "scroll" ? "page" : "scroll";
    localStorage.setItem("vt-reading-mode", readingMode);

    updateReadingModeButton();
    updatePagesPerViewButton();
    updateReadingDirectionButton();

    currentPageIndex = 0;

    if (currentChapterImages.length) {
        renderChapterContent();

        if (readingMode === "scroll") {
            loadChapterImagesProgressively(chapterLoadToken);
        } else {
            getCurrentPageViewIndices().forEach(i => loadPageImage(i, chapterLoadToken));
        }
    }
}

function updateReadingModeButton() {

    const btn = document.getElementById("readingModeBtn");
    if (!btn) return;

    if (readingMode === "scroll") {
        btn.innerHTML = icon("scroll");
        btn.title = "Đang: Cuộn dọc — bấm để đổi sang Lật trang";
    } else {
        btn.innerHTML = icon("page");
        btn.title = "Đang: Lật trang — bấm để đổi sang Cuộn dọc";
    }
}


/* =====================================================
   SỐ TRANG XEM CÙNG LÚC (chỉ áp dụng ở chế độ Lật trang) —
   phù hợp đọc manga kiểu sách giấy, xem 2-3 trang cạnh nhau
===================================================== */

let pagesPerView = Math.min(3, Math.max(1, parseInt(localStorage.getItem("vt-pages-per-view"), 10) || 1));

function cyclePagesPerView() {

    pagesPerView = pagesPerView >= 3 ? 1 : pagesPerView + 1;
    localStorage.setItem("vt-pages-per-view", pagesPerView);

    updatePagesPerViewButton();

    if (currentChapterImages.length && readingMode === "page") {

        // căn lại về đầu cụm gần nhất để cụm trang không bị lệch
        currentPageIndex = Math.floor(currentPageIndex / pagesPerView) * pagesPerView;

        renderChapterContent();
        getCurrentPageViewIndices().forEach(i => loadPageImage(i, chapterLoadToken));
        saveProgress();
    }
}

function updatePagesPerViewButton() {

    const btn = document.getElementById("pagesPerViewBtn");
    const label = document.getElementById("pagesPerViewLabel");
    if (!btn || !label) return;

    label.textContent = pagesPerView;
    btn.classList.toggle("hidden", readingMode !== "page");
    btn.title = `Đang xem ${pagesPerView} trang/lần — bấm để đổi`;
}


/* =====================================================
   HƯỚNG ĐỌC TRANG (trái→phải kiểu webtoon, hoặc phải→trái
   kiểu manga Nhật) — chỉ ảnh hưởng thứ tự hiển thị khi xem
   nhiều trang cùng lúc ở chế độ Lật trang
===================================================== */

let readingDirection = localStorage.getItem("vt-reading-direction") === "rtl" ? "rtl" : "ltr";

function toggleReadingDirection() {

    readingDirection = readingDirection === "ltr" ? "rtl" : "ltr";
    localStorage.setItem("vt-reading-direction", readingDirection);

    updateReadingDirectionButton();

    if (currentChapterImages.length && readingMode === "page") {
        renderChapterContent();
    }
}

function updateReadingDirectionButton() {

    const btn = document.getElementById("readingDirectionBtn");
    const label = document.getElementById("readingDirectionLabel");
    if (!btn || !label) return;

    if (readingDirection === "ltr") {
        label.textContent = "Trái→Phải";
        btn.title = "Đang đọc: Trái sang phải (kiểu webtoon) — bấm để đổi";
    } else {
        label.textContent = "Phải→Trái";
        btn.title = "Đang đọc: Phải sang trái (kiểu manga) — bấm để đổi";
    }

    btn.classList.toggle("hidden", readingMode !== "page");
}


/* =====================================================
   THANH TIẾN TRÌNH
===================================================== */

function updateProgressBar() {

    const fill = document.getElementById("readerProgressFill");
    if (!fill) return;

    if (readingMode === "page") {
        const total = currentChapterImages.length || 1;
        const shown = Math.min(currentPageIndex + pagesPerView, total);
        fill.style.width = `${(shown / total) * 100}%`;
    } else {
        fill.style.width = "0%";
    }
}

window.addEventListener("scroll", () => {

    if (readingMode !== "scroll") return;

    const readerPage = document.getElementById("readerPage");
    if (!readerPage || !readerPage.classList.contains("active")) return;

    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const scrollHeight = (doc.scrollHeight || document.body.scrollHeight) - doc.clientHeight;

    const percent = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

    const fill = document.getElementById("readerProgressFill");
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;

}, { passive: true });


/* =====================================================
   LƯU / KHÔI PHỤC TIẾN ĐỘ ĐỌC
===================================================== */

function progressKey(book) {
    return `vt-progress:${book.name}`;
}

function saveProgress() {

    if (!currentBook) return;

    const chapter = currentBook.chapters[currentChapterIndex];

    const data = {
        chapterIndex: currentChapterIndex,
        pageIndex: currentPageIndex,
        chapterName: chapter ? chapter.name : "",
        timestamp: Date.now()
    };

    try {
        localStorage.setItem(progressKey(currentBook), JSON.stringify(data));
    } catch (error) {
        console.warn("Không thể lưu tiến độ đọc:", error);
    }
}

function loadProgress(book) {

    try {
        const raw = localStorage.getItem(progressKey(book));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}


/* =====================================================
   MODAL DANH SÁCH CHAPTER (trong lúc đang đọc)
===================================================== */

function openChapterModal() {

    if (!currentBook) return;

    const list = document.getElementById("chapterList");

    list.innerHTML = currentBook.chapters.map((chapter, index) => `
        <div class="chapter-item${isChapterRead(currentBook.name, chapter.name) ? " chapter-read" : ""}" onclick="closeChapterModal(); openChapter(${index})">
            <span class="chapter-name">
                ${index === currentChapterIndex ? icon("play", "icon-sm") + " " : ""}${escapeHTML(chapter.name)}
            </span>
            <span class="chapter-number" data-modal-chapter-count="${index}">
                ${chapter.images ? `${chapter.images.length} ảnh` : "..."}
            </span>
        </div>
    `).join("");

    document.getElementById("chapterModal").classList.remove("hidden");

    currentBook.chapters.forEach((chapter, index) => {

        if (chapter.images) return;

        ensureChapterImages(chapter).then(images => {

            const countEl = list.querySelector(`[data-modal-chapter-count="${index}"]`);
            if (countEl) countEl.textContent = `${images.length} ảnh`;

        }).catch(error => console.warn(`Không đếm được ảnh chapter "${chapter.name}":`, error));
    });
}

function closeChapterModal() {
    document.getElementById("chapterModal").classList.add("hidden");
}


/* =====================================================
   CLOSE READER / HOME
===================================================== */

/* =====================================================
   ĐIỀU HƯỚNG BẰNG NÚT BACK/FORWARD CỦA TRÌNH DUYỆT
   (kể cả nút chuột phụ) — theo cấp màn hình: Trang chủ /
   Chi tiết truyện / Đang đọc. Không tính từng trang ảnh lẻ
   hay lượt chuyển chapter kế tiếp (dùng replaceState cho
   những bước đó để back 1 phát là ra khỏi hẳn reader).
===================================================== */

function pushHistoryState(state) {
    try {
        history.pushState(state, "");
    } catch (error) {
        console.warn("Không thể lưu trạng thái điều hướng:", error);
    }
}

function replaceHistoryState(state) {
    try {
        history.replaceState(state, "");
    } catch (error) {
        console.warn("Không thể cập nhật trạng thái điều hướng:", error);
    }
}

window.addEventListener("popstate", (event) => {

    const state = event.state;

    if (!state || state.view === "home") {
        showHome(true);
        return;
    }

    if (state.view === "detail") {
        const book = books.find(b => b.name === state.bookName);
        if (book) showBook(book, true);
        else showHome(true);
        return;
    }

    if (state.view === "reader") {
        const book = books.find(b => b.name === state.bookName);
        if (!book) { showHome(true); return; }
        currentBook = book;
        openChapter(state.chapterIndex, { historyMode: "none" });
        return;
    }

    showHome(true);
});

function closeReader() {
    history.back();
}

function showHome(fromHistory = false) {

    document.getElementById("detailPage").classList.remove("active");
    document.getElementById("readerPage").classList.remove("active");
    document.getElementById("homePage").classList.add("active");

    if (!fromHistory) pushHistoryState({ view: "home" });
}


/* =====================================================
   THU PHÓNG (ZOOM) ẢNH ĐỌC
===================================================== */

let readerZoom = clampZoom(parseInt(localStorage.getItem("vt-reader-zoom"), 10) || 100);

function clampZoom(value) {
    return Math.min(100, Math.max(25, Math.round(value / 25) * 25));
}

function applyZoom() {

    document.documentElement.style.setProperty("--reader-zoom", readerZoom / 100);

    const label = document.getElementById("zoomLabel");
    if (label) label.textContent = `${readerZoom}%`;
}

function adjustZoom(delta) {

    readerZoom = clampZoom(readerZoom + delta);
    localStorage.setItem("vt-reader-zoom", readerZoom);

    applyZoom();
}


/* =====================================================
   LÊN ĐẦU / XUỐNG CUỐI TRANG
===================================================== */

function scrollReaderTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollReaderBottom() {
    window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth"
    });
}


/* =====================================================
   PHÍM TẮT TRONG READER
===================================================== */

document.addEventListener("keydown", (event) => {

    const readerPage = document.getElementById("readerPage");
    if (!readerPage || !readerPage.classList.contains("active")) return;

    if (event.key === "Escape") {
        closeReader();
        return;
    }

    if (event.key === "ArrowRight") {
        readingMode === "page" ? nextPage() : nextChapter();
        return;
    }

    if (event.key === "ArrowLeft") {
        readingMode === "page" ? prevPage() : previousChapter();
        return;
    }
});


/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHTML(text) {

    if (!text) return "";

    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* =====================================================
   GOOGLE DRIVE ADAPTER (chỉ đọc)

   Đọc một thư mục Google Drive đã chia sẻ công khai
   ("Bất kỳ ai có link – Người xem") qua Drive API v3,
   chỉ cần API key, không cần đăng nhập.

   Mô phỏng lại đúng "giao diện" của FileSystemDirectoryHandle
   (kind, entries(), getDirectoryHandle(), getFileHandle())
   như 2 adapter local/fallback ở trên, để phần còn lại
   của app dùng chung một logic duy nhất.
===================================================== */

let driveConfig = null;


/* =====================================================
   METADATA TỪ GOOGLE SHEET (dành cho Google Drive)

   Vì info.json không đọc được trên Drive (CORS chặn),
   dùng thay bằng Google Sheets API v4 — cùng kiểu API key
   như Drive, và cùng dạng endpoint REST (sheets.googleapis.com)
   nên KHÔNG bị chặn CORS như link CSV publish-to-web hay
   Drive alt=media (2 cách đó dùng endpoint "phục vụ tài liệu"
   riêng của Google, không cấp CORS cho web ngoài).

   Mỗi dòng trong Sheet là 1 bộ truyện, khớp theo tên thư mục.
   Cột cần có (không phân biệt hoa/thường):
   folder, title, alternativetitle, author, artist, status, genres, description
===================================================== */

let metadataSheetId = localStorage.getItem("vt-metadata-sheet-id") || "";
let metadataSheetTab = localStorage.getItem("vt-metadata-sheet-tab") || "";
let metadataSheetCache = null; // Map(tên thư mục viết thường -> record)

/* Cho phép dán cả link đầy đủ khi đang mở Sheet lẫn chỉ ID — tự nhận diện */
function extractSheetId(input) {

    input = (input || "").trim();

    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    return input; // có thể đã dán thẳng ID
}

function saveMetadataSheetConfig(sheetInput, tab) {

    metadataSheetId = extractSheetId(sheetInput);
    metadataSheetTab = (tab || "").trim(); // để trống = tự nhận tab đầu tiên

    try {
        localStorage.setItem("vt-metadata-sheet-id", metadataSheetId);
        localStorage.setItem("vt-metadata-sheet-tab", metadataSheetTab);
    } catch (error) {
        console.warn("Không thể lưu cấu hình Google Sheet:", error);
    }
}

/* Lấy tên tab đầu tiên trong Sheet — để khỏi bắt người dùng phải gõ đúng
   tên tab (dễ sai vì Google đặt tên mặc định khác nhau theo ngôn ngữ:
   "Sheet1", "Trang tính1", có khi có dấu cách có khi không) */
async function resolveFirstSheetTab(spreadsheetId, apiKey) {

    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `?fields=sheets.properties.title&key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Không đọc được Google Sheet (${response.status})`);
    }

    const data = await response.json();
    const title = data?.sheets?.[0]?.properties?.title;

    if (!title) throw new Error("Google Sheet này không có tab nào.");

    return title;
}

async function loadMetadataSheet() {

    const apiKey = (driveConfig || loadDriveConfig())?.apiKey;

    if (!metadataSheetId || !apiKey) return null;
    if (metadataSheetCache) return metadataSheetCache;

    // Chưa gõ tên tab (hoặc để trống) — tự dò tab đầu tiên
    const tab = metadataSheetTab || await resolveFirstSheetTab(metadataSheetId, apiKey);

    const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${metadataSheetId}` +
        `/values/${encodeURIComponent(tab)}?key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Không tải được Google Sheet (${response.status})`);
    }

    const data = await response.json();
    const rows = data.values || [];

    const map = new Map();

    if (rows.length > 1) {

        const headers = rows[0].map(h => (h || "").trim().toLowerCase());

        for (let i = 1; i < rows.length; i++) {

            const record = {};
            headers.forEach((header, index) => {
                record[header] = (rows[i][index] || "").trim();
            });

            const key = (record.folder || record["tên thư mục"] || "").toLowerCase();
            if (key) map.set(key, record);
        }
    }

    metadataSheetCache = map;
    return map;
}

function applySheetRecordToInfo(info, record) {

    if (!record) return info;

    const result = { ...info };

    if (record.title) result.title = record.title;
    if (record.alternativetitle) result.alternativeTitle = record.alternativetitle;
    if (record.author) result.author = record.author;
    if (record.artist) result.artist = record.artist;
    if (record.status) result.status = record.status;
    if (record.description) result.description = record.description;

    if (record.genres) {
        result.genres = record.genres.split(/[,;]/).map(g => g.trim()).filter(Boolean);
    }

    return result;
}
const driveListCache = new Map();

function loadDriveConfig() {
    try {
        const raw = localStorage.getItem("vt-drive-config");
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveDriveConfig(config) {
    driveConfig = config;
    try {
        localStorage.setItem("vt-drive-config", JSON.stringify(config));
    } catch (error) {
        console.warn("Không thể lưu cấu hình Google Drive:", error);
    }
}

async function driveListChildren(folderId) {

    if (driveListCache.has(folderId)) return driveListCache.get(folderId);

    const cached = await idbGet(`list:${folderId}`, "drive-lists");

    if (cached) {
        driveListCache.set(folderId, cached);
        return cached;
    }

    const children = [];
    let pageToken = "";

    do {

        const url = new URL("https://www.googleapis.com/drive/v3/files");
        url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
        url.searchParams.set("fields", "nextPageToken, files(id, name, mimeType)");
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("key", driveConfig.apiKey);
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await fetch(url.toString());

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const error = new Error(body?.error?.message || `Lỗi Google Drive API (${response.status})`);
            error.name = "DriveError";
            throw error;
        }

        const data = await response.json();
        children.push(...(data.files || []));
        pageToken = data.nextPageToken || "";

    } while (pageToken);

    driveListCache.set(folderId, children);
    idbSet(`list:${folderId}`, children, "drive-lists"); // lưu để lần tải trang sau không cần gọi lại

    return children;
}

function findDriveChild(children, name) {
    const lower = name.toLowerCase();
    return children.find(f => f.name.toLowerCase() === lower) || null;
}

function wrapDriveFolder(id, name) {

    return {

        kind: "directory",
        name,
        id, // ID gốc trên Drive — dùng để xoá cache riêng từng bộ truyện

        async *entries() {

            const children = await driveListChildren(id);

            for (const child of children) {

                const isFolder = child.mimeType === "application/vnd.google-apps.folder";

                yield [
                    child.name,
                    isFolder ? wrapDriveFolder(child.id, child.name) : wrapDriveFile(child.id, child.name)
                ];
            }
        },

        async getDirectoryHandle(childName) {

            const children = await driveListChildren(id);
            const child = findDriveChild(children, childName);

            if (!child || child.mimeType !== "application/vnd.google-apps.folder") {
                const error = new Error(`Không tìm thấy thư mục ${childName} trên Google Drive`);
                error.name = "NotFoundError";
                throw error;
            }

            return wrapDriveFolder(child.id, child.name);
        },

        async getFileHandle(childName) {

            const children = await driveListChildren(id);
            const child = findDriveChild(children, childName);

            if (!child || child.mimeType === "application/vnd.google-apps.folder") {
                const error = new Error(`Không tìm thấy file ${childName} trên Google Drive`);
                error.name = "NotFoundError";
                throw error;
            }

            return wrapDriveFile(child.id, child.name);
        }
    };
}

function buildDriveImageUrl(id) {
    // Link ảnh trực tiếp — trình duyệt tải để hiển thị <img>, không qua fetch()
    // nên không bị chặn CORS. Lưu ý: "uc?export=view" đã bị Google khai tử
    // (trả 403) sau khi họ bỏ third-party cookie cho Drive, nên dùng endpoint
    // thumbnail chính thức thay thế, kèm kích thước đủ lớn để đọc rõ.
    return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
}

function buildDriveImageFallbackUrl(id) {
    // Endpoint dự phòng nếu link chính lỗi/giới hạn tốc độ
    return `https://lh3.googleusercontent.com/d/${id}=w1600`;
}

/* Gắn vào onerror của <img> để tự chuyển sang link dự phòng khi link chính lỗi */
function handleDriveImgError(img) {

    const id = img.dataset.driveId;
    if (!id) return;

    if (!img.dataset.driveFallbackTried) {
        img.dataset.driveFallbackTried = "1";
        img.src = buildDriveImageFallbackUrl(id);
    }
}

function wrapDriveFile(id, name) {
    return {
        kind: "file",
        name,
        driveId: id,

        // Dùng cho ảnh (thumbnail, trang truyện) — không bị CORS chặn
        async getDisplayUrl() {
            return buildDriveImageUrl(id);
        },

        // Dùng cho nội dung text (info.json) — Google chặn CORS cho endpoint này,
        // nên với Drive lệnh này gần như luôn lỗi, phần gọi nó đã tự bắt lỗi
        // và dùng giá trị mặc định thay thế.
        async getFile() {

            const cached = await idbGet(`blob:${id}`, "drive-blobs");
            if (cached) return cached;

            const url =
                `https://www.googleapis.com/drive/v3/files/${id}` +
                `?alt=media&key=${driveConfig.apiKey}`;

            const response = await fetch(url);

            if (!response.ok) {
                const error = new Error(`Không tải được file ${name} từ Google Drive (${response.status})`);
                error.name = "DriveError";
                throw error;
            }

            const blob = await response.blob();
            idbSet(`blob:${id}`, blob, "drive-blobs"); // lưu để mở lại không cần tải mạng nữa

            return blob;
        }
    };
}


/* =====================================================
   KẾT NỐI / MỞ MODAL GOOGLE DRIVE
===================================================== */

function openDriveModal() {

    const existing = driveConfig || loadDriveConfig();

    if (existing) {
        document.getElementById("driveApiKeyInput").value = existing.apiKey || "";
        document.getElementById("driveFolderIdInput").value = existing.folderId || "";
    }

    document.getElementById("metadataSheetIdInput").value = metadataSheetId || "";
    document.getElementById("metadataSheetTabInput").value = metadataSheetTab || "";

    // luôn mở lại ở trạng thái ẩn API key cho an toàn
    apiKeyVisible = false;
    document.getElementById("driveApiKeyInput").type = "password";
    document.getElementById("apiKeyEyeIcon").setAttribute("href", "#icon-eye");

    document.getElementById("driveModal").classList.remove("hidden");
}

function closeDriveModal() {
    document.getElementById("driveModal").classList.add("hidden");
}

let apiKeyVisible = false;

function toggleApiKeyVisibility() {

    apiKeyVisible = !apiKeyVisible;

    const input = document.getElementById("driveApiKeyInput");
    const iconUse = document.getElementById("apiKeyEyeIcon");

    input.type = apiKeyVisible ? "text" : "password";
    iconUse.setAttribute("href", apiKeyVisible ? "#icon-eye-off" : "#icon-eye");
}

/* Cho phép dán cả link chia sẻ đầy đủ lẫn chỉ Folder ID — tự nhận diện và
   cắt lấy đúng phần ID cần dùng, không bắt người dùng tự cắt link nữa */
function extractDriveFolderId(input) {

    input = (input || "").trim();

    const folderPathMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderPathMatch) return folderPathMatch[1];

    const idParamMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParamMatch) return idParamMatch[1];

    // Không khớp link nào cả — coi như người dùng đã dán thẳng ID
    return input;
}

function handleConnectDriveClick() {

    const apiKey = document.getElementById("driveApiKeyInput").value;
    const folderId = document.getElementById("driveFolderIdInput").value;
    const sheetInput = document.getElementById("metadataSheetIdInput").value;
    const sheetTab = document.getElementById("metadataSheetTabInput").value;

    saveMetadataSheetConfig(sheetInput, sheetTab);
    metadataSheetCache = null; // đổi cấu hình thì phải tải lại

    connectGoogleDrive(apiKey, folderId);
}

async function connectGoogleDrive(apiKey, folderId, silent = false) {

    apiKey = (apiKey || "").trim();
    folderId = extractDriveFolderId(folderId);

    if (!apiKey || !folderId) {
        if (!silent) alert("Bạn nhập đủ API key và thư mục Drive giúp mình nhé.");
        return;
    }

    saveDriveConfig({ apiKey, folderId });
    driveListCache.clear();

    try {

        await driveListChildren(folderId); // thử gọi để chắc key + folder ID đúng

        dataFolder = wrapDriveFolder(folderId, "DATA");
        readOnlyMode = true;
        activeSource = "drive";

        document.getElementById("reconnectBanner").classList.add("hidden");
        closeDriveModal();

        // Thử luôn Google Sheet (nếu có cấu hình) để báo lỗi rõ ràng ngay,
        // thay vì để im lặng rồi anh không hiểu sao thông tin cứ trống
        if (metadataSheetId && !silent) {
            try {
                await loadMetadataSheet();
            } catch (sheetError) {
                console.error(sheetError);
                alert(
                    "Đã kết nối Drive thành công, nhưng không đọc được Google Sheet:\n\n" +
                    sheetError.message +
                    "\n\nKiểm tra lại: đã bật Google Sheets API trong Cloud Console chưa, " +
                    "API key có bị giới hạn chỉ cho Drive API không, và Sheet đã chia sẻ " +
                    "\"Bất kỳ ai có đường liên kết – Người xem\" chưa."
                );
            }
        }

        await scanProjects();

    } catch (error) {

        console.error(error);

        if (!silent) {
            alert(
                "Không kết nối được Google Drive:\n\n" + error.message +
                "\n\nKiểm tra lại API key, Folder ID, và đảm bảo thư mục đã chia sẻ " +
                "ở chế độ \"Bất kỳ ai có đường liên kết – Người xem\"."
            );
        }
    }
}

/* =====================================================
   KHỞI ĐỘNG APP
===================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    replaceHistoryState({ view: "home" });

    updateReadingModeButton();
    updatePagesPerViewButton();
    updateReadingDirectionButton();
    applyZoom();

    applyTheme(currentAccent, currentAccent2);
    applyBgOverlayOpacity(bgOverlayOpacity);
    await loadBackgroundImage();

    applyViewMode();

    const sortRadio = document.querySelector(`input[name="sortOrder"][value="${sortOrder}"]`);
    if (sortRadio) sortRadio.checked = true;

    if (!supportsFSAccess) {
        const folderBtn = document.querySelector('.header-actions [onclick="openDataFolder()"]');
        if (folderBtn) {
            folderBtn.title =
                "Mở thư mục thư viện (chế độ chỉ đọc — trình duyệt này không hỗ trợ ghi)";
        }

        const refreshBtn = document.querySelector(".refresh-btn");
        if (refreshBtn) {
            refreshBtn.title =
                "Làm mới thư viện (sẽ hỏi chọn lại thư mục — trình duyệt này không tự đọc lại đĩa được)";
        }
    }

    await tryRestoreLibrary();

    // Nếu chưa mở được thư viện local nào, thử tự kết nối lại Google Drive đã lưu
    if (!dataFolder) {
        const saved = loadDriveConfig();
        if (saved) {

            // Hiện ngay danh sách đã quét lần trước trong lúc chờ kết nối lại thật,
            // đỡ phải nhìn màn hình trống/loading mỗi lần mở app
            await renderCachedBookList("drive", saved.folderId);

            await connectGoogleDrive(saved.apiKey, saved.folderId, true);
        }
    }

    // Cập nhật lại banner/hero theo đúng trạng thái thư viện vừa xong
    applyViewMode();
});

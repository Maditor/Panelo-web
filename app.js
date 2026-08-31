let dataFolder = null;
let books = [];

let currentBook = null;
let currentChapterIndex = 0;

// Reading mode: "scroll" (webtoon, cuộn dọc) hoặc "page" (lật trang từng ảnh)
let readingMode = localStorage.getItem("vt-reading-mode") || "scroll";

let currentPageIndex = 0;
let currentChapterImageURLs = [];
let pendingHandle = null;


/* =====================================================
   INDEXEDDB — LƯU THƯ MỤC ĐÃ CHỌN
===================================================== */

const IDB_NAME = "visiontoon-db";
const IDB_STORE = "handles";

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);

        req.onupgradeneeded = () => {
            req.result.createObjectStore(IDB_STORE);
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, value) {
    try {
        const db = await idbOpen();

        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, "readwrite");
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

    } catch (error) {
        console.warn("Không thể lưu thư mục:", error);
    }
}

async function idbGet(key) {
    try {
        const db = await idbOpen();

        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, "readonly");
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });

    } catch (error) {
        console.warn("Không thể đọc thư mục đã lưu:", error);
        return null;
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

    if (!window.showDirectoryPicker) {
        alert(
            "Trình duyệt này chưa hỗ trợ tính năng tạo thư mục.\n\n" +
            "Hãy dùng Google Chrome hoặc Microsoft Edge."
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

    if (!window.showDirectoryPicker) {
        alert("Chrome hoặc Edge là trình duyệt được khuyến nghị.");
        return;
    }

    try {

        const selectedFolder = await window.showDirectoryPicker({ mode: "readwrite" });

        /*
         * Nếu chọn trực tiếp DATA: dataFolder = DATA
         * Nếu chọn thư mục chứa DATA: tự tìm DATA bên trong
         */

        try {
            dataFolder = await selectedFolder.getDirectoryHandle("DATA");
        } catch {
            dataFolder = selectedFolder;
        }

        await idbSet("dataFolder", dataFolder);
        document.getElementById("reconnectBanner").classList.add("hidden");

        await scanProjects();

    } catch (error) {

        if (error.name !== "AbortError") {
            console.error(error);
        }
    }
}


/* =====================================================
   SCAN PROJECTS
===================================================== */

async function scanProjects() {

    document.getElementById("bookGrid").innerHTML =
        `<div class="loading-state">⏳ Đang quét thư viện...</div>`;

    revokeBookThumbnails();

    books = [];

    let projectFolder;

    try {

        projectFolder = await dataFolder.getDirectoryHandle("Project");

    } catch {

        /* Nếu chưa có Project thì tự tạo */

        try {
            projectFolder = await dataFolder.getDirectoryHandle("Project", { create: true });
        } catch {
            alert("Không tìm thấy DATA/Project.");
            selectedTags.clear();
            updateFilterBadge();
            renderFilterPanel();
            renderBooks(books);
            return;
        }
    }

    for await (const [name, handle] of projectFolder.entries()) {

        if (handle.kind !== "directory") continue;

        const book = await readBook(name, handle);

        if (book) books.push(book);
    }

    selectedTags.clear();
    updateFilterBadge();
    renderFilterPanel();

    renderBooks(books);
}


/* =====================================================
   READ BOOK
===================================================== */

async function readBook(name, folder) {

    let aboutFolder = null;
    let chapterFolder = null;

    /* ABOUT KHÔNG CÒN BẮT BUỘC */

    try {
        aboutFolder = await folder.getDirectoryHandle("About");
    } catch {
        console.log(`${name}: không có About`);
    }

    /* CHAPTER LÀ THỨ BẮT BUỘC */

    try {
        chapterFolder = await folder.getDirectoryHandle("Chapter");
    } catch {
        console.warn(`${name}: không có Chapter`);
        return null;
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
       THUMBNAIL
    ============================================= */

    let thumbnail = null;

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
                const file = await handle.getFile();

                thumbnail = URL.createObjectURL(file);
                break;

            } catch {
                // thử file tiếp theo
            }
        }
    }

    /* =============================================
       CHAPTERS
    ============================================= */

    const chapters = [];

    for await (const [chapterName, handle] of chapterFolder.entries()) {

        if (handle.kind !== "directory") continue;

        const images = [];

        for await (const [fileName, imageHandle] of handle.entries()) {

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

        /* Không hiện chapter rỗng */

        if (images.length > 0) {
            chapters.push({ name: chapterName, images });
        }
    }

    chapters.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    return { name, ...info, thumbnail, chapters, folder };
}


/* =====================================================
   RENDER BOOKS
===================================================== */

function renderBooks(list) {

    const grid = document.getElementById("bookGrid");

    grid.innerHTML = "";

    document.getElementById("libraryCount").textContent = `${list.length} bộ truyện`;

    if (!list.length) {

        grid.innerHTML = `
            <div style="grid-column:1/-1;padding:80px 20px;text-align:center;color:#777;">
                📚
                <br><br>
                Chưa có truyện trong DATA/Project
            </div>
        `;

        return;
    }

    list.forEach(book => {

        const card = document.createElement("div");
        card.className = "book-card";
        card.onclick = () => showBook(book);

        const progress = loadProgress(book);

        card.innerHTML = `
            ${
                book.thumbnail
                ? `<img class="book-cover" src="${book.thumbnail}">`
                : `<div class="book-cover" style="display:flex;align-items:center;justify-content:center;font-size:40px;">📖</div>`
            }

            <div class="book-title">${escapeHTML(book.title || book.name)}</div>

            <div class="book-meta">
                ${book.chapters.length} chapter
                ${progress ? " • đang đọc dở" : ""}
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

document.addEventListener("click", (event) => {

    const wrap = document.querySelector(".filter-wrap");
    const panel = document.getElementById("filterPanel");

    if (!wrap || !panel || panel.classList.contains("hidden")) return;

    if (!wrap.contains(event.target)) {
        panel.classList.add("hidden");
    }
});

function applyFilters() {

    const keyword = document.getElementById("searchInput").value.toLowerCase();

    const filtered = books.filter(book => {

        const haystack = `${book.title || book.name} ${book.author || ""}`.toLowerCase();
        const matchesKeyword = haystack.includes(keyword);

        const matchesTags =
            selectedTags.size === 0 ||
            (book.genres || []).some(g => selectedTags.has(g));

        return matchesKeyword && matchesTags;
    });

    renderBooks(filtered);
}


/* =====================================================
   SHOW BOOK
===================================================== */

function showBook(book) {

    currentBook = book;

    document.getElementById("homePage").classList.remove("active");
    document.getElementById("detailPage").classList.add("active");

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
                    ▶ Đọc tiếp: ${escapeHTML(chapterName)}
                </button>
                <button class="secondary-btn" onclick="openChapter(0)">
                    Đọc lại từ đầu
                </button>
            `;

        } else {

            actionButtons = `
                <button class="primary-btn" onclick="openChapter(0)">
                    ▶ Đọc chapter đầu tiên
                </button>
            `;
        }
    }

    detail.innerHTML = `
        <div class="detail-header">
            ${
                book.thumbnail
                ? `<img class="detail-cover" src="${book.thumbnail}">`
                : `<div class="detail-cover" style="display:flex;align-items:center;justify-content:center;font-size:50px;">📖</div>`
            }

            <div class="detail-info">
                <h1>${escapeHTML(book.title || book.name)}</h1>

                ${book.author ? `<p>✍️ ${escapeHTML(book.author)}</p>` : ""}

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
            <h2>Chapters</h2>

            ${
                book.chapters.length
                ? book.chapters.map((chapter, index) => `
                    <div class="chapter-item" onclick="openChapter(${index})">
                        <span class="chapter-name">${escapeHTML(chapter.name)}</span>
                        <span class="chapter-number">
                            ${
                                hasValidProgress && index === progress.chapterIndex
                                ? "Đang đọc dở • "
                                : ""
                            }
                            ${chapter.images.length} ảnh →
                        </span>
                    </div>
                `).join("")
                : `<p style="color:#777">Chưa có chapter.</p>`
            }
        </div>
    `;
}


/* =====================================================
   OPEN CHAPTER
===================================================== */

async function openChapter(index, opts = {}) {

    const chapter = currentBook.chapters[index];

    if (!chapter) return;

    currentChapterIndex = index;

    document.getElementById("detailPage").classList.remove("active");
    document.getElementById("readerPage").classList.add("active");

    document.getElementById("readerTitle").textContent = `${currentBook.title} • ${chapter.name}`;

    updateReadingModeButton();

    const reader = document.getElementById("readerContent");
    reader.innerHTML = `<div class="loading-state">⏳ Đang tải ảnh...</div>`;

    revokeChapterURLs();

    const urls = [];

    for (const image of chapter.images) {
        const file = await image.handle.getFile();
        urls.push(URL.createObjectURL(file));
    }

    currentChapterImageURLs = urls;

    currentPageIndex =
        opts.startPage === "last" ? urls.length - 1 : (opts.startPage ?? 0);

    renderChapterContent();
    saveProgress();

    window.scrollTo({ top: 0, behavior: "instant" });
}

function revokeChapterURLs() {
    currentChapterImageURLs.forEach(url => URL.revokeObjectURL(url));
    currentChapterImageURLs = [];
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

        currentChapterImageURLs.forEach(url => {
            const img = document.createElement("img");
            img.src = url;
            img.loading = "lazy";
            reader.appendChild(img);
        });

        const hasNext = currentChapterIndex < currentBook.chapters.length - 1;

        const banner = document.createElement("div");
        banner.className = "next-chapter-banner";
        banner.innerHTML = hasNext
            ? `<button class="primary-btn" onclick="nextChapter()">Chapter tiếp theo ▶</button>`
            : `<p style="color:#777">🎉 Bạn đã đọc hết chapter mới nhất</p>`;
        reader.appendChild(banner);

    } else {

        const img = document.createElement("img");
        img.src = currentChapterImageURLs[currentPageIndex];
        reader.appendChild(img);

        const nav = document.createElement("div");
        nav.className = "page-nav";
        nav.innerHTML = `
            <button onclick="prevPage()">‹ Trước</button>
            <span>${currentPageIndex + 1} / ${currentChapterImageURLs.length}</span>
            <button onclick="nextPage()">Sau ›</button>
        `;
        reader.appendChild(nav);
    }

    updateProgressBar();
}


/* =====================================================
   ĐIỀU HƯỚNG TRANG (chế độ Lật trang)
===================================================== */

function nextPage() {

    if (currentPageIndex < currentChapterImageURLs.length - 1) {
        currentPageIndex++;
        renderChapterContent();
        saveProgress();
    } else {
        nextChapter();
    }
}

function prevPage() {

    if (currentPageIndex > 0) {
        currentPageIndex--;
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
        openChapter(currentChapterIndex + 1);
    }
}

function previousChapter(opts = {}) {

    if (currentChapterIndex > 0) {
        openChapter(currentChapterIndex - 1, opts.toLastPage ? { startPage: "last" } : {});
    }
}


/* =====================================================
   CHẾ ĐỘ ĐỌC: CUỘN DỌC / LẬT TRANG
===================================================== */

function toggleReadingMode() {

    readingMode = readingMode === "scroll" ? "page" : "scroll";
    localStorage.setItem("vt-reading-mode", readingMode);

    updateReadingModeButton();

    currentPageIndex = 0;

    if (currentChapterImageURLs.length) {
        renderChapterContent();
    }
}

function updateReadingModeButton() {

    const btn = document.getElementById("readingModeBtn");
    if (!btn) return;

    if (readingMode === "scroll") {
        btn.textContent = "📜";
        btn.title = "Đang: Cuộn dọc — bấm để đổi sang Lật trang";
    } else {
        btn.textContent = "📄";
        btn.title = "Đang: Lật trang — bấm để đổi sang Cuộn dọc";
    }
}


/* =====================================================
   THANH TIẾN TRÌNH
===================================================== */

function updateProgressBar() {

    const fill = document.getElementById("readerProgressFill");
    if (!fill) return;

    if (readingMode === "page") {
        const total = currentChapterImageURLs.length || 1;
        fill.style.width = `${((currentPageIndex + 1) / total) * 100}%`;
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
        chapterName: chapter ? chapter.name : ""
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
        <div class="chapter-item" onclick="closeChapterModal(); openChapter(${index})">
            <span class="chapter-name">
                ${index === currentChapterIndex ? "▶ " : ""}${escapeHTML(chapter.name)}
            </span>
            <span class="chapter-number">${chapter.images.length} ảnh</span>
        </div>
    `).join("");

    document.getElementById("chapterModal").classList.remove("hidden");
}

function closeChapterModal() {
    document.getElementById("chapterModal").classList.add("hidden");
}


/* =====================================================
   CLOSE READER / HOME
===================================================== */

function closeReader() {

    document.getElementById("readerPage").classList.remove("active");

    showBook(currentBook);
}

function showHome() {

    document.getElementById("detailPage").classList.remove("active");
    document.getElementById("readerPage").classList.remove("active");
    document.getElementById("homePage").classList.add("active");
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
   KHỞI ĐỘNG APP
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    updateReadingModeButton();
    applyZoom();
    tryRestoreLibrary();
});
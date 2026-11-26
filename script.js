import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Your Supabase Project URL and anon / publishable key
const SUPABASE_URL = "https://jjodccgpmaejjzibirbj.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BUCKET_NAME = "works";
const TABLE_NAME = "works";
const categories = ["activities", "quizzes", "exams", "projects"];

document.addEventListener("DOMContentLoaded", () => {
  categories.forEach((cat) => {
    loadCategoryWorks(cat);
  });
  subscribeToWorksRealtime();
  setupDragAndDrop();
});

// Load works for a specific category
async function loadCategoryWorks(category) {
  const container = document.getElementById(`list-${category}`);
  if (!container) return;

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("category", category)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Error loading ${category}:`, error);
    return;
  }

  renderWorkCards(container, data || []);
}

// Render cards into a category grid
function renderWorkCards(container, items) {
  container.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "work-card";
    card.innerHTML = `
      <div class="work-card-info">
        <div class="work-file-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        </div>
        <div class="work-file-details">
          <div class="work-file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="work-file-meta">
            <span>${escapeHtml(item.size)}</span>
            <span>•</span>
            <span>${escapeHtml(item.date)}</span>
          </div>
        </div>
      </div>
      <div class="work-card-actions">
        <a href="${item.download_url}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(item.name)}" class="btn-action view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          View / Open
        </a>
        <button class="btn-action delete" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Delete
        </button>
      </div>
    `;

    card.querySelector(".delete").addEventListener("click", () => {
      deleteWorkItem(item.id, item.storage_path);
    });

    container.appendChild(card);
  });
}

// Listen for real-time INSERT / DELETE changes in Postgres
function subscribeToWorksRealtime() {
  supabase
    .channel("works-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE_NAME },
      (payload) => {
        const affectedCategory = payload.new?.category || payload.old?.category;
        if (affectedCategory && categories.includes(affectedCategory)) {
          loadCategoryWorks(affectedCategory);
        } else {
          categories.forEach((cat) => loadCategoryWorks(cat));
        }
      }
    )
    .subscribe();
}

// Upload file(s) to Supabase Storage & save metadata to Postgres
window.uploadToSupabase = async function (event, category) {
  const files = event.target.files;
  if (!files || !files.length) return;

  showToast(`Uploading ${files.length} file(s) to Supabase Cloud...`);

  for (const file of files) {
    try {
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${category}/${Date.now()}_${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);

      const { error: insertError } = await supabase.from(TABLE_NAME).insert({
        name: file.name,
        size: (file.size / 1024).toFixed(1) + " KB",
        category: category,
        storage_path: storagePath,
        download_url: urlData.publicUrl,
        date: new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });

      if (insertError) throw insertError;

      await loadCategoryWorks(category);
      showToast(`Uploaded ${file.name} successfully!`);
    } catch (err) {
      console.error(err);
      showToast(`Upload failed: ${err.message}`);
    }
  }

  if (event.target) {
    event.target.value = "";
  }
};

// Delete file from Supabase Storage and row from Postgres
async function deleteWorkItem(id, storagePath) {
  try {
    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([storagePath]);

      if (storageError) throw storageError;
    }

    const { error: dbError } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq("id", id);

    if (dbError) throw dbError;

    showToast("File deleted from Cloud.");
  } catch (err) {
    console.error(err);
    showToast(`Error deleting file: ${err.message}`);
  }
}

// Tab switching
window.switchTab = function (event, category) {
  document.querySelectorAll(".works-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));

  const targetPanel = document.getElementById(`panel-${category}`);
  if (targetPanel) targetPanel.classList.add("active");
  if (event?.currentTarget) event.currentTarget.classList.add("active");
};

// Trigger hidden file input
window.triggerFileInput = function (category) {
  const fileInput = document.getElementById(`file-${category}`);
  if (fileInput) fileInput.click();
};

// Drag-and-drop handlers
function setupDragAndDrop() {
  categories.forEach((cat) => {
    const dropzone = document.getElementById(`dropzone-${cat}`);
    if (!dropzone) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(
        eventName,
        (e) => {
          e.preventDefault();
          dropzone.classList.add("dragover");
        },
        false
      );
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(
        eventName,
        (e) => {
          e.preventDefault();
          dropzone.classList.remove("dragover");
        },
        false
      );
    });

    dropzone.addEventListener(
      "drop",
      (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length) {
          window.uploadToSupabase({ target: { files } }, cat);
        }
      },
      false
    );
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");
  if (toast && toastMessage) {
    toastMessage.innerText = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
  }
}
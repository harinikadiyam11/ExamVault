const STORAGE_KEY = "examvault.workspace.v1";
const DATABASE = "examvault-files";

export const emptyWorkspace = {
  profile: { branch: "", semester: "", regulation: "", studyHours: 3 },
  subjects: [],
  papers: [],
  tasks: [],
};

export function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved && typeof saved === "object" ? { ...emptyWorkspace, ...saved } : emptyWorkspace;
  } catch (error) {
    console.error("Could not read the saved ExamVault workspace.", error);
    return emptyWorkspace;
  }
}

export function saveWorkspace(workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch (error) {
    console.error("Could not save the ExamVault workspace.", error);
    throw new Error("Your browser could not save this change. Free up browser storage and try again.");
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("papers");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeFile(id, file) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("papers", "readwrite");
    transaction.objectStore("papers").put(file, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function deleteFile(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("papers", "readwrite");
    transaction.objectStore("papers").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function clearFiles() {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("papers", "readwrite");
    transaction.objectStore("papers").clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

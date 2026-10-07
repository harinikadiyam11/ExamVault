import { uid, inferTopic } from "./analysis.js";

let pdfjsPromise;
async function getPdfEngine() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function readPdf(file, onProgress) {
  const pdfjs = await getPdfEngine();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > 100) {
    await pdf.destroy();
    throw new Error("This PDF has more than 100 pages. Split it into smaller papers and try again.");
  }
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress?.(Math.round((pageNumber / pdf.numPages) * 40), `Reading PDF page ${pageNumber} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).filter(Boolean).join(" "));
    }
    let text = pages.join("\n\n");
    let method = "PDF text layer";
    if (text.trim().length < 30) {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") onProgress?.(40 + Math.round(message.progress * 50), "Recognizing scanned PDF text locally");
        },
      });
      try {
        const scannedPages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not prepare a PDF page for local OCR.");
          await page.render({ canvasContext: context, viewport }).promise;
          const result = await worker.recognize(canvas);
          scannedPages.push(result.data.text);
          canvas.width = 0;
          canvas.height = 0;
        }
        text = scannedPages.join("\n\n");
        method = "PDF scan · Tesseract.js English OCR";
      } finally {
        await worker.terminate();
      }
    }
    return { text, pageCount: pdf.numPages, method };
  } finally {
    await pdf.destroy();
  }
}

async function readImage(file, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") onProgress?.(Math.round(message.progress * 85), "Recognizing image text locally");
    },
  });
  try {
    const result = await worker.recognize(file);
    return { text: result.data.text, pageCount: 1, method: "Tesseract.js English OCR" };
  } finally {
    await worker.terminate();
  }
}

export function splitQuestions(text) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const questionStart = /(?:^|\s)(?:Q(?:uestion)?\s*)?(\d{1,2})\s*[.)-]\s+/gim;
  const matches = [...clean.matchAll(questionStart)];
  const blocks = matches.length > 1
    ? matches.map((match, index) => clean.slice(match.index + match[0].indexOf(match[1]), matches[index + 1]?.index ?? clean.length).trim())
    : [clean];
  return blocks.filter((block) => block.length >= 12);
}

export async function extractPaper(file, units, onProgress) {
  const extracted = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    ? await readPdf(file, onProgress)
    : await readImage(file, onProgress);
  const blocks = splitQuestions(extracted.text);
  const questions = blocks.map((originalText) => {
    const likelyQuestion = /(?:\?|explain|derive|calculate|describe|prove|state|write|discuss|what|how)/i.test(originalText);
    const likelyMarks = originalText.match(/\[\s*(\d{1,3})\s*marks?\s*\]|\(\s*(\d{1,3})\s*marks?\s*\)|\b(\d{1,3})\s+marks?\b/i);
    const mapped = inferTopic(originalText, units);
    return {
      id: uid(),
      originalText,
      text: originalText,
      marks: likelyMarks ? Number(likelyMarks[1] || likelyMarks[2] || likelyMarks[3]) : null,
      unitId: mapped?.unitId || "",
      topicId: mapped?.topicId || "",
      confidence: likelyQuestion && originalText.length > 25 ? "medium" : "low",
      review: !likelyQuestion || originalText.length <= 25,
      reviewed: false,
      status: "ready",
    };
  });
  onProgress?.(95, "Checking extracted text");
  return { ...extracted, questions };
}

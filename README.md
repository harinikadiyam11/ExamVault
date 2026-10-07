# ExamVault

ExamVault is a local-first MVP for organizing a student's current syllabus, reviewing extracted past-paper questions, and understanding historical patterns without presenting them as predictions.

## Run locally

```sh
npm install
npm run dev
```

Build for production with `npm run build`.

## Current scope and data handling

- Subjects, student context, syllabus versions, paper metadata, extracted text, analysis decisions, and study tasks are stored in this browser's local storage. Original PDFs and images are stored in this browser's IndexedDB.
- PDFs with a text layer are read with PDF.js. JPG and PNG files use Tesseract.js English OCR in a browser worker. The OCR runtime and English language model are fetched from a public CDN when first needed; uploaded paper contents are processed in the browser and are not sent to that CDN, an ExamVault server, or an AI service.
- Supported uploads are PDF, JPG, and PNG up to 20 MB. SHA-256 content hashes are used for duplicate detection. Users can retry failed processing and permanently delete individual papers or the whole local workspace.
- Question text is kept alongside the original extraction for comparison. Heuristic extraction and syllabus mapping are unverified; each question must be explicitly confirmed by a student before it contributes to analysis. Correct the text, year, marks, and unit/topic during review. Unknown marks and years are left unknown.
- Similarity groups use a deterministic text-overlap threshold and can be corrected by keeping a pair separate. Priority is a deterministic study aid: 50% distinct-paper coverage, 25% normalized recency, and 25% current-syllabus mapping. It is not a prediction or a guarantee. Analysis labels limited evidence explicitly.
- The generated plan uses the subject exam date, available daily hours, topic priorities, and a revision task. It is a starting point, not a promise about preparation outcomes.

This repository has no authentication or backend. The prototype therefore does **not** provide authenticated owner isolation, server-side encrypted storage, account recovery, or cross-device sync. Data remains accessible to anyone who can use the same browser profile; do not use a shared or public device for sensitive papers. A production deployment needs HTTPS, authenticated ownership checks, and private, authorized file delivery before storing student data remotely.

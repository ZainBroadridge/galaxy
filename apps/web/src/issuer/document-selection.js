export const MAX_DOCUMENTS = 3;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function fileIdentity(file) {
  return JSON.stringify([file.name, file.size, file.lastModified ?? 0]);
}

function validatePdf(file) {
  if (!file || typeof file.name !== 'string') throw new Error('Choose a PDF document.');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error(`${file.name} is not a PDF.`);
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${file.name} must be a non-empty PDF no larger than 10 MB.`);
  }
}

/** Append a picker batch atomically; callers retain the current list on failure. */
export function appendPdfSelection(current, incoming, existingCount = 0) {
  if (!Number.isInteger(existingCount) || existingCount < 0) {
    throw new Error('The saved document count is invalid. Refresh the event and try again.');
  }
  const combined = [...current];
  const seen = new Set(combined.map(fileIdentity));
  for (const file of incoming) {
    validatePdf(file);
    const identity = fileIdentity(file);
    if (!seen.has(identity)) {
      combined.push(file);
      seen.add(identity);
    }
  }
  if (existingCount + combined.length > MAX_DOCUMENTS) {
    throw new Error(`An event can contain at most ${MAX_DOCUMENTS} PDF documents. Remove a selected document before adding another.`);
  }
  return combined;
}

import {
  createDocumentReadStream,
  getDocumentDownload,
  getDocumentMetadata,
  listDocuments,
  updateDocumentMetadata,
  uploadDocument,
} from '../services/documentService.js';

export async function listDocumentsController(request, response, next) {
  try {
    const result = await listDocuments(request.user, request.query);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

export async function uploadDocumentController(request, response, next) {
  try {
    const document = await uploadDocument(
      request.user,
      request.params.caseId,
      request
    );
    return response.status(201).json({ document });
  } catch (error) {
    return next(error);
  }
}

export async function getDocumentController(request, response, next) {
  try {
    const document = await getDocumentMetadata(
      request.user,
      request.params.documentId
    );
    return response.status(200).json({ document });
  } catch (error) {
    return next(error);
  }
}

export async function downloadDocumentController(request, response, next) {
  try {
    const { document, fileHandle, fileSize } = await getDocumentDownload(
      request.user,
      request.params.documentId
    );
    const downloadName = /^[A-Za-z0-9][A-Za-z0-9 _().-]*\.pdf$/i.test(document.file_name)
      ? document.file_name
      : 'document.pdf';
    return streamDocumentDownload(
      response,
      next,
      fileHandle,
      fileSize,
      downloadName
    );
  } catch (error) {
    return next(error);
  }
}

export function streamDocumentDownload(
  response,
  next,
  fileHandle,
  fileSize,
  downloadName
) {
  response.status(200).set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(fileSize),
    'Content-Disposition': `attachment; filename="${downloadName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let fileHandleClosed = false;
  const closeFileHandle = () => {
    if (fileHandleClosed) return;
    fileHandleClosed = true;
    fileHandle.close().catch(() => {});
  };
  let stream;
  try {
    stream = createDocumentReadStream(fileHandle);
  } catch (error) {
    closeFileHandle();
    throw error;
  }
  stream.once('close', closeFileHandle);
  stream.once('end', closeFileHandle);
  stream.on('error', () => {
    closeFileHandle();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    next(new Error('Unable to retrieve document file.'));
  });
  response.once('close', () => {
    if (!stream.closed) stream.destroy();
    closeFileHandle();
  });
  response.once('finish', closeFileHandle);
  stream.pipe(response);
  return undefined;
}

export async function updateDocumentController(request, response, next) {
  try {
    const document = await updateDocumentMetadata(
      request.user,
      request.params.documentId,
      request.body
    );
    return response.status(200).json({ document });
  } catch (error) {
    return next(error);
  }
}
